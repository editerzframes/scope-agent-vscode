import * as vscode from "vscode";
import { CodexService, PublicState } from "./codexService";

export class SelectionChatCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly codeLensEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidChangeCodeLenses = this.codeLensEmitter.event;

  private readonly stateListener = (_state: PublicState): void => {
    this.codeLensEmitter.fire();
  };

  constructor(private readonly service: CodexService) {
    this.service.on("state", this.stateListener);
    this.disposables.push(
      vscode.languages.registerCodeLensProvider([{ scheme: "file" }, { scheme: "untitled" }], this),
      vscode.window.onDidChangeTextEditorSelection(() => this.codeLensEmitter.fire()),
      vscode.window.onDidChangeActiveTextEditor(() => this.codeLensEmitter.fire()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("codexAgent.selectionAction.enabled")) {
          this.codeLensEmitter.fire();
        }
      }),
      this.codeLensEmitter,
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration("codexAgent").get<boolean>("selectionAction.enabled", true)) {
      return [];
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== document.uri.toString() || editor.selection.isEmpty) {
      return [];
    }

    const selection = new vscode.Range(editor.selection.start, editor.selection.end);
    if (this.isAlreadyAttached(document, selection)) {
      return [];
    }

    const anchor = new vscode.Range(selection.start.line, 0, selection.start.line, 0);
    return [
      new vscode.CodeLens(anchor, {
        title: "$(comment-discussion) Add to Chat",
        tooltip: "Attach this selected code to SCOPE",
        command: "codexAgent.addSelection",
        arguments: [document.uri, selection],
      }),
    ];
  }

  dispose(): void {
    this.service.off("state", this.stateListener);
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private isAlreadyAttached(document: vscode.TextDocument, selection: vscode.Range): boolean {
    const sourcePath = document.uri.fsPath || document.uri.toString();
    const sourceRange = `lines ${selection.start.line + 1}-${selection.end.line + 1}`;
    const sourceText = document.getText(selection);
    return this.service.state.contexts.some(
      (context) =>
        context.kind === "selection" &&
        context.path === sourcePath &&
        context.range === sourceRange &&
        context.text === sourceText,
    );
  }
}
