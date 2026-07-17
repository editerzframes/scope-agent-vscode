import * as path from "node:path";
import * as vscode from "vscode";
import {
  CodexService,
  FilePatchChange,
  FilePatchEvent,
  TurnDiffEvent,
  TurnFinishedEvent,
} from "./codexService";
import { parseAggregatedUnifiedDiff, UnifiedFileDiff } from "./turnDiff";
import {
  changedDiffLinesForHunk,
  changedLinesForHunk,
  newLineRangesForHunk,
  parseUnifiedDiffHunks,
  reverseHunkInText,
  UnifiedDiffHunk,
} from "./unifiedDiff";

interface FileSnapshot {
  exists: boolean;
  text: string;
}

interface PreparedOpenFile {
  uri: vscode.Uri;
  snapshot: FileSnapshot;
  safeToRestore: boolean;
  dirty: boolean;
}

interface PendingFileChange {
  uri: vscode.Uri;
  sourceUri: vscode.Uri;
  label: string;
  kind: FilePatchChange["kind"];
  diff: string;
  hunks: UnifiedDiffHunk[];
  original: FileSnapshot | null;
  after: FileSnapshot | null;
  canReject: boolean;
  applied: boolean;
}

const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

export class InlineDiffManager implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly pending = new Map<string, PendingFileChange>();
  private readonly prepared = new Map<string, PreparedOpenFile>();
  private readonly latestTurnDiffs = new Map<string, UnifiedFileDiff>();
  private readonly stagedKeys = new Set<string>();
  private readonly captureTasks = new Map<string, Promise<void>>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly codeLensEmitter = new vscode.EventEmitter<void>();
  private reviewPromptTimer: NodeJS.Timeout | undefined;

  readonly onDidChangeCodeLenses = this.codeLensEmitter.event;

  private readonly changeDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("diffEditor.insertedLineBackground"),
    overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.addedForeground"),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });

  private readonly deletionBoundaryDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderWidth: "0 0 0 3px",
    borderStyle: "solid",
    borderColor: new vscode.ThemeColor("diffEditor.removedLineBackground"),
    overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.deletedForeground"),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });

  private readonly filePatchListener = (event: FilePatchEvent): void => {
    void this.handleFilePatch(event).catch((error: unknown) => this.logError("file patch", error));
  };

  private readonly turnPreparingListener = (): void => {
    this.prepareOpenDocuments();
  };

  private readonly turnDiffListener = (event: TurnDiffEvent): void => {
    this.handleTurnDiff(event);
  };

  private readonly turnFinishedListener = (event: TurnFinishedEvent): void => {
    void this.finalizeTurn(event).catch((error: unknown) => this.logError("turn diff", error));
  };

  constructor(
    private readonly service: CodexService,
    private readonly output: vscode.OutputChannel,
  ) {
    this.service.on("filePatch", this.filePatchListener);
    this.service.on("turnPreparing", this.turnPreparingListener);
    this.service.on("turnDiff", this.turnDiffListener);
    this.service.on("turnFinished", this.turnFinishedListener);
    this.disposables.push(
      vscode.languages.registerCodeLensProvider({ scheme: "file" }, this),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshVisibleEditors()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateContextKeys()),
      vscode.workspace.onDidOpenTextDocument(() => this.refreshVisibleEditors()),
      vscode.workspace.onDidChangeTextDocument(() => this.refreshVisibleEditors()),
      this.changeDecoration,
      this.deletionBoundaryDecoration,
      this.codeLensEmitter,
    );
  }

  get pendingCount(): number {
    return [...this.pending.values()].filter((entry) => entry.applied).length;
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const entry = this.pending.get(document.uri.toString());
    if (!entry?.applied) {
      return [];
    }

    if (entry.hunks.length === 0) {
      return this.fileCodeLenses(document, entry);
    }

    const lenses: vscode.CodeLens[] = [];
    for (const hunk of entry.hunks) {
      const anchor = this.hunkAnchor(document, hunk);
      if (entry.canReject) {
        lenses.push(
          new vscode.CodeLens(anchor, {
            title: "$(discard) Undo",
            tooltip: "Restore this block to its pre-Codex content",
            command: "codexAgent.rejectHunk",
            arguments: [document.uri, hunk.id],
          }),
        );
      }
      lenses.push(
        new vscode.CodeLens(anchor, {
          title: "$(check) Keep",
          tooltip: "Keep this Codex change",
          command: "codexAgent.acceptHunk",
          arguments: [document.uri, hunk.id],
        }),
      );
    }
    return lenses;
  }

  async reviewPendingChanges(): Promise<void> {
    const entries = [...this.pending.values()].filter((entry) => entry.applied);
    if (entries.length === 0) {
      vscode.window.showInformationMessage("There are no pending Codex edits to review.");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      entries.map((entry) => ({
        label: entry.kind.type === "delete" ? `$(trash) ${entry.label}` : `$(edit) ${entry.label}`,
        description: entry.canReject ? `${entry.hunks.length || 1} change(s) · Keep or undo` : "Keep only",
        entry,
      })),
      {
        title: "Review Codex edits in the original editor",
        placeHolder: "Choose a changed file",
      },
    );
    if (picked) {
      await this.openEntry(picked.entry);
    }
  }

  async openFileForReview(uri: vscode.Uri): Promise<void> {
    const entry = this.pending.get(uri.toString());
    if (entry?.applied) {
      await this.openEntry(entry);
      return;
    }
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error: unknown) {
      if (isFileNotFound(error)) {
        vscode.window.showInformationMessage("This file was deleted by the Codex turn. Use Review Pending Edits to restore or keep the deletion.");
        return;
      }
      throw error;
    }
  }

  async acceptHunk(uri: vscode.Uri, hunkId: string): Promise<void> {
    const entry = this.pending.get(uri.toString());
    const hunk = entry?.hunks.find((candidate) => candidate.id === hunkId);
    if (!entry || !hunk) {
      vscode.window.showInformationMessage("This Codex change is no longer pending.");
      return;
    }
    entry.hunks = entry.hunks.filter((candidate) => candidate.id !== hunkId);
    if (entry.hunks.length === 0) {
      this.clearEntry(entry);
    } else {
      this.refreshReviewUi();
    }
    vscode.window.setStatusBarMessage(`Kept a Codex change in ${entry.label}`, 3_000);
  }

  async rejectHunk(uri: vscode.Uri, hunkId: string): Promise<void> {
    const entry = this.pending.get(uri.toString());
    const hunk = entry?.hunks.find((candidate) => candidate.id === hunkId);
    if (!entry || !hunk) {
      vscode.window.showInformationMessage("This Codex change is no longer pending.");
      return;
    }
    if (!entry.canReject || !entry.original) {
      vscode.window.showWarningMessage(`The pre-edit content for ${entry.label} is unavailable.`);
      return;
    }
    if (entry.kind.type === "add" && entry.hunks.length === 1) {
      await this.rejectFile(uri);
      return;
    }

    const current = await this.readCurrentSnapshot(entry.uri, entry.after?.exists === false);
    if (!sameSnapshot(current, entry.after)) {
      vscode.window.showWarningMessage(
        `${entry.label} changed after Codex finished. Per-change undo is paused to avoid overwriting newer edits; use Undo File if you intend to restore the full snapshot.`,
      );
      return;
    }

    const document = await vscode.workspace.openTextDocument(entry.uri);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const { range, replacement } = this.reverseHunkEdit(document, hunk);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, range, replacement);
    if (!(await vscode.workspace.applyEdit(edit)) || !(await document.save())) {
      throw new Error(`VS Code could not undo the change in ${entry.label}.`);
    }

    const delta = hunk.oldCount - hunk.newCount;
    for (const remaining of entry.hunks) {
      if (remaining.id !== hunk.id && remaining.newStart > hunk.newStart) {
        remaining.newStart = Math.max(1, remaining.newStart + delta);
      }
    }
    entry.hunks = entry.hunks.filter((candidate) => candidate.id !== hunk.id);
    entry.after = { exists: true, text: document.getText() };
    if (entry.hunks.length === 0) {
      this.clearEntry(entry);
    } else {
      this.refreshReviewUi();
      const next = this.editorRanges(document, entry)[0];
      if (next) {
        editor.revealRange(next, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    }
    vscode.window.setStatusBarMessage(`Undid a Codex change in ${entry.label}`, 3_000);
  }

  async acceptFile(uri: vscode.Uri): Promise<void> {
    const entry = this.pending.get(uri.toString());
    if (!entry) {
      vscode.window.showInformationMessage("This file has no pending Codex edit.");
      return;
    }
    this.clearEntry(entry);
    vscode.window.setStatusBarMessage(`Kept Codex changes in ${entry.label}`, 3_000);
  }

  async rejectFile(uri: vscode.Uri): Promise<void> {
    const entry = this.pending.get(uri.toString());
    if (!entry) {
      vscode.window.showInformationMessage("This file has no pending Codex edit.");
      return;
    }
    if (!entry.canReject || !entry.original) {
      vscode.window.showWarningMessage(
        `The pre-edit snapshot for ${entry.label} is unavailable, so this file cannot be safely undone.`,
      );
      return;
    }

    const current = await this.readCurrentSnapshot(entry.uri, entry.after?.exists === false);
    if (!sameSnapshot(current, entry.after)) {
      const choice = await vscode.window.showWarningMessage(
        `${entry.label} changed again after Codex edited it. Undoing the file will replace those newer edits.`,
        { modal: true },
        "Undo file anyway",
      );
      if (choice !== "Undo file anyway") {
        return;
      }
    }

    await this.restoreSnapshot(entry.sourceUri, entry.original);
    this.clearEntry(entry);
    const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === entry.sourceUri.toString());
    if (document) {
      await vscode.window.showTextDocument(document, { preview: false });
    }
    vscode.window.setStatusBarMessage(`Undid Codex changes in ${entry.label}`, 3_000);
  }

  acceptAll(): void {
    const accepted = this.pendingCount;
    this.pending.clear();
    this.captureTasks.clear();
    this.refreshReviewUi();
    if (accepted > 0) {
      vscode.window.setStatusBarMessage(`Kept Codex changes in ${accepted} file${accepted === 1 ? "" : "s"}`, 3_000);
    }
  }

  private prepareOpenDocuments(): void {
    if (!this.inlineReviewEnabled) {
      return;
    }
    this.prepared.clear();
    this.latestTurnDiffs.clear();
    this.stagedKeys.clear();
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme !== "file") {
        continue;
      }
      const text = document.getText();
      const safeSize = Buffer.byteLength(text, "utf8") <= MAX_SNAPSHOT_BYTES && !text.includes("\0");
      this.prepared.set(document.uri.toString(), {
        uri: document.uri,
        snapshot: { exists: true, text },
        safeToRestore: safeSize && !document.isDirty,
        dirty: document.isDirty,
      });
    }
    this.output.appendLine(`Inline review captured ${this.prepared.size} open file snapshot(s) before the turn.`);
  }

  private handleTurnDiff(event: TurnDiffEvent): void {
    if (!this.inlineReviewEnabled) {
      return;
    }
    const files = parseAggregatedUnifiedDiff(event.diff);
    this.latestTurnDiffs.clear();
    for (const file of files) {
      const uri = this.resolveUri(file.path);
      this.latestTurnDiffs.set(uri.toString(), file);
    }
    this.output.appendLine(`Inline review received an aggregated diff for ${files.length} file(s).`);
  }

  private async handleFilePatch(event: FilePatchEvent): Promise<void> {
    if (!this.inlineReviewEnabled) {
      return;
    }
    if (event.phase === "preview") {
      await Promise.all(event.changes.map((change) => this.captureBefore(change)));
      return;
    }
    if (event.phase === "discarded") {
      for (const change of event.changes) {
        const uri = this.changeUri(change);
        const entry = this.pending.get(uri.toString());
        if (entry && !entry.applied) {
          this.pending.delete(uri.toString());
        }
      }
      return;
    }
    await Promise.all(event.changes.map((change) => this.stageAppliedChange(change)));
  }

  private async finalizeTurn(_event: TurnFinishedEvent): Promise<void> {
    if (!this.inlineReviewEnabled) {
      return;
    }
    await delay(120);
    const finalized = new Set<string>();
    for (const file of this.latestTurnDiffs.values()) {
      const entry = await this.finalizeFileDiff(file);
      if (entry) {
        finalized.add(entry.uri.toString());
        finalized.add(entry.sourceUri.toString());
      }
    }

    for (const key of this.stagedKeys) {
      const entry = this.pending.get(key);
      if (entry && !finalized.has(key)) {
        await this.finalizeStagedEntry(entry);
        finalized.add(key);
      }
    }

    // This fallback is what makes terminal-driven edits reliable for files that
    // were already open even when no fileChange item was emitted.
    for (const prepared of this.prepared.values()) {
      const key = prepared.uri.toString();
      if (finalized.has(key) || prepared.dirty) {
        continue;
      }
      const after = (await this.readSnapshot(prepared.uri)).snapshot;
      if (sameSnapshot(prepared.snapshot, after)) {
        continue;
      }
      const diff = createSyntheticDiff(prepared.snapshot.text, after.text);
      const entry = this.createOrUpdateEntry({
        uri: prepared.uri,
        sourceUri: prepared.uri,
        kind: { type: after.exists ? "update" : "delete" },
        diff,
        original: prepared.snapshot,
        after,
        canReject: prepared.safeToRestore,
      });
      entry.applied = true;
      finalized.add(key);
    }

    this.prepared.clear();
    this.latestTurnDiffs.clear();
    this.stagedKeys.clear();
    for (const [key, entry] of this.pending) {
      if (!entry.applied) {
        this.pending.delete(key);
      }
    }
    this.refreshReviewUi();
    if (finalized.size > 0) {
      this.scheduleReviewPrompt();
    }
  }

  private async finalizeFileDiff(file: UnifiedFileDiff): Promise<PendingFileChange | null> {
    const uri = this.resolveUri(file.path);
    const sourceUri = this.resolveUri(file.oldPath ?? file.path);
    const prepared = this.prepared.get(sourceUri.toString()) ?? this.prepared.get(uri.toString());
    const existing = this.pending.get(uri.toString());
    const after = (await this.readSnapshot(uri)).snapshot;
    const original = existing?.original ?? prepared?.snapshot ?? (file.kind === "add" ? { exists: false, text: "" } : null);
    if (original && sameSnapshot(original, after) && !existing?.applied) {
      this.pending.delete(uri.toString());
      return null;
    }
    const diff = file.diff || (original ? createSyntheticDiff(original.text, after.text) : "");
    const entry = this.createOrUpdateEntry({
      uri,
      sourceUri,
      kind: { type: file.kind },
      diff,
      original,
      after,
      canReject: existing?.canReject ?? prepared?.safeToRestore ?? file.kind === "add",
    });
    entry.applied = true;
    return entry;
  }

  private async finalizeStagedEntry(entry: PendingFileChange): Promise<void> {
    const capture = this.captureTasks.get(entry.uri.toString());
    if (capture) {
      await capture;
    }
    entry.after = (await this.readSnapshot(entry.uri)).snapshot;
    if (entry.original && sameSnapshot(entry.original, entry.after) && !entry.applied) {
      this.pending.delete(entry.uri.toString());
      return;
    }
    if (!entry.diff && entry.original) {
      entry.diff = createSyntheticDiff(entry.original.text, entry.after.text);
    }
    entry.hunks = parseUnifiedDiffHunks(entry.diff);
    entry.applied = true;
  }

  private async captureBefore(change: FilePatchChange): Promise<void> {
    const sourceUri = this.resolveUri(change.path);
    const uri = this.changeUri(change);
    const key = uri.toString();
    const existing = this.pending.get(key);
    if (existing) {
      if (!existing.applied) {
        existing.kind = change.kind;
        existing.diff = change.diff;
        existing.hunks = parseUnifiedDiffHunks(change.diff);
      }
      return this.captureTasks.get(key);
    }

    const prepared = this.prepared.get(sourceUri.toString()) ?? this.prepared.get(key);
    const entry = this.createOrUpdateEntry({
      uri,
      sourceUri,
      kind: change.kind,
      diff: change.diff,
      original: prepared?.snapshot ?? null,
      after: null,
      canReject: Boolean(prepared?.safeToRestore) && !change.kind.move_path,
    });
    if (entry.original) {
      return;
    }

    const task = (async () => {
      const snapshot = await this.readSnapshot(sourceUri);
      entry.original = snapshot.snapshot;
      entry.canReject = snapshot.safeToRestore && !change.kind.move_path;
    })().finally(() => this.captureTasks.delete(key));
    this.captureTasks.set(key, task);
    await task;
  }

  private async stageAppliedChange(change: FilePatchChange): Promise<void> {
    const uri = this.changeUri(change);
    const key = uri.toString();
    if (!this.pending.has(key)) {
      await this.captureBefore(change);
    }
    const entry = this.pending.get(key);
    if (!entry) {
      return;
    }
    entry.kind = change.kind;
    entry.diff = change.diff;
    entry.hunks = parseUnifiedDiffHunks(change.diff);
    entry.after = (await this.readSnapshot(uri)).snapshot;
    this.stagedKeys.add(key);
  }

  private createOrUpdateEntry(values: {
    uri: vscode.Uri;
    sourceUri: vscode.Uri;
    kind: FilePatchChange["kind"];
    diff: string;
    original: FileSnapshot | null;
    after: FileSnapshot | null;
    canReject: boolean;
  }): PendingFileChange {
    const key = values.uri.toString();
    const existing = this.pending.get(key);
    if (existing) {
      existing.sourceUri = values.sourceUri;
      existing.kind = values.kind;
      existing.diff = values.diff;
      existing.hunks = parseUnifiedDiffHunks(values.diff);
      existing.original = existing.original ?? values.original;
      existing.after = values.after;
      existing.canReject = existing.canReject || values.canReject;
      return existing;
    }
    const entry: PendingFileChange = {
      ...values,
      label: vscode.workspace.asRelativePath(values.uri, false),
      hunks: parseUnifiedDiffHunks(values.diff),
      applied: false,
    };
    this.pending.set(key, entry);
    return entry;
  }

  private changeUri(change: FilePatchChange): vscode.Uri {
    return this.resolveUri(change.kind.type === "update" && change.kind.move_path ? change.kind.move_path : change.path);
  }

  private resolveUri(filePath: string): vscode.Uri {
    if (path.isAbsolute(filePath)) {
      return vscode.Uri.file(path.normalize(filePath));
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return vscode.Uri.file(path.resolve(root ?? process.cwd(), filePath));
  }

  private async readSnapshot(uri: vscode.Uri): Promise<{ snapshot: FileSnapshot; safeToRestore: boolean }> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const safeToRestore = bytes.byteLength <= MAX_SNAPSHOT_BYTES && !bytes.includes(0);
      return {
        snapshot: { exists: true, text: Buffer.from(bytes).toString("utf8") },
        safeToRestore,
      };
    } catch (error: unknown) {
      if (isFileNotFound(error)) {
        return { snapshot: { exists: false, text: "" }, safeToRestore: true };
      }
      this.output.appendLine(`Could not snapshot ${uri.fsPath}: ${errorMessage(error)}`);
      return { snapshot: { exists: false, text: "" }, safeToRestore: false };
    }
  }

  private async readCurrentSnapshot(uri: vscode.Uri, forceDisk = false): Promise<FileSnapshot> {
    const open = !forceDisk
      ? vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString())
      : undefined;
    return open ? { exists: true, text: open.getText() } : (await this.readSnapshot(uri)).snapshot;
  }

  private async restoreSnapshot(uri: vscode.Uri, snapshot: FileSnapshot): Promise<void> {
    if (!snapshot.exists) {
      try {
        await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
      } catch (error: unknown) {
        if (!isFileNotFound(error)) {
          throw error;
        }
      }
      return;
    }

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
    const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString());
    if (document) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), snapshot.text);
      if (!(await vscode.workspace.applyEdit(edit)) || !(await document.save())) {
        throw new Error(`VS Code could not restore ${uri.fsPath}.`);
      }
    } else {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(snapshot.text, "utf8"));
    }
  }

  private reverseHunkEdit(document: vscode.TextDocument, hunk: UnifiedDiffHunk): { range: vscode.Range; replacement: string } {
    const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const current = document.getText();
    return {
      range: new vscode.Range(document.positionAt(0), document.positionAt(current.length)),
      replacement: reverseHunkInText(current, hunk, eol),
    };
  }

  private fileCodeLenses(document: vscode.TextDocument, entry: PendingFileChange): vscode.CodeLens[] {
    const anchor = new vscode.Range(0, 0, 0, 0);
    const lenses = [
      new vscode.CodeLens(anchor, {
        title: "$(check) Keep file",
        tooltip: "Keep Codex's edits in this file",
        command: "codexAgent.acceptFileChange",
        arguments: [document.uri],
      }),
    ];
    if (entry.canReject) {
      lenses.push(
        new vscode.CodeLens(anchor, {
          title: "$(discard) Undo file",
          tooltip: "Restore the file to its pre-Codex content",
          command: "codexAgent.rejectFileChange",
          arguments: [document.uri],
        }),
      );
    }
    return lenses;
  }

  private editorRanges(document: vscode.TextDocument, entry: PendingFileChange): vscode.Range[] {
    const lastLine = Math.max(0, document.lineCount - 1);
    if (entry.hunks.length > 0) {
      return entry.hunks.flatMap((hunk) => this.rangesForHunk(document, hunk));
    }
    return [new vscode.Range(document.lineAt(0).range.start, document.lineAt(lastLine).range.end)];
  }

  private rangesForHunk(document: vscode.TextDocument, hunk: UnifiedDiffHunk): vscode.Range[] {
    const lastLine = Math.max(0, document.lineCount - 1);
    const parsed = newLineRangesForHunk(hunk);
    const source = parsed.length > 0
      ? parsed
      : [{ startLine: Math.max(0, hunk.newStart - 1), endLine: Math.max(0, hunk.newStart - 1) }];
    return source.map((range) => {
      const start = Math.min(lastLine, Math.max(0, range.startLine));
      const end = Math.min(lastLine, Math.max(start, range.endLine));
      return new vscode.Range(document.lineAt(start).range.start, document.lineAt(end).range.end);
    });
  }

  private hunkAnchor(document: vscode.TextDocument, hunk: UnifiedDiffHunk): vscode.Range {
    const lastLine = Math.max(0, document.lineCount - 1);
    const first = newLineRangesForHunk(hunk)[0]?.startLine ?? Math.max(0, hunk.newStart - 1);
    const line = Math.min(lastLine, Math.max(0, first));
    return new vscode.Range(line, 0, line, 0);
  }

  private refreshReviewUi(): void {
    this.codeLensEmitter.fire();
    this.refreshVisibleEditors();
    this.updateContextKeys();
  }

  private refreshVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      const entry = this.pending.get(editor.document.uri.toString());
      if (!entry?.applied) {
        editor.setDecorations(this.changeDecoration, []);
        editor.setDecorations(this.deletionBoundaryDecoration, []);
        continue;
      }
      const ranges = this.editorRanges(editor.document, entry);
      const changeDecorations = entry.hunks.length > 0
        ? entry.hunks.flatMap((hunk) =>
            this.rangesForHunk(editor.document, hunk).map((range) => ({
              range,
              hoverMessage: this.compactReviewHover(hunk),
            })),
          )
        : ranges;
      editor.setDecorations(this.changeDecoration, changeDecorations);
      editor.setDecorations(
        this.deletionBoundaryDecoration,
        entry.hunks
          .filter((hunk) => changedLinesForHunk(hunk).removed.length > 0)
          .map((hunk) => this.hunkAnchor(editor.document, hunk)),
      );
    }
  }

  private compactReviewHover(hunk: UnifiedDiffHunk): vscode.MarkdownString {
    const changed = changedLinesForHunk(hunk);
    const body = new vscode.MarkdownString();
    body.appendMarkdown(`**Codex change** · +${changed.added.length} −${changed.removed.length}\n\n`);
    body.appendCodeblock(changedDiffLinesForHunk(hunk).join("\n"), "diff");
    body.appendMarkdown("\n\nUse **Keep** or **Undo** above this block.");
    return body;
  }

  private updateContextKeys(): void {
    const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
    const active = activeUri ? this.pending.get(activeUri) : undefined;
    void vscode.commands.executeCommand("setContext", "codexAgent.hasPendingChanges", this.pendingCount > 0);
    void vscode.commands.executeCommand("setContext", "codexAgent.activeFileHasPendingChanges", Boolean(active?.applied));
    void vscode.commands.executeCommand("setContext", "codexAgent.activeFileCanReject", Boolean(active?.applied && active.canReject));
  }

  private scheduleReviewPrompt(): void {
    if (this.reviewPromptTimer) {
      clearTimeout(this.reviewPromptTimer);
    }
    this.reviewPromptTimer = setTimeout(() => {
      this.reviewPromptTimer = undefined;
      const count = this.pendingCount;
      if (count === 0) {
        return;
      }
      const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
      const activeHasChange = Boolean(activeUri && this.pending.get(activeUri)?.applied);
      void vscode.window
        .showInformationMessage(
          activeHasChange
            ? "Codex changes are ready in the open editor. Use Keep/Undo above each block, and hover a green block to compare the previous code."
            : `Codex changed ${count} file${count === 1 ? "" : "s"}. Review the edits in the original editor?`,
          activeHasChange ? "Go to first change" : "Review inline",
          "Keep all",
        )
        .then((choice) => {
          if (choice === "Review inline") {
            void this.reviewPendingChanges();
          } else if (choice === "Go to first change" && vscode.window.activeTextEditor) {
            const entry = this.pending.get(vscode.window.activeTextEditor.document.uri.toString());
            const range = entry ? this.editorRanges(vscode.window.activeTextEditor.document, entry)[0] : undefined;
            if (range) {
              vscode.window.activeTextEditor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            }
          } else if (choice === "Keep all") {
            this.acceptAll();
          }
        });
    }, 300);
  }

  private async openEntry(entry: PendingFileChange): Promise<void> {
    if (entry.after?.exists) {
      const document = await vscode.workspace.openTextDocument(entry.uri);
      const editor = await vscode.window.showTextDocument(document, { preview: false });
      this.refreshVisibleEditors();
      const range = this.editorRanges(document, entry)[0];
      if (range) {
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Codex deleted ${entry.label}.`,
      entry.canReject ? "Restore file" : "Keep deletion",
      ...(entry.canReject ? ["Keep deletion"] : []),
    );
    if (choice === "Restore file") {
      await this.rejectFile(entry.uri);
    } else if (choice === "Keep deletion") {
      await this.acceptFile(entry.uri);
    }
  }

  private clearEntry(entry: PendingFileChange): void {
    this.pending.delete(entry.uri.toString());
    this.captureTasks.delete(entry.uri.toString());
    this.refreshReviewUi();
  }

  private get inlineReviewEnabled(): boolean {
    return vscode.workspace.getConfiguration("codexAgent").get<boolean>("inlineReview.enabled", true);
  }

  private logError(stage: string, error: unknown): void {
    this.output.appendLine(`Inline review could not process the ${stage}: ${errorMessage(error)}`);
    vscode.window.showWarningMessage(`Codex inline review could not process a ${stage}. See the Codex Agent Lab output for details.`);
  }

  dispose(): void {
    if (this.reviewPromptTimer) {
      clearTimeout(this.reviewPromptTimer);
    }
    this.service.off("filePatch", this.filePatchListener);
    this.service.off("turnPreparing", this.turnPreparingListener);
    this.service.off("turnDiff", this.turnDiffListener);
    this.service.off("turnFinished", this.turnFinishedListener);
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

function createSyntheticDiff(before: string, after: string): string {
  if (before === after) {
    return "";
  }
  const oldLines = before.split(/\r?\n/);
  const newLines = after.split(/\r?\n/);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let oldSuffix = oldLines.length;
  let newSuffix = newLines.length;
  while (oldSuffix > prefix && newSuffix > prefix && oldLines[oldSuffix - 1] === newLines[newSuffix - 1]) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }
  const removed = oldLines.slice(prefix, oldSuffix);
  const added = newLines.slice(prefix, newSuffix);
  return [
    `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join("\n");
}

function sameSnapshot(left: FileSnapshot, right: FileSnapshot | null): boolean {
  return right !== null && left.exists === right.exists && left.text === right.text;
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError
    ? error.code === "FileNotFound"
    : typeof error === "object" && error !== null && "code" in error && error.code === "FileNotFound";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
