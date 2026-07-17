import * as vscode from "vscode";
import { CodexService } from "./codexService";
import { CodexViewProvider } from "./codexViewProvider";
import { InlineDiffManager } from "./inlineDiffManager";
import { rpcErrorMessage } from "./protocol";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Codex Agent Lab", { log: true });
  const service = new CodexService(context, output);
  const provider = new CodexViewProvider(context.extensionUri, service);
  const inlineDiff = new InlineDiffManager(service, output);

  context.subscriptions.push(
    output,
    service,
    provider,
    inlineDiff,
    vscode.window.registerWebviewViewProvider(CodexViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const command = (id: string, action: (...args: unknown[]) => Promise<void> | void): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          await action(...args);
        } catch (error: unknown) {
          vscode.window.showErrorMessage(`Codex Agent Lab: ${rpcErrorMessage(error)}`);
        }
      }),
    );
  };

  command("codexAgent.open", () => provider.reveal());
  command("codexAgent.showHistory", () => provider.showHistory());
  command("codexAgent.newChat", async () => {
    await provider.reveal();
    await service.newThread();
  });
  command("codexAgent.addSelection", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error("Open a text editor and select code first.");
    }
    service.addSelectionContext(editor);
    await provider.reveal();
  });
  command("codexAgent.addFile", async (uri?: unknown) => {
    const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      throw new Error("Open a file before adding it to the chat.");
    }
    service.addFileContext(target);
    await provider.reveal();
  });
  command("codexAgent.login", () => provider.signIn());
  command("codexAgent.logout", async () => {
    const answer = await vscode.window.showWarningMessage(
      "Sign out of Codex on this machine? This clears the credentials managed by the local Codex runtime.",
      { modal: true },
      "Sign out",
    );
    if (answer === "Sign out") {
      await service.logout();
    }
  });
  command("codexAgent.stop", () => service.stop());
  command("codexAgent.reviewChanges", async () => {
    await provider.reveal();
    await service.reviewChanges();
  });
  command("codexAgent.reviewPendingChanges", () => inlineDiff.reviewPendingChanges());
  command("codexAgent.openChangedFile", async (filePath?: unknown) => {
    if (typeof filePath !== "string") {
      throw new Error("The changed file path is unavailable.");
    }
    const uri = vscode.Uri.file(filePath);
    if (!vscode.workspace.getWorkspaceFolder(uri)) {
      throw new Error("The changed file is outside the active workspace.");
    }
    await inlineDiff.openFileForReview(uri);
  });
  command("codexAgent.acceptHunk", async (uri?: unknown, hunkId?: unknown) => {
    if (!(uri instanceof vscode.Uri) || typeof hunkId !== "string") {
      throw new Error("The selected Codex change is unavailable.");
    }
    await inlineDiff.acceptHunk(uri, hunkId);
  });
  command("codexAgent.rejectHunk", async (uri?: unknown, hunkId?: unknown) => {
    if (!(uri instanceof vscode.Uri) || typeof hunkId !== "string") {
      throw new Error("The selected Codex change is unavailable.");
    }
    await inlineDiff.rejectHunk(uri, hunkId);
  });
  command("codexAgent.keepReviewThread", (thread?: unknown) => inlineDiff.keepReviewThread(thread));
  command("codexAgent.undoReviewThread", (thread?: unknown) => inlineDiff.undoReviewThread(thread));
  command("codexAgent.acceptFileChange", async (uri?: unknown) => {
    const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      throw new Error("Open a file with a pending Codex edit first.");
    }
    await inlineDiff.acceptFile(target);
  });
  command("codexAgent.rejectFileChange", async (uri?: unknown) => {
    const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      throw new Error("Open a file with a pending Codex edit first.");
    }
    await inlineDiff.rejectFile(target);
  });
  command("codexAgent.acceptAllChanges", () => inlineDiff.acceptAll());
  command("codexAgent.showStatus", async () => {
    await service.refresh();
    vscode.window.showInformationMessage(service.statusSummary());
  });
  command("codexAgent.openSettings", async () => {
    await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:local.codex-agent-lab");
  });
  command("codexAgent.openCommandMenu", async () => {
    const state = service.state;
    const items = [
      { label: "$(add) New chat", description: "/new", action: "new" },
      { label: "$(history) Previous chats", action: "history" },
      { label: "$(symbol-file) Add active file", action: "file" },
      { label: "$(selection) Add selected code", action: "selection" },
      { label: "$(inspect) Review uncommitted changes", description: "/review", action: "review" },
      { label: "$(symbol-parameter) Choose model", description: state.selectedModel, action: "model" },
      { label: "$(fold) Compact chat context", description: "/compact", action: "compact" },
      { label: "$(graph) Account and usage", description: "/status", action: "status" },
      { label: "$(settings-gear) Settings", action: "settings" },
    ];
    if (inlineDiff.pendingCount > 0) {
      items.splice(2, 0, {
        label: `$(diff-added) Review ${inlineDiff.pendingCount} pending Codex edit${inlineDiff.pendingCount === 1 ? "" : "s"}`,
        action: "pendingChanges",
      });
    }
    if (state.running) {
      items.unshift({ label: "$(debug-stop) Stop current turn", description: "/stop", action: "stop" });
    }
    if (state.account) {
      items.push({ label: "$(sign-out) Sign out", action: "logout" });
    } else {
      items.push({ label: "$(account) Sign in", action: "login" });
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: "Codex Agent commands",
      placeHolder: "Choose an action",
    });
    switch (picked?.action) {
      case "new":
        await service.newThread();
        break;
      case "file":
        await vscode.commands.executeCommand("codexAgent.addFile");
        break;
      case "history":
        await provider.showHistory();
        break;
      case "pendingChanges":
        await inlineDiff.reviewPendingChanges();
        break;
      case "selection":
        await vscode.commands.executeCommand("codexAgent.addSelection");
        break;
      case "review":
        await service.reviewChanges();
        break;
      case "model":
        await provider.pickModel();
        break;
      case "compact":
        await service.compact();
        break;
      case "status":
        await vscode.commands.executeCommand("codexAgent.showStatus");
        break;
      case "settings":
        await vscode.commands.executeCommand("codexAgent.openSettings");
        break;
      case "stop":
        await service.stop();
        break;
      case "logout":
        await vscode.commands.executeCommand("codexAgent.logout");
        break;
      case "login":
        await provider.signIn();
        break;
      default:
        break;
    }
  });

  void service.initialize().catch((error: unknown) => {
    output.appendLine(`Initialization failed: ${rpcErrorMessage(error)}`);
  });
}

export function deactivate(): void {
  // Disposables registered in activate handle shutdown.
}
