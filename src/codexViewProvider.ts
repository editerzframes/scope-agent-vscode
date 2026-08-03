import * as vscode from "vscode";
import { CodexService, PublicState, UiTurnProgress } from "./codexService";
import {
  buildClickUpFixPrompt,
  buildClickUpSummaryPrompt,
  parseClickUpActionTicket,
} from "./clickUpActions";
import { isSafeClickUpTicketUrl, isSafeExternalUrl } from "./externalUrls";
import { isRecord, rpcErrorMessage } from "./protocol";

export class CodexViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "puneet2.chat";
  private view: vscode.WebviewView | undefined;
  private readonly statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private wasRunning = false;
  private completionTimer: NodeJS.Timeout | undefined;

  private readonly stateListener = (state: PublicState): void => {
    if (this.view) {
      this.view.title = collaborationModeTitle(state.collaborationMode);
    }
    void this.view?.webview.postMessage({ type: "state", state });
    this.updateNativeProgress(state);
  };

  private readonly deltaListener = (delta: {
    id: string;
    delta: string;
    kind: "message" | "plan" | "clickup";
  }): void => {
    void this.view?.webview.postMessage({ type: "delta", ...delta });
  };

  private readonly progressListener = (progress: UiTurnProgress): void => {
    void this.view?.webview.postMessage({ type: "progress", progress });
    this.updateNativeProgress(this.service.state);
  };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: CodexService,
  ) {
    this.statusBar.command = "puneet2.open";
    this.statusBar.name = "Puneet 3.0 task status";
    this.service.on("state", this.stateListener);
    this.service.on("delta", this.deltaListener);
    this.service.on("progress", this.progressListener);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.title = collaborationModeTitle(this.service.state.collaborationMode);
    this.updateNativeProgress(this.service.state);
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = this.getHtml(view.webview);
    view.webview.onDidReceiveMessage((message: unknown) => void this.handleMessage(message));
    void this.service.initialize().catch((error: unknown) => {
      vscode.window.showErrorMessage(`Puneet 3.0: ${rpcErrorMessage(error)}`);
    });
  }

  private updateNativeProgress(state: PublicState): void {
    const progress = state.turnProgress;
    const running = progress.status === "running";
    if (this.view) {
      this.view.badge = running
        ? { value: 1, tooltip: `Puneet 3.0 is working: ${progress.label}` }
        : undefined;
    }

    if (running) {
      if (this.completionTimer) {
        clearTimeout(this.completionTimer);
        this.completionTimer = undefined;
      }
      this.statusBar.text = `$(sync~spin) Puneet 3.0: ${shorten(progress.label, 38)}`;
      this.statusBar.tooltip = `${progress.detail}\nClick to open Puneet 3.0.`;
      this.statusBar.show();
    } else if (this.wasRunning) {
      const succeeded = progress.status === "completed";
      this.statusBar.text = succeeded ? "$(check) Puneet 3.0: Task finished" : "$(circle-slash) Puneet 3.0: Task stopped";
      this.statusBar.tooltip = `${progress.label}: ${progress.detail}\nClick to open Puneet 3.0.`;
      this.statusBar.show();
      this.completionTimer = setTimeout(() => this.statusBar.hide(), 10_000);

      if (!this.view?.visible) {
        const message = succeeded ? "Puneet 3.0 finished the task." : `Puneet 3.0 stopped: ${progress.label}.`;
        void vscode.window.showInformationMessage(message, "Open Puneet 3.0").then((choice) => {
          if (choice === "Open Puneet 3.0") {
            void this.reveal();
          }
        });
      }
    }
    this.wasRunning = running;
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand("workbench.view.extension.puneet2");
    await vscode.commands.executeCommand(`${CodexViewProvider.viewType}.focus`);
  }

  async showHistory(): Promise<void> {
    await this.reveal();
    await this.service.refreshThreads();
    await this.view?.webview.postMessage({ type: "openHistory" });
  }

  async pickModel(): Promise<void> {
    const state = this.service.state;
    if (!state.models.length) {
      vscode.window.showInformationMessage("No Codex models are currently available for this account.");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      state.models.map((model) => ({
        label: model.label,
        description: model.model,
        detail: model.description,
        model: model.model,
      })),
      {
        title: "Choose a Codex model",
        placeHolder: state.selectedModel || "Server default",
      },
    );
    if (picked) {
      await this.service.setModel(picked.model);
    }
  }

  async pickCollaborationMode(): Promise<void> {
    const state = this.service.state;
    if (state.running) {
      vscode.window.showInformationMessage("Wait for the current task to finish before changing modes.");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      [
        {
          label: "$(sparkle) Agent",
          description: state.collaborationMode === "agent" ? "Current" : undefined,
          detail: "Inspect the workspace, run commands, and make code changes.",
          mode: "agent" as const,
        },
        {
          label: "$(map) Plan",
          description: state.collaborationMode === "plan" ? "Current" : undefined,
          detail: "Inspect the workspace and propose a plan without making code changes.",
          mode: "plan" as const,
        },
        {
          label: "$(book) TAD",
          description: state.collaborationMode === "tad" ? "Current" : undefined,
          detail: "Turn the current plan and repository context into a Technical Architecture Document.",
          mode: "tad" as const,
        },
        {
          label: "$(issues) ClickUp",
          description: state.collaborationMode === "clickup" ? "Current" : undefined,
          detail: "Fetch your incomplete assigned ClickUp tickets using the read-only ClickUp skill.",
          mode: "clickup" as const,
        },
      ],
      {
        title: "Choose how Puneet 3.0 handles the next request",
        placeHolder: `${collaborationModeTitle(state.collaborationMode)} mode`,
      },
    );
    if (picked) {
      await this.service.setCollaborationMode(picked.mode);
      if (picked.mode === "clickup") {
        await this.service.fetchMyClickUpTickets();
      }
    }
  }

  async signIn(): Promise<void> {
    const method = await vscode.window.showQuickPick(
      [
        {
          label: "Sign in with ChatGPT",
          description: "Use your ChatGPT plan and Codex limits",
          value: "chatgpt",
        },
        {
          label: "Use an API key",
          description: "Use usage-based OpenAI Platform billing",
          value: "apiKey",
        },
      ],
      { title: "Sign in to Codex" },
    );
    if (!method) {
      return;
    }
    if (method.value === "chatgpt") {
      await this.service.loginWithChatGpt();
    } else {
      await this.promptForApiKey();
    }
  }

  private async promptForApiKey(): Promise<void> {
    const apiKey = await vscode.window.showInputBox({
      title: "Use an OpenAI API key",
      prompt: "The key is sent directly to the local Codex process and is not stored by this extension.",
      placeHolder: "sk-…",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : "Enter an API key."),
    });
    if (apiKey) {
      await this.service.loginWithApiKey(apiKey.trim());
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isRecord(message) || typeof message.type !== "string") {
      return;
    }
    try {
      switch (message.type) {
        case "ready":
          await this.view?.webview.postMessage({ type: "state", state: this.service.state });
          break;
        case "loginChatGPT":
          await this.service.loginWithChatGpt();
          break;
        case "loginApiKey":
          await this.promptForApiKey();
          break;
        case "logout":
          await vscode.commands.executeCommand("puneet2.logout");
          break;
        case "refresh":
          await this.service.refresh();
          break;
        case "newThread":
          await this.service.newThread();
          break;
        case "refreshThreads":
          await this.service.refreshThreads();
          break;
        case "openThread":
          if (typeof message.threadId === "string") {
            await this.service.openThread(message.threadId);
          }
          break;
        case "openChangedFile":
          if (typeof message.path === "string") {
            await vscode.commands.executeCommand("puneet2.openChangedFile", message.path);
          }
          break;
        case "openDocumentFile":
          if (typeof message.path === "string") {
            await this.service.openDocumentFile(message.path);
          }
          break;
        case "openClickUpTicket":
          if (!isSafeClickUpTicketUrl(message.url)) {
            throw new Error("This ClickUp ticket link is not allowed.");
          }
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
          break;
        case "openExternalLink":
          if (!isSafeExternalUrl(message.url)) {
            throw new Error("This external link is not allowed.");
          }
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
          break;
        case "summarizeClickUpTicket": {
          const ticket = parseClickUpActionTicket(message.ticket);
          if (!ticket) {
            throw new Error("The selected ClickUp ticket is invalid.");
          }
          await this.service.sendPrompt(buildClickUpSummaryPrompt(ticket));
          break;
        }
        case "fixClickUpTicket": {
          const ticket = parseClickUpActionTicket(message.ticket);
          if (!ticket) {
            throw new Error("The selected ClickUp ticket is invalid.");
          }
          await this.service.setCollaborationMode("agent");
          await this.service.sendPrompt(buildClickUpFixPrompt(ticket));
          break;
        }
        case "answerQuestion":
          if (typeof message.questionId === "string") {
            this.service.answerUserInput(
              message.questionId,
              message.answer,
              message.custom === true,
            );
          }
          break;
        case "openPlans":
          await this.service.revealPlansFolder();
          break;
        case "openTads":
          await this.service.revealTadsFolder();
          break;
        case "stop":
          await this.service.stop();
          break;
        case "sendPrompt":
          if (typeof message.prompt === "string") {
            await this.handlePrompt(message.prompt);
          }
          break;
        case "setModel":
          if (typeof message.model === "string") {
            await this.service.setModel(message.model);
          }
          break;
        case "setCollaborationMode":
          if (
            message.mode === "agent" ||
            message.mode === "plan" ||
            message.mode === "tad" ||
            message.mode === "clickup"
          ) {
            await this.service.setCollaborationMode(message.mode);
          }
          break;
        case "activateClickUp":
          await this.service.setCollaborationMode("clickup");
          await this.service.fetchMyClickUpTickets();
          break;
        case "removeContext":
          if (typeof message.id === "string") {
            this.service.removeContext(message.id);
          }
          break;
        case "addActiveFile":
          await vscode.commands.executeCommand("puneet2.addFile");
          break;
        case "addSelection":
          await vscode.commands.executeCommand("puneet2.addSelection");
          break;
        case "openCommandMenu":
          await vscode.commands.executeCommand("puneet2.openCommandMenu");
          break;
        case "openSettings":
          await vscode.commands.executeCommand("puneet2.openSettings");
          break;
        default:
          break;
      }
    } catch (error: unknown) {
      vscode.window.showErrorMessage(`Puneet 3.0: ${rpcErrorMessage(error)}`);
      await this.view?.webview.postMessage({ type: "actionError", message: rpcErrorMessage(error) });
    }
  }

  private async handlePrompt(prompt: string): Promise<void> {
    const command = prompt.trim();
    switch (command) {
      case "/new":
        await this.service.newThread();
        return;
      case "/stop":
        await this.service.stop();
        return;
      case "/status":
        vscode.window.showInformationMessage(this.service.statusSummary());
        return;
      case "/compact":
        await this.service.compact();
        return;
      case "/review":
        await this.service.reviewChanges();
        return;
      case "/model":
        await this.pickModel();
        return;
      case "/init":
        await this.service.sendPrompt(
          "Create an AGENTS.md file for this repository. Inspect the project first and include concise build, test, style, and verification guidance for future coding agents.",
        );
        return;
      case "/help":
        await vscode.commands.executeCommand("puneet2.openCommandMenu");
        return;
      default:
        await this.service.sendPrompt(prompt);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "main.css"));
    const clickUpPayloadUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "clickupPayload.js"),
    );
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "main.js"));
    const brandUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "puneet-2-icon.png"));
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Puneet 3.0</title>
  </head>
  <body>
    <main id="root" aria-live="polite">
      <section id="loading" class="centered">
        <div class="spinner" aria-hidden="true"></div>
        <p>Starting local Codex…</p>
      </section>

      <section id="signed-out" class="landing landing-auth hidden">
        <div class="landing-aura" aria-hidden="true"></div>
        <div class="auth-shell">
          <div class="brand-lockup">
            <img class="puneet-logo" src="${brandUri}" alt="" />
            <div>
              <strong>Puneet 3.0</strong>
              <span>AI coding agent</span>
            </div>
          </div>

          <div class="landing-heading">
            <span class="eyebrow">LOCAL AGENT WORKSPACE</span>
            <h1>Build with your codebase in view.</h1>
            <p>Plan changes, edit files, run commands, and review the result without leaving VS Code.</p>
          </div>

          <div class="auth-actions">
            <button id="login-chatgpt" class="auth-button primary">
              <span>Continue with ChatGPT</span>
              <span class="button-arrow" aria-hidden="true">→</span>
            </button>
            <button id="login-api-key" class="auth-button secondary">
              <span>Use an API key</span>
              <span class="button-arrow" aria-hidden="true">→</span>
            </button>
          </div>

          <div class="trust-row" aria-label="Puneet 3.0 capabilities">
            <span><i aria-hidden="true">✓</i> Workspace-aware</span>
            <span><i aria-hidden="true">✓</i> Approval-first</span>
            <span><i aria-hidden="true">✓</i> Inline review</span>
          </div>

          <p class="runtime-note">
            <span class="runtime-dot" aria-hidden="true"></span>
            Authentication is handled by your local Codex runtime.
          </p>
        </div>
      </section>

      <section id="app" class="app hidden">
        <header class="topbar">
          <button id="account-button" class="account-button" title="Refresh account and usage">
            <span id="connection-dot" class="connection-dot"></span>
            <span id="account-label">Codex</span>
            <span id="top-run-label" class="top-run-label hidden"></span>
          </button>
          <div class="topbar-actions">
            <button id="history-button" class="icon-button" title="Previous chats" aria-label="Previous chats">◷</button>
            <button id="new-chat" class="icon-button" title="New chat" aria-label="New chat">＋</button>
            <button id="command-menu" class="icon-button" title="Commands" aria-label="Open command menu">⌘</button>
          </div>
        </header>

        <aside id="history-panel" class="history-panel hidden" aria-label="Previous chats">
          <div class="history-header">
            <div>
              <strong>Previous chats</strong>
              <span>Chats from this workspace</span>
            </div>
            <button id="history-close" class="icon-button" title="Close history" aria-label="Close history">×</button>
          </div>
          <button id="history-new-chat" class="history-new-chat">＋ New chat</button>
          <div id="history-list" class="history-list"></div>
        </aside>

        <div id="error-banner" class="banner error hidden"></div>
        <div id="workspace-banner" class="banner warning hidden">Open a local folder to let Codex inspect and edit code.</div>
        <section id="limits" class="limits hidden" aria-label="Usage limits"></section>

        <section id="empty-state" class="landing landing-home">
          <div class="landing-aura" aria-hidden="true"></div>
          <div class="home-shell">
            <div class="workspace-pill">
              <span class="workspace-ready-dot" aria-hidden="true"></span>
              <span><span id="landing-workspace-prefix">Ready in </span><strong id="landing-workspace">this workspace</strong></span>
            </div>

            <div class="home-hero">
              <img class="puneet-logo compact" src="${brandUri}" alt="" />
              <h2>What would you like to build?</h2>
              <p>Describe the outcome you want, or start with one of these focused actions.</p>
            </div>

            <div class="suggestions" aria-label="Starter actions">
              <button data-prompt="Explain this repository and its architecture.">
                <span class="suggestion-icon" aria-hidden="true">◎</span>
                <span class="suggestion-copy">
                  <strong>Understand this project</strong>
                  <small>Map the architecture and important files</small>
                </span>
                <span class="suggestion-arrow" aria-hidden="true">›</span>
              </button>
              <button data-prompt="Find a useful improvement, implement it, and verify the result.">
                <span class="suggestion-icon" aria-hidden="true">↗</span>
                <span class="suggestion-copy">
                  <strong>Improve something</strong>
                  <small>Find, implement, and verify a useful change</small>
                </span>
                <span class="suggestion-arrow" aria-hidden="true">›</span>
              </button>
              <button data-command="review">
                <span class="suggestion-icon" aria-hidden="true">±</span>
                <span class="suggestion-copy">
                  <strong>Review current changes</strong>
                  <small>Inspect the edits already in this workspace</small>
                </span>
                <span class="suggestion-arrow" aria-hidden="true">›</span>
              </button>
            </div>
          </div>
        </section>

        <section id="transcript" class="transcript" aria-label="Puneet 3.0 conversation"></section>
        <section id="activities" class="activities hidden" aria-label="Agent activity"></section>
        <section id="run-status" class="run-status hidden" role="status" aria-live="polite">
          <div class="run-status-main">
            <span id="run-status-icon" class="run-status-icon" aria-hidden="true"></span>
            <div class="run-status-copy">
              <strong id="run-status-label">Puneet 3.0 is working</strong>
              <span id="run-status-detail">The task is still running.</span>
            </div>
            <time id="run-status-time">0:00</time>
          </div>
          <div id="run-status-heartbeat" class="run-status-heartbeat"></div>
          <div class="run-progress-track" aria-hidden="true"><span></span></div>
        </section>

        <footer class="composer-shell">
          <div id="contexts" class="contexts hidden"></div>
          <div class="composer">
            <textarea id="prompt" rows="1" placeholder="Ask Puneet 3.0 to change your code…" aria-label="Prompt"></textarea>
            <div class="composer-toolbar">
              <div class="composer-left">
                <button id="add-file" class="tool-button" title="Add active file">＋ File</button>
                <button id="add-selection" class="tool-button" title="Add selected code">Selection</button>
              </div>
              <div class="composer-right">
                <label id="mode-picker" class="mode-picker" title="Choose how Puneet 3.0 handles the next request">
                  <span id="mode-icon" class="mode-icon" aria-hidden="true">◆</span>
                  <select id="collaboration-mode" aria-label="Collaboration mode">
                    <option value="agent">Agent</option>
                    <option value="plan">Plan</option>
                    <option value="tad">TAD</option>
                    <option value="clickup">ClickUp</option>
                  </select>
                </label>
                <select id="model" title="Model" aria-label="Codex model"></select>
                <button id="stop" class="stop-button hidden" title="Stop current turn" aria-label="Stop">■</button>
                <button id="send" class="send-button" title="Send" aria-label="Send">↑</button>
              </div>
            </div>
          </div>
          <div class="footer-row">
            <span id="workspace-name"></span>
            <div class="footer-actions">
              <button id="plans" class="link-button">Plans</button>
              <button id="tads" class="link-button">TADs</button>
              <button id="settings" class="link-button">Settings</button>
            </div>
          </div>
        </footer>
      </section>
    </main>
    <script nonce="${nonce}" src="${clickUpPayloadUri}"></script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  dispose(): void {
    if (this.completionTimer) {
      clearTimeout(this.completionTimer);
    }
    this.statusBar.dispose();
    this.service.off("state", this.stateListener);
    this.service.off("delta", this.deltaListener);
    this.service.off("progress", this.progressListener);
  }
}

function collaborationModeTitle(mode: PublicState["collaborationMode"]): string {
  return mode === "clickup" ? "ClickUp" : mode === "tad" ? "TAD" : mode === "plan" ? "Plan" : "Agent";
}

function shorten(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function getNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}
