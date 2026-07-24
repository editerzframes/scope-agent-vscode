import { EventEmitter } from "node:events";
import { basename, isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { CodexAppServer, ServerRequestEvent } from "./codexAppServer";
import {
  buildCodexCollaborationMode,
  CollaborationModeSelection,
  normalizeCollaborationMode,
} from "./collaborationMode";
import {
  normalizeUiQuestionAnswer,
  parseUiQuestions,
  UiQuestion,
} from "./chatQuestions";
import {
  attachClickUpSkill,
  contentInvokesClickUp,
  FETCH_MY_CLICKUP_TICKETS_PROMPT,
} from "./clickUpMode";
import {
  buildUserInputs,
  clampPercent,
  isRecord,
  PromptContext,
  RpcNotification,
  RpcId,
  rpcErrorMessage,
} from "./protocol";
import {
  buildPlanFilename,
  buildPlanMarkdown,
  DEFAULT_PLAN_DIRECTORY,
  normalizePlanDirectory,
  planTitleFromPrompt,
} from "./planFiles";
import {
  buildTadFilename,
  buildTadMarkdown,
  DEFAULT_TAD_DIRECTORY,
  normalizeTadDirectory,
  tadTitleFromPrompt,
} from "./tadFiles";
import { attachTadSkill, contentInvokesTad } from "./tadMode";
import { countUnifiedDiffLines, parseAggregatedUnifiedDiff } from "./turnDiff";

interface ChatGptAccount {
  type: "chatgpt";
  email: string | null;
  planType: string;
}

interface ApiKeyAccount {
  type: "apiKey";
}

interface OtherAccount {
  type: string;
  [key: string]: unknown;
}

type Account = ChatGptAccount | ApiKeyAccount | OtherAccount;

interface AccountReadResponse {
  account: Account | null;
  requiresOpenaiAuth: boolean;
}

interface LoginResponse {
  type: "apiKey" | "chatgpt" | "chatgptDeviceCode" | "chatgptAuthTokens";
  loginId?: string;
  authUrl?: string;
  verificationUrl?: string;
  userCode?: string;
}

interface ModelInfo {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  hidden: boolean;
}

interface ModelListResponse {
  data: ModelInfo[];
  nextCursor: string | null;
}

interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

interface RateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  planType: string | null;
  rateLimitReachedType: string | null;
}

interface RateLimitsResponse {
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId: Record<string, RateLimitSnapshot> | null;
}

interface McpServerStatus {
  name: string;
  tools?: Record<string, unknown>;
  authStatus?: "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth";
}

interface McpServerStatusResponse {
  data: McpServerStatus[];
  nextCursor: string | null;
}

interface ThreadItem {
  type: string;
  id: string;
  [key: string]: unknown;
}

interface Turn {
  id: string;
  status: string;
  items: ThreadItem[];
  error: { message?: string } | null;
  durationMs?: number | null;
}

interface Thread {
  id: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  status: { type: string; [key: string]: unknown };
  cwd: string;
  name: string | null;
  turns: Turn[];
}

interface ThreadResponse {
  thread: Thread;
}

interface ThreadListResponse {
  data: Thread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

interface TurnResponse {
  turn: Turn;
  reviewThreadId?: string;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  kind?: "message" | "plan" | "tad" | "clickup";
  documentPath?: string;
  documentLabel?: string;
}

interface StoredDocumentFile {
  path: string;
  label: string;
  title: string;
}

export interface UiActivity {
  id: string;
  kind: "command" | "file" | "tool" | "search" | "agent" | "other";
  label: string;
  detail: string;
  status: "running" | "completed" | "failed";
}

export interface UiFileChange {
  id: string;
  path: string;
  label: string;
  kind: "add" | "delete" | "update";
  status: "running" | "completed" | "failed";
  diff: string;
  added: number;
  deleted: number;
}

export interface UiRateLimit {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt: number | null;
  window: "primary" | "secondary";
}

export interface UiTurnProgress {
  status: "idle" | "running" | "completed" | "failed" | "interrupted";
  label: string;
  detail: string;
  startedAtMs: number | null;
  lastProgressAtMs: number | null;
  completedAtMs: number | null;
  durationMs: number | null;
}

export interface UiThreadSummary {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  active: boolean;
  running: boolean;
}

export interface FilePatchChange {
  path: string;
  kind: {
    type: "add" | "delete" | "update";
    move_path?: string | null;
  };
  diff: string;
}

export interface FilePatchEvent {
  phase: "preview" | "applied" | "discarded";
  threadId: string;
  turnId: string;
  itemId: string;
  changes: FilePatchChange[];
}

export interface TurnDiffEvent {
  threadId: string;
  turnId: string;
  diff: string;
}

export interface TurnFinishedEvent {
  threadId: string | null;
  turnId: string | null;
  status: "completed" | "failed" | "interrupted";
}

export interface PublicState {
  connection: "idle" | "starting" | "ready" | "error";
  executable: string;
  workspaceName: string | null;
  requiresOpenaiAuth: boolean;
  account: {
    type: string;
    label: string;
    plan: string | null;
  } | null;
  limits: UiRateLimit[];
  models: Array<{
    model: string;
    label: string;
    description: string;
  }>;
  selectedModel: string;
  collaborationMode: CollaborationModeSelection;
  threadId: string | null;
  turnId: string | null;
  running: boolean;
  turnProgress: UiTurnProgress;
  threads: UiThreadSummary[];
  messages: UiMessage[];
  fileChanges: UiFileChange[];
  activities: UiActivity[];
  pendingQuestions: UiQuestion[];
  contexts: PromptContext[];
  error: string | null;
}

const LAST_THREAD_KEY = "puneet2.lastThreadId";
const SELECTED_MODEL_KEY = "puneet2.selectedModel";
const COLLABORATION_MODE_KEY = "puneet2.collaborationMode";
const PLAN_FILES_KEY = "puneet2.planFiles";
const TAD_FILES_KEY = "puneet2.tadFiles";
const MAX_UI_DIFF_CHARS = 120_000;

interface PendingUserInputRequest {
  requestId: RpcId;
  questions: UiQuestion[];
  answers: Record<string, { answers: string[] }>;
}

export class CodexService extends EventEmitter implements vscode.Disposable {
  private readonly server: CodexAppServer;
  private connection: PublicState["connection"] = "idle";
  private account: Account | null = null;
  private requiresOpenaiAuth = true;
  private rateLimits: RateLimitsResponse | null = null;
  private models: ModelInfo[] = [];
  private selectedModel = "";
  private collaborationMode: CollaborationModeSelection = "agent";
  private threadId: string | null = null;
  private turnId: string | null = null;
  private turnProgress: UiTurnProgress = createIdleTurnProgress();
  private threads: UiThreadSummary[] = [];
  private messages: UiMessage[] = [];
  private fileChanges: UiFileChange[] = [];
  private activities: UiActivity[] = [];
  private pendingUserInput: PendingUserInputRequest | null = null;
  private contexts: PromptContext[] = [];
  private planFiles: Record<string, StoredDocumentFile> = {};
  private tadFiles: Record<string, StoredDocumentFile> = {};
  private error: string | null = null;
  private initializing: Promise<void> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {
    super();
    this.server = new CodexAppServer(this.workspaceFolder?.uri.fsPath);
    this.selectedModel =
      vscode.workspace.getConfiguration("puneet2").get<string>("model", "").trim() ||
      this.context.workspaceState.get<string>(SELECTED_MODEL_KEY, "");
    this.collaborationMode = normalizeCollaborationMode(
      this.context.workspaceState.get<string>(COLLABORATION_MODE_KEY),
    );
    this.planFiles = {
      ...(this.context.workspaceState.get<Record<string, StoredDocumentFile>>(PLAN_FILES_KEY) ?? {}),
    };
    this.tadFiles = {
      ...(this.context.workspaceState.get<Record<string, StoredDocumentFile>>(TAD_FILES_KEY) ?? {}),
    };

    this.server.on("notification", (message: RpcNotification) => this.handleNotification(message));
    this.server.on("serverRequest", (request: ServerRequestEvent) => void this.handleServerRequest(request));
    this.server.on("log", (text: string) => this.output.append(text));
    this.server.on("exit", ({ message }: { message: string }) => {
      this.connection = "error";
      this.error = message;
      this.turnId = null;
      this.pendingUserInput = null;
      this.finishTurn("failed", undefined, "Codex runtime stopped", message);
      this.emitState();
    });
  }

  get state(): PublicState {
    return {
      connection: this.connection,
      executable: this.server.executablePath,
      workspaceName: this.workspaceFolder?.name ?? null,
      requiresOpenaiAuth: this.requiresOpenaiAuth,
      account: this.toUiAccount(),
      limits: this.toUiRateLimits(),
      models: this.models.map((model) => ({
        model: model.model,
        label: model.displayName,
        description: model.description,
      })),
      selectedModel: this.selectedModel,
      collaborationMode: this.collaborationMode,
      threadId: this.threadId,
      turnId: this.turnId,
      running: this.turnProgress.status === "running",
      turnProgress: { ...this.turnProgress },
      threads: this.threads.map((thread) => ({ ...thread })),
      messages: this.messages.map((message) => ({ ...message })),
      fileChanges: this.fileChanges.map((change) => ({ ...change })),
      activities: this.activities.map((activity) => ({ ...activity })),
      pendingQuestions: (this.pendingUserInput?.questions ?? []).map((question) => ({
        ...question,
        options: question.options.map((option) => ({ ...option })),
      })),
      contexts: this.contexts.map((context) => ({ ...context })),
      error: this.error,
    };
  }

  private get workspaceFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
  }

  initialize(): Promise<void> {
    if (!this.initializing) {
      this.initializing = this.doInitialize().catch((error: unknown) => {
        this.initializing = undefined;
        this.connection = "error";
        this.error = rpcErrorMessage(error);
        this.emitState();
        throw error;
      });
    }
    return this.initializing;
  }

  private async doInitialize(): Promise<void> {
    this.connection = "starting";
    this.error = null;
    this.emitState();
    await this.server.start();
    await this.refreshAccount();

    if (!this.requiresOpenaiAuth || this.account) {
      await Promise.allSettled([this.refreshRateLimits(), this.loadModels()]);
      await this.restoreLastThread();
      await this.loadThreads();
    }

    this.connection = "ready";
    this.error = null;
    this.emitState();
  }

  async loginWithChatGpt(): Promise<void> {
    await this.initialize();
    const response = await this.server.request<LoginResponse>("account/login/start", {
      type: "chatgpt",
      codexStreamlinedLogin: true,
      useHostedLoginSuccessPage: true,
    });
    if (!response.authUrl) {
      throw new Error("Codex did not return a ChatGPT sign-in URL.");
    }
    await vscode.env.openExternal(vscode.Uri.parse(response.authUrl));
    vscode.window.showInformationMessage("Finish signing in to ChatGPT in your browser, then return to VS Code.");
  }

  async loginWithApiKey(apiKey: string): Promise<void> {
    await this.initialize();
    await this.server.request<LoginResponse>("account/login/start", {
      type: "apiKey",
      apiKey,
    });
    await this.refreshAfterLogin();
  }

  async logout(): Promise<void> {
    await this.initialize();
    await this.server.request("account/logout");
    this.account = null;
    this.rateLimits = null;
    this.models = [];
    this.threadId = null;
    this.turnId = null;
    this.pendingUserInput = null;
    this.turnProgress = createIdleTurnProgress();
    this.threads = [];
    this.messages = [];
    this.fileChanges = [];
    this.activities = [];
    await this.context.workspaceState.update(LAST_THREAD_KEY, undefined);
    this.emitState();
  }

  async refresh(): Promise<void> {
    await this.initialize();
    await this.refreshAccount();
    if (!this.requiresOpenaiAuth || this.account) {
      await Promise.allSettled([this.refreshRateLimits(), this.loadModels(), this.loadThreads()]);
    }
    this.emitState();
  }

  async refreshThreads(): Promise<void> {
    await this.initialize();
    await this.loadThreads();
    this.emitState();
  }

  async openThread(threadId: string): Promise<void> {
    await this.ensureCanRun();
    if (this.turnId && threadId !== this.threadId) {
      throw new Error("Stop the current task before opening another chat.");
    }
    if (threadId === this.threadId) {
      return;
    }

    const response = await this.server.request<ThreadResponse>("thread/resume", {
      threadId,
      cwd: this.workspaceFolder?.uri.fsPath ?? null,
      model: this.selectedModel || null,
      approvalPolicy: this.approvalPolicy,
      sandbox: this.sandbox,
    });
    this.threadId = response.thread.id;
    this.turnId = null;
    this.pendingUserInput = null;
    this.turnProgress = createIdleTurnProgress();
    this.contexts = [];
    this.error = null;
    this.hydrateHistory(response.thread);
    await this.context.workspaceState.update(LAST_THREAD_KEY, this.threadId);
    await this.loadThreads();
    this.emitState();
  }

  async newThread(): Promise<void> {
    await this.ensureCanRun();
    if (this.turnId && this.threadId) {
      await this.stop();
    }

    this.threadId = null;
    this.turnId = null;
    this.pendingUserInput = null;
    this.turnProgress = createIdleTurnProgress();
    this.messages = [];
    this.fileChanges = [];
    this.activities = [];
    this.error = null;
    await this.context.workspaceState.update(LAST_THREAD_KEY, undefined);
    this.emitState();

    const response = await this.server.request<ThreadResponse>("thread/start", {
      model: this.selectedModel || null,
      cwd: this.workspaceFolder?.uri.fsPath ?? null,
      approvalPolicy: this.approvalPolicy,
      sandbox: this.sandbox,
      sessionStartSource: "clear",
      threadSource: "puneet2_vscode",
    });
    this.threadId = response.thread.id;
    await this.context.workspaceState.update(LAST_THREAD_KEY, this.threadId);
    await this.loadThreads();
    this.emitState();
  }

  async sendPrompt(prompt: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }
    await this.ensureCanRun();
    if (!this.threadId) {
      await this.newThread();
    }

    let input = buildUserInputs(trimmed, this.contexts);
    if (this.collaborationMode === "tad") {
      input = attachTadSkill(
        input,
        vscode.Uri.joinPath(this.context.extensionUri, "skills", "tad", "SKILL.md").fsPath,
      );
    } else if (this.collaborationMode === "clickup") {
      input = attachClickUpSkill(
        input,
        vscode.Uri.joinPath(
          this.context.extensionUri,
          "skills",
          "clickup-my-tickets",
          "SKILL.md",
        ).fsPath,
      );
    }
    this.contexts = [];
    this.messages.push({ id: randomUUID(), role: "user", text: trimmed });
    this.error = null;

    if (this.turnId) {
      this.updateTurnProgress("Applying your follow-up", "Steering the active task with your latest message.");
      this.emitState();
      await this.server.request("turn/steer", {
        threadId: this.threadId,
        expectedTurnId: this.turnId,
        input,
      });
      return;
    }

    this.activities = [];
    this.fileChanges = [];
    this.emit("turnPreparing", { threadId: this.threadId });
    this.beginTurn(
      this.collaborationMode === "clickup"
        ? "Fetching ClickUp tickets"
        : this.collaborationMode === "tad"
        ? "Starting a TAD"
        : this.collaborationMode === "plan"
          ? "Starting a plan"
          : "Starting task",
      this.collaborationMode === "clickup"
        ? "Attaching the read-only ClickUp skill and searching for tickets assigned to you."
        : this.collaborationMode === "tad"
        ? "Attaching the TAD skill and preparing the current plan and workspace context."
        : this.collaborationMode === "plan"
          ? "Preparing the workspace and asking Puneet 3.0 to build a plan."
          : "Preparing the workspace and sending your request to Codex.",
    );
    this.emitState();
    try {
      const collaborationMode = buildCodexCollaborationMode(
        this.collaborationMode,
        this.selectedModel,
        this.reasoningEffort,
      );
      if (
        (this.collaborationMode === "plan" || this.collaborationMode === "tad") &&
        !collaborationMode
      ) {
        throw new Error(`${this.collaborationMode === "tad" ? "TAD" : "Plan"} mode needs an available Codex model. Refresh the account and try again.`);
      }
      const response = await this.server.request<TurnResponse>("turn/start", {
        threadId: this.threadId,
        input,
        cwd: this.workspaceFolder?.uri.fsPath ?? null,
        model: this.selectedModel || null,
        effort: this.reasoningEffort || null,
        collaborationMode: collaborationMode ?? null,
      });
      this.turnId = response.turn.id;
      this.emitState();
    } catch (error: unknown) {
      this.turnId = null;
      this.finishTurn("failed", undefined, "Task could not start", rpcErrorMessage(error));
      this.addSystemMessage(`Could not start the turn: ${rpcErrorMessage(error)}`);
      this.emit("turnFinished", {
        threadId: this.threadId,
        turnId: null,
        status: "failed",
      } satisfies TurnFinishedEvent);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.threadId || !this.turnId) {
      return;
    }
    const turnId = this.turnId;
    this.updateTurnProgress("Stopping task", "Waiting for Codex to stop safely.");
    this.emitState();
    await this.server.request("turn/interrupt", {
      threadId: this.threadId,
      turnId,
    });
  }

  async compact(): Promise<void> {
    if (!this.threadId) {
      throw new Error("Start a chat before compacting it.");
    }
    await this.server.request("thread/compact/start", { threadId: this.threadId });
    this.addSystemMessage("Context compaction started.");
  }

  async reviewChanges(): Promise<void> {
    await this.ensureCanRun();
    if (!this.threadId) {
      await this.newThread();
    }
    if (this.turnId) {
      throw new Error("Wait for the current turn to finish before starting a review.");
    }
    this.beginTurn("Starting review", "Preparing the uncommitted changes for review.");
    this.emitState();
    try {
      const response = await this.server.request<TurnResponse>("review/start", {
        threadId: this.threadId,
        target: { type: "uncommittedChanges" },
        delivery: "inline",
      });
      this.turnId = response.turn.id;
      this.emitState();
    } catch (error: unknown) {
      this.finishTurn("failed", undefined, "Review could not start", rpcErrorMessage(error));
      this.emitState();
      throw error;
    }
  }

  async setModel(model: string): Promise<void> {
    this.selectedModel = model;
    await this.context.workspaceState.update(SELECTED_MODEL_KEY, model || undefined);
    this.emitState();
  }

  async setCollaborationMode(mode: CollaborationModeSelection): Promise<void> {
    if (this.turnId) {
      throw new Error("Wait for the current task to finish before changing modes.");
    }
    this.collaborationMode = normalizeCollaborationMode(mode);
    await this.context.workspaceState.update(COLLABORATION_MODE_KEY, this.collaborationMode);
    this.emitState();
  }

  answerUserInput(questionId: string, value: unknown, custom = false): void {
    const pending = this.pendingUserInput;
    const question = pending?.questions.find((candidate) => candidate.id === questionId);
    if (!pending || !question) {
      throw new Error("This question is no longer waiting for an answer.");
    }
    const answer = normalizeUiQuestionAnswer(question, value, custom);
    if (answer === null) {
      throw new Error("That answer is not valid for this question.");
    }
    pending.answers[question.id] = { answers: answer ? [answer] : [] };
    pending.questions = pending.questions.filter((candidate) => candidate.id !== question.id);
    if (pending.questions.length === 0) {
      this.server.respond(pending.requestId, { answers: pending.answers });
      this.pendingUserInput = null;
    }
    this.emitState();
  }

  async fetchMyClickUpTickets(): Promise<void> {
    await this.ensureCanRun();
    await this.server.request("config/mcpServer/reload", undefined, 30_000);
    const response = await this.server.request<McpServerStatusResponse>("mcpServerStatus/list", {
      cursor: null,
      limit: 100,
      detail: "toolsAndAuthOnly",
      threadId: this.threadId,
    });
    const clickUp = response.data.find((server) => server.name.toLowerCase() === "clickup");
    if (!clickUp) {
      throw new Error(
        "ClickUp MCP is not connected to this Codex runtime. Add it with `codex mcp add clickup --url https://mcp.clickup.com/mcp`, authenticate with `codex mcp login clickup`, then restart extensions.",
      );
    }
    if (clickUp.authStatus === "notLoggedIn") {
      throw new Error(
        "ClickUp MCP needs authentication. Run `codex mcp login clickup`, finish the browser sign-in, then select ClickUp again.",
      );
    }
    if (!clickUp.tools || Object.keys(clickUp.tools).length === 0) {
      throw new Error(
        "ClickUp MCP is configured but its tools are unavailable. Restart extensions and check the ClickUp MCP connection.",
      );
    }
    await this.sendPrompt(FETCH_MY_CLICKUP_TICKETS_PROMPT);
  }

  async revealPlansFolder(): Promise<void> {
    const directory = await this.ensurePlanDirectory();
    await vscode.commands.executeCommand("revealInExplorer", directory);
  }

  async revealTadsFolder(): Promise<void> {
    const directory = await this.ensureTadDirectory();
    await vscode.commands.executeCommand("revealInExplorer", directory);
  }

  async openDocumentFile(filePath: string): Promise<void> {
    const uri = vscode.Uri.file(filePath);
    if (!vscode.workspace.getWorkspaceFolder(uri)) {
      throw new Error("The selected document is outside the active workspace.");
    }
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  addFileContext(uri: vscode.Uri): void {
    const existing = this.contexts.find((context) => context.kind === "file" && context.path === uri.fsPath);
    if (existing) {
      return;
    }
    this.contexts.push({
      id: randomUUID(),
      kind: "file",
      label: basename(uri.fsPath),
      path: uri.fsPath,
    });
    this.emitState();
  }

  addSelectionContext(document: vscode.TextDocument, selection: vscode.Range): boolean {
    if (selection.isEmpty) {
      throw new Error("Select some code before adding it to the chat.");
    }
    const startLine = selection.start.line + 1;
    const endLine = selection.end.line + 1;
    const sourcePath = document.uri.fsPath || document.uri.toString();
    const sourceRange = `lines ${startLine}-${endLine}`;
    const sourceText = document.getText(selection);
    const existing = this.contexts.some(
      (context) =>
        context.kind === "selection" &&
        context.path === sourcePath &&
        context.range === sourceRange &&
        context.text === sourceText,
    );
    if (existing) {
      return false;
    }
    this.contexts.push({
      id: randomUUID(),
      kind: "selection",
      label: `${basename(document.fileName)}:${startLine}-${endLine}`,
      path: sourcePath,
      range: sourceRange,
      text: sourceText,
    });
    this.emitState();
    return true;
  }

  removeContext(id: string): void {
    this.contexts = this.contexts.filter((context) => context.id !== id);
    this.emitState();
  }

  statusSummary(): string {
    const account = this.toUiAccount();
    const accountText = account ? `${account.label}${account.plan ? ` (${account.plan})` : ""}` : "Signed out";
    const limits = this.toUiRateLimits();
    const limitText = limits.length
      ? limits.map((limit) => `${limit.label}: ${Math.round(limit.usedPercent)}% used`).join(" · ")
      : "Usage limits unavailable";
    return `${accountText} — ${limitText}`;
  }

  private get sandbox(): string {
    return vscode.workspace
      .getConfiguration("puneet2")
      .get<string>("sandbox", "workspace-write");
  }

  private get approvalPolicy(): string {
    return vscode.workspace
      .getConfiguration("puneet2")
      .get<string>("approvalPolicy", "on-request");
  }

  private get reasoningEffort(): string {
    return vscode.workspace
      .getConfiguration("puneet2")
      .get<string>("reasoningEffort", "")
      .trim();
  }

  private async ensureCanRun(): Promise<void> {
    await this.initialize();
    if (!this.workspaceFolder) {
      throw new Error("Open a local folder or workspace before asking Codex to change code.");
    }
    if (this.requiresOpenaiAuth && !this.account) {
      throw new Error("Sign in with ChatGPT or an API key before starting a Codex task.");
    }
  }

  private async refreshAccount(): Promise<void> {
    const response = await this.server.request<AccountReadResponse>("account/read", {
      refreshToken: false,
    });
    this.account = response.account;
    this.requiresOpenaiAuth = response.requiresOpenaiAuth;
  }

  private async refreshRateLimits(): Promise<void> {
    try {
      this.rateLimits = await this.server.request<RateLimitsResponse>("account/rateLimits/read");
    } catch (error: unknown) {
      this.output.appendLine(`Rate limits unavailable: ${rpcErrorMessage(error)}`);
      this.rateLimits = null;
    }
  }

  private async loadModels(): Promise<void> {
    try {
      const response = await this.server.request<ModelListResponse>("model/list", {
        limit: 100,
        includeHidden: false,
      });
      this.models = response.data.filter((model) => !model.hidden);
      if (!this.selectedModel) {
        this.selectedModel = this.models.find((model) => model.isDefault)?.model ?? this.models[0]?.model ?? "";
      }
    } catch (error: unknown) {
      this.output.appendLine(`Models unavailable: ${rpcErrorMessage(error)}`);
    }
  }

  private async refreshAfterLogin(): Promise<void> {
    await this.refreshAccount();
    await Promise.allSettled([this.refreshRateLimits(), this.loadModels(), this.loadThreads()]);
    this.error = null;
    this.emitState();
  }

  private async loadThreads(): Promise<void> {
    const cwd = this.workspaceFolder?.uri.fsPath;
    if (!cwd) {
      this.threads = [];
      return;
    }
    try {
      const response = await this.server.request<ThreadListResponse>("thread/list", {
        limit: 50,
        sortKey: "recency_at",
        sortDirection: "desc",
        cwd,
        archived: false,
      });
      this.threads = response.data.map((thread) => {
        const preview = thread.preview?.trim() || "";
        const title = thread.name?.trim() || firstLine(preview) || "Untitled chat";
        return {
          id: thread.id,
          title: truncate(title, 72),
          preview: truncate(preview, 160),
          updatedAt: thread.recencyAt ?? thread.updatedAt ?? thread.createdAt,
          active: thread.id === this.threadId,
          running: thread.status?.type === "active",
        };
      });
    } catch (error: unknown) {
      this.output.appendLine(`Chat history unavailable: ${rpcErrorMessage(error)}`);
    }
  }

  private async restoreLastThread(): Promise<void> {
    const id = this.context.workspaceState.get<string>(LAST_THREAD_KEY);
    if (!id) {
      return;
    }
    try {
      const response = await this.server.request<ThreadResponse>("thread/resume", {
        threadId: id,
        cwd: this.workspaceFolder?.uri.fsPath ?? null,
        approvalPolicy: this.approvalPolicy,
        sandbox: this.sandbox,
      });
      this.threadId = response.thread.id;
      this.hydrateHistory(response.thread);
    } catch (error: unknown) {
      this.output.appendLine(`Could not resume thread ${id}: ${rpcErrorMessage(error)}`);
      await this.context.workspaceState.update(LAST_THREAD_KEY, undefined);
    }
  }

  private hydrateHistory(thread: Thread): void {
    this.messages = [];
    this.fileChanges = [];
    this.activities = [];
    let latestUserPrompt = "Implementation plan";
    let latestDocumentKind: "plan" | "tad" = "plan";
    let latestMessageKind: "message" | "clickup" = "message";
    for (const turn of thread.turns ?? []) {
      for (const item of turn.items ?? []) {
        if (item.type === "userMessage" && Array.isArray(item.content)) {
          latestDocumentKind = contentInvokesTad(item.content) ? "tad" : "plan";
          latestMessageKind = contentInvokesClickUp(item.content) ? "clickup" : "message";
          const text = item.content
            .map((part) => {
              if (!isRecord(part)) {
                return "";
              }
              if (part.type === "text" && typeof part.text === "string") {
                return part.text;
              }
              if (part.type === "mention" && typeof part.name === "string") {
                return `@${part.name}`;
              }
              return "";
            })
            .filter(Boolean)
            .join("\n")
            .trim();
          if (text) {
            latestUserPrompt = text;
            this.messages.push({ id: item.id, role: "user", text });
          }
        } else if (item.type === "agentMessage" && typeof item.text === "string") {
          this.messages.push({ id: item.id, role: "assistant", text: item.text, kind: latestMessageKind });
        } else if (item.type === "plan" && typeof item.text === "string") {
          const documentKind = latestDocumentKind;
          const files = documentKind === "tad" ? this.tadFiles : this.planFiles;
          const saved = files[this.documentStorageKey(item.id, thread.id)];
          if (saved) {
            this.messages.push({
              id: item.id,
              role: "assistant",
              text: saved.title,
              kind: documentKind,
              documentPath: saved.path,
              documentLabel: saved.label,
            });
          } else {
            this.messages.push({
              id: item.id,
              role: "assistant",
              text: documentKind === "tad"
                ? "Moving this earlier TAD into .puneet/tads…"
                : "Moving this earlier plan into .puneet/plans…",
              kind: documentKind,
            });
            const saveDocument = documentKind === "tad"
              ? this.saveTadFile(item.id, item.text, latestUserPrompt, thread.id)
              : this.savePlanFile(item.id, item.text, latestUserPrompt, thread.id);
            void saveDocument.catch((error: unknown) => {
              if (this.threadId !== thread.id) {
                return;
              }
              const message = rpcErrorMessage(error);
              this.setAssistantMessage(
                item.id,
                `The earlier ${documentKind === "tad" ? "TAD" : "plan"} could not be saved as Markdown (${message}).\n\n${item.text}`,
                documentKind,
              );
              this.emitState();
            });
          }
        } else {
          if (item.type === "fileChange") {
            this.upsertFileChanges(item.changes, "completed");
          }
          this.upsertActivity(item, "completed");
        }
      }
    }
  }

  private handleNotification(message: RpcNotification): void {
    const params = isRecord(message.params) ? message.params : {};
    switch (message.method) {
      case "account/login/completed":
        if (params.success === true) {
          void this.refreshAfterLogin().then(() => {
            vscode.window.showInformationMessage("Signed in to Codex.");
          });
        } else {
          this.error = typeof params.error === "string" ? params.error : "Codex sign-in failed.";
          this.emitState();
        }
        break;
      case "account/updated":
        void this.refreshAfterLogin();
        break;
      case "account/rateLimits/updated":
        void this.refreshRateLimits().then(() => this.emitState());
        break;
      case "turn/started": {
        const turn = isRecord(params.turn) ? params.turn : {};
        if (typeof turn.id === "string") {
          this.turnId = turn.id;
          if (this.turnProgress.status !== "running") {
            this.beginTurn("Codex is working", "The task is now running in your workspace.");
          } else {
            this.updateTurnProgress("Codex is working", "The task is now running in your workspace.");
          }
          this.emitState();
        }
        break;
      }
      case "turn/diff/updated":
        if (
          typeof params.threadId === "string" &&
          typeof params.turnId === "string" &&
          typeof params.diff === "string"
        ) {
          this.setFileChangesFromTurnDiff(params.diff);
          this.emit("turnDiff", {
            threadId: params.threadId,
            turnId: params.turnId,
            diff: params.diff,
          } satisfies TurnDiffEvent);
          this.emitState();
        }
        break;
      case "item/agentMessage/delta":
        if (typeof params.itemId === "string" && typeof params.delta === "string") {
          this.updateTurnProgress("Writing an update", "Codex is streaming its latest progress.");
          this.appendAssistantDelta(
            params.itemId,
            params.delta,
            this.collaborationMode === "clickup" ? "clickup" : "message",
          );
          this.emit("progress", { ...this.turnProgress });
        }
        break;
      case "item/plan/delta":
        if (typeof params.itemId === "string" && typeof params.delta === "string") {
          const documentKind = this.collaborationMode === "tad" ? "tad" : "plan";
          this.updateTurnProgress(
            documentKind === "tad" ? "Designing the TAD" : "Building the plan",
            documentKind === "tad"
              ? "Puneet 3.0 is applying the TAD skill and preparing a Markdown architecture document."
              : "Puneet 3.0 is preparing a Markdown plan file.",
          );
          if (this.ensureDocumentPlaceholder(params.itemId, documentKind)) {
            this.emitState();
          }
          this.emit("progress", { ...this.turnProgress });
        }
        break;
      case "item/fileChange/patchUpdated": {
        const event = parseFilePatchEvent(params, "preview");
        if (event) {
          this.upsertFileChanges(event.changes, "running");
          this.emit("filePatch", event);
          this.emitState();
        }
        break;
      }
      case "item/started":
        if (isRecord(params.item)) {
          const item = params.item as unknown as ThreadItem;
          if (item.type === "fileChange") {
            const event = parseFilePatchItem(params, item, "preview");
            if (event) {
              this.upsertFileChanges(event.changes, "running");
              this.emit("filePatch", event);
            }
          }
          this.upsertActivity(item, "running");
          const progress = this.describeTurnProgress(item);
          this.updateTurnProgress(progress.label, progress.detail);
          this.emitState();
        }
        break;
      case "item/completed":
        if (isRecord(params.item)) {
          const item = params.item as unknown as ThreadItem;
          if (item.type === "fileChange") {
            const fileStatus = this.activityStatus(item);
            const event = parseFilePatchItem(
              params,
              item,
              fileStatus === "completed" ? "applied" : "discarded",
            );
            if (event) {
              if (fileStatus === "completed") {
                this.upsertFileChanges(event.changes, fileStatus);
              } else {
                this.removeFileChanges(event.changes);
              }
              this.emit("filePatch", event);
            }
          }
          if (item.type === "agentMessage" && typeof item.text === "string") {
            this.setAssistantMessage(
              item.id,
              item.text,
              this.collaborationMode === "clickup" ? "clickup" : "message",
            );
            this.updateTurnProgress(
              "Finalizing task",
              "The response is complete; Codex is finishing the turn.",
            );
          } else if (item.type === "plan" && typeof item.text === "string") {
            const documentKind = this.collaborationMode === "tad" ? "tad" : "plan";
            this.setAssistantMessage(
              item.id,
              documentKind === "tad"
                ? "Saving the TAD to .puneet/tads…"
                : "Saving the plan to .puneet/plans…",
              documentKind,
            );
            this.updateTurnProgress(
              documentKind === "tad" ? "Saving TAD" : "Saving plan",
              documentKind === "tad"
                ? "Writing the completed technical architecture document to Markdown."
                : "Writing the completed plan to a Markdown file.",
            );
            const saveDocument = documentKind === "tad"
              ? this.saveTadFile(item.id, item.text)
              : this.savePlanFile(item.id, item.text);
            void saveDocument.catch((error: unknown) => {
              const message = rpcErrorMessage(error);
              this.setAssistantMessage(
                item.id,
                `The ${documentKind === "tad" ? "TAD" : "plan"} could not be saved as Markdown (${message}).\n\n${item.text}`,
                documentKind,
              );
              this.addSystemMessage(`Could not save the ${documentKind === "tad" ? "TAD" : "plan"} file: ${message}`);
              this.emitState();
            });
          } else {
            this.upsertActivity(item, this.activityStatus(item));
            const activity = this.describeActivity(item);
            this.updateTurnProgress(
              "Continuing task",
              activity ? `${activity.label} finished. Codex is continuing.` : "A task step finished. Codex is continuing.",
            );
          }
          this.emitState();
        }
        break;
      case "turn/completed": {
        const turn = isRecord(params.turn) ? params.turn : {};
        const completedTurnId = typeof turn.id === "string" ? turn.id : this.turnId;
        this.turnId = null;
        this.pendingUserInput = null;
        const turnStatus = typeof turn.status === "string" ? turn.status.toLowerCase() : "completed";
        const durationMs = typeof turn.durationMs === "number" ? turn.durationMs : undefined;
        let finishedStatus: TurnFinishedEvent["status"];
        if (turnStatus.includes("fail")) {
          finishedStatus = "failed";
          this.finishFileChanges("failed");
          const turnError = isRecord(turn.error) ? turn.error : {};
          const message = typeof turnError.message === "string" ? turnError.message : "The Codex turn failed.";
          this.finishTurn("failed", durationMs, "Task failed", message);
          this.addSystemMessage(
            message,
          );
        } else if (turnStatus.includes("interrupt") || turnStatus.includes("cancel")) {
          finishedStatus = "interrupted";
          this.finishFileChanges("failed");
          this.finishTurn("interrupted", durationMs, "Task stopped", "The turn was stopped before completion.");
          this.emitState();
        } else {
          finishedStatus = "completed";
          this.finishFileChanges("completed");
          const changedFiles = this.activities.filter(
            (activity) => activity.kind === "file" && activity.status === "completed",
          ).length;
          this.finishTurn(
            "completed",
            durationMs,
            "Task finished",
            changedFiles > 0 ? "Codex finished and applied workspace changes." : "Codex finished the requested task.",
          );
          this.emitState();
        }
        this.emit("turnFinished", {
          threadId: typeof params.threadId === "string" ? params.threadId : this.threadId,
          turnId: completedTurnId,
          status: finishedStatus,
        } satisfies TurnFinishedEvent);
        void Promise.allSettled([this.refreshRateLimits(), this.loadThreads()]).then(() => this.emitState());
        break;
      }
      case "thread/name/updated":
      case "thread/archived":
      case "thread/deleted":
      case "thread/unarchived":
        void this.loadThreads().then(() => this.emitState());
        break;
      case "context/compacted":
        this.addSystemMessage("Chat context was compacted.");
        break;
      case "error":
        if (typeof params.message === "string") {
          this.addSystemMessage(params.message);
        }
        break;
      default:
        break;
    }
  }

  private async handleServerRequest(request: ServerRequestEvent): Promise<void> {
    try {
      switch (request.method) {
        case "item/commandExecution/requestApproval":
          await this.handleCommandApproval(request);
          return;
        case "item/fileChange/requestApproval":
          await this.handleFileApproval(request);
          return;
        case "item/permissions/requestApproval":
          await this.handlePermissionApproval(request);
          return;
        case "item/tool/requestUserInput":
          this.handleUserInputRequest(request);
          return;
        case "mcpServer/elicitation/request":
          vscode.window.showWarningMessage("An MCP server requested additional input; this MVP declined the request.");
          this.server.respond(request.id, { action: "decline", content: null, _meta: null });
          return;
        default:
          this.server.respondError(request.id, -32601, `Unsupported server request: ${request.method}`);
      }
    } catch (error: unknown) {
      this.server.respondError(request.id, -32000, rpcErrorMessage(error));
    }
  }

  private async handleCommandApproval(request: ServerRequestEvent): Promise<void> {
    const params = isRecord(request.params) ? request.params : {};
    const command = typeof params.command === "string" ? params.command : "Codex command";
    const reason = typeof params.reason === "string" ? `\n${params.reason}` : "";
    const choice = await vscode.window.showWarningMessage(
      `Codex wants to run:\n${command}${reason}`,
      { modal: true },
      "Allow once",
      "Allow for session",
      "Decline",
    );
    const decision = choice === "Allow once" ? "accept" : choice === "Allow for session" ? "acceptForSession" : "decline";
    this.server.respond(request.id, { decision });
  }

  private async handleFileApproval(request: ServerRequestEvent): Promise<void> {
    const params = isRecord(request.params) ? request.params : {};
    const reason = typeof params.reason === "string" ? params.reason : "Codex requested permission to change files.";
    const choice = await vscode.window.showWarningMessage(
      reason,
      { modal: true },
      "Allow once",
      "Allow for session",
      "Decline",
    );
    const decision = choice === "Allow once" ? "accept" : choice === "Allow for session" ? "acceptForSession" : "decline";
    this.server.respond(request.id, { decision });
  }

  private async handlePermissionApproval(request: ServerRequestEvent): Promise<void> {
    const params = isRecord(request.params) ? request.params : {};
    const permissions = isRecord(params.permissions) ? params.permissions : {};
    const reason = typeof params.reason === "string" ? params.reason : "Codex requested additional permissions.";
    const detail = JSON.stringify(permissions, null, 2);
    const choice = await vscode.window.showWarningMessage(
      `${reason}\n\n${detail}`,
      { modal: true },
      "Allow once",
      "Allow for session",
      "Decline",
    );

    if (choice === "Allow once" || choice === "Allow for session") {
      const granted: Record<string, unknown> = {};
      if (isRecord(permissions.network)) {
        granted.network = permissions.network;
      }
      if (isRecord(permissions.fileSystem)) {
        granted.fileSystem = permissions.fileSystem;
      }
      this.server.respond(request.id, {
        permissions: granted,
        scope: choice === "Allow for session" ? "session" : "turn",
      });
    } else {
      this.server.respond(request.id, { permissions: {}, scope: "turn" });
    }
  }

  private handleUserInputRequest(request: ServerRequestEvent): void {
    if (this.pendingUserInput) {
      throw new Error("Another Codex question is already waiting for an answer.");
    }
    const questions = parseUiQuestions(request.params);
    if (questions.length === 0) {
      this.server.respond(request.id, { answers: {} });
      return;
    }
    this.pendingUserInput = {
      requestId: request.id,
      questions,
      answers: {},
    };
    this.updateTurnProgress("Waiting for your input", questions[0].question);
    this.emitState();
  }

  private appendAssistantDelta(
    id: string,
    delta: string,
    kind: "message" | "plan" | "clickup",
  ): void {
    let message = this.messages.find((candidate) => candidate.id === id);
    if (!message) {
      message = { id, role: "assistant", text: "", kind };
      this.messages.push(message);
    }
    message.kind = kind;
    message.text += delta;
    this.emit("delta", { id, delta, kind });
  }

  private ensureDocumentPlaceholder(id: string, kind: "plan" | "tad"): boolean {
    const existing = this.messages.find((message) => message.id === id);
    if (existing) {
      return false;
    }
    this.messages.push({
      id,
      role: "assistant",
      text: kind === "tad"
        ? "Preparing a technical architecture document in .puneet/tads…"
        : "Preparing a Markdown plan in .puneet/plans…",
      kind,
    });
    return true;
  }

  private async savePlanFile(
    itemId: string,
    plan: string,
    promptOverride?: string,
    threadIdOverride?: string | null,
  ): Promise<void> {
    const generatedAt = new Date();
    const sourceThreadId = threadIdOverride ?? this.threadId;
    const prompt =
      promptOverride?.trim() ||
      [...this.messages].reverse().find((message) => message.role === "user")?.text ||
      "Implementation plan";
    const title = planTitleFromPrompt(prompt);
    const storageKey = this.documentStorageKey(itemId, sourceThreadId);
    const existing = this.planFiles[storageKey];
    const directory = await this.ensurePlanDirectory();
    const uri = existing
      ? vscode.Uri.file(existing.path)
      : vscode.Uri.joinPath(directory, buildPlanFilename(prompt, itemId, generatedAt));
    if (!vscode.workspace.getWorkspaceFolder(uri)) {
      throw new Error("The plan file resolved outside the active workspace.");
    }
    const markdown = buildPlanMarkdown(prompt, plan, generatedAt, sourceThreadId);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(markdown));

    const stored = {
      path: uri.fsPath,
      label: vscode.workspace.asRelativePath(uri, false),
      title,
    } satisfies StoredDocumentFile;
    this.planFiles[storageKey] = stored;
    await this.context.workspaceState.update(PLAN_FILES_KEY, this.planFiles);
    if (this.threadId === sourceThreadId) {
      this.setDocumentFileMessage(itemId, stored, "plan");
      this.emitState();
    }
  }

  private async saveTadFile(
    itemId: string,
    tad: string,
    promptOverride?: string,
    threadIdOverride?: string | null,
  ): Promise<void> {
    const generatedAt = new Date();
    const sourceThreadId = threadIdOverride ?? this.threadId;
    const prompt =
      promptOverride?.trim() ||
      [...this.messages].reverse().find((message) => message.role === "user")?.text ||
      "Technical architecture";
    const title = tadTitleFromPrompt(prompt);
    const storageKey = this.documentStorageKey(itemId, sourceThreadId);
    const existing = this.tadFiles[storageKey];
    const directory = await this.ensureTadDirectory();
    const uri = existing
      ? vscode.Uri.file(existing.path)
      : vscode.Uri.joinPath(directory, buildTadFilename(prompt, itemId, generatedAt));
    if (!vscode.workspace.getWorkspaceFolder(uri)) {
      throw new Error("The TAD file resolved outside the active workspace.");
    }
    const markdown = buildTadMarkdown(prompt, tad, generatedAt, sourceThreadId);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(markdown));

    const stored = {
      path: uri.fsPath,
      label: vscode.workspace.asRelativePath(uri, false),
      title,
    } satisfies StoredDocumentFile;
    this.tadFiles[storageKey] = stored;
    await this.context.workspaceState.update(TAD_FILES_KEY, this.tadFiles);
    if (this.threadId === sourceThreadId) {
      this.setDocumentFileMessage(itemId, stored, "tad");
      this.emitState();
    }
  }

  private async ensurePlanDirectory(): Promise<vscode.Uri> {
    const folder = this.workspaceFolder;
    if (!folder) {
      throw new Error("Open a local folder before creating a plan.");
    }
    const configured = vscode.workspace
      .getConfiguration("puneet2")
      .get<string>("planDirectory", DEFAULT_PLAN_DIRECTORY);
    const relativePath = normalizePlanDirectory(configured);
    const directory = vscode.Uri.joinPath(folder.uri, ...relativePath.split("/").filter(Boolean));
    await vscode.workspace.fs.createDirectory(directory);
    return directory;
  }

  private async ensureTadDirectory(): Promise<vscode.Uri> {
    const folder = this.workspaceFolder;
    if (!folder) {
      throw new Error("Open a local folder before creating a TAD.");
    }
    const configured = vscode.workspace
      .getConfiguration("puneet2")
      .get<string>("tadDirectory", DEFAULT_TAD_DIRECTORY);
    const relativePath = normalizeTadDirectory(configured);
    const directory = vscode.Uri.joinPath(folder.uri, ...relativePath.split("/").filter(Boolean));
    await vscode.workspace.fs.createDirectory(directory);
    return directory;
  }

  private documentStorageKey(itemId: string, threadId = this.threadId): string {
    return `${threadId ?? "unknown"}:${itemId}`;
  }

  private beginTurn(label: string, detail: string): void {
    const now = Date.now();
    this.turnProgress = {
      status: "running",
      label,
      detail,
      startedAtMs: now,
      lastProgressAtMs: now,
      completedAtMs: null,
      durationMs: null,
    };
  }

  private updateTurnProgress(label: string, detail: string, updateTimestamp = true): void {
    if (this.turnProgress.status !== "running") {
      return;
    }
    this.turnProgress.label = label;
    this.turnProgress.detail = detail;
    if (updateTimestamp) {
      this.turnProgress.lastProgressAtMs = Date.now();
    }
  }

  private finishTurn(
    status: "completed" | "failed" | "interrupted",
    durationMs: number | undefined,
    label: string,
    detail: string,
  ): void {
    const now = Date.now();
    const startedAtMs = this.turnProgress.startedAtMs;
    this.turnProgress = {
      status,
      label,
      detail,
      startedAtMs,
      lastProgressAtMs: now,
      completedAtMs: now,
      durationMs: durationMs ?? (startedAtMs ? Math.max(0, now - startedAtMs) : null),
    };
  }

  private describeTurnProgress(item: ThreadItem): { label: string; detail: string } {
    switch (item.type) {
      case "reasoning":
        return { label: "Thinking through the task", detail: "Codex is analyzing the workspace and deciding the next step." };
      case "commandExecution":
        return {
          label: "Running a terminal command",
          detail: typeof item.command === "string" ? truncate(item.command, 140) : "Codex is running a workspace command.",
        };
      case "fileChange":
        return { label: "Updating workspace files", detail: "Codex is preparing or applying code changes." };
      case "mcpToolCall":
      case "dynamicToolCall":
        return this.collaborationMode === "clickup"
          ? {
              label: "Reading ClickUp",
              detail: typeof item.tool === "string"
                ? `Running the read-only ${item.tool} tool.`
                : "Searching ClickUp for your assigned tickets.",
            }
          : {
              label: "Using a tool",
              detail: typeof item.tool === "string" ? `Running ${item.tool}.` : "Codex is using an external tool.",
            };
      case "webSearch":
        return { label: "Searching the web", detail: "Codex is gathering current information." };
      case "collabAgentToolCall":
      case "subAgentActivity":
        return { label: "Coordinating agent work", detail: "Codex is waiting for or coordinating another agent." };
      case "agentMessage":
        return { label: "Writing an update", detail: "Codex is preparing a progress message." };
      case "plan":
        return this.collaborationMode === "tad"
          ? { label: "Designing the TAD", detail: "Puneet 3.0 is preparing the technical architecture document." }
          : { label: "Building the plan", detail: "Puneet 3.0 is preparing a step-by-step plan." };
      default:
        return { label: "Codex is working", detail: "The task is still running." };
    }
  }

  private setAssistantMessage(
    id: string,
    text: string,
    kind: "message" | "plan" | "tad" | "clickup",
  ): void {
    const existing = this.messages.find((message) => message.id === id);
    if (existing) {
      existing.text = text;
      existing.kind = kind;
      existing.documentPath = undefined;
      existing.documentLabel = undefined;
    } else {
      this.messages.push({ id, role: "assistant", text, kind });
    }
  }

  private setDocumentFileMessage(
    id: string,
    document: StoredDocumentFile,
    kind: "plan" | "tad",
  ): void {
    const existing = this.messages.find((message) => message.id === id);
    if (existing) {
      existing.text = document.title;
      existing.kind = kind;
      existing.documentPath = document.path;
      existing.documentLabel = document.label;
    } else {
      this.messages.push({
        id,
        role: "assistant",
        text: document.title,
        kind,
        documentPath: document.path,
        documentLabel: document.label,
      });
    }
  }

  private addSystemMessage(text: string): void {
    this.messages.push({ id: randomUUID(), role: "system", text });
    this.emitState();
  }

  private setFileChangesFromTurnDiff(diff: string): void {
    const existing = new Map(this.fileChanges.map((change) => [change.path, change]));
    this.fileChanges = parseAggregatedUnifiedDiff(diff).map((file) => {
      const path = this.absoluteFilePath(file.path);
      return this.createUiFileChange(
        path,
        file.kind,
        file.diff,
        existing.get(path)?.status ?? "running",
      );
    });
  }

  private upsertFileChanges(value: unknown, status: UiFileChange["status"]): void {
    for (const change of parseFilePatchChanges(value)) {
      const path = this.absoluteFilePath(
        change.kind.type === "update" && change.kind.move_path ? change.kind.move_path : change.path,
      );
      const next = this.createUiFileChange(path, change.kind.type, change.diff, status);
      const index = this.fileChanges.findIndex((candidate) => candidate.path === path);
      if (index >= 0) {
        this.fileChanges[index] = next;
      } else {
        this.fileChanges.push(next);
      }
    }
  }

  private createUiFileChange(
    path: string,
    kind: UiFileChange["kind"],
    diff: string,
    status: UiFileChange["status"],
  ): UiFileChange {
    const counts = countUnifiedDiffLines(diff);
    return {
      id: path,
      path,
      label: vscode.workspace.asRelativePath(vscode.Uri.file(path), false),
      kind,
      status,
      diff: diff.length > MAX_UI_DIFF_CHARS ? diff.slice(0, MAX_UI_DIFF_CHARS) : diff,
      ...counts,
    };
  }

  private absoluteFilePath(filePath: string): string {
    return isAbsolute(filePath)
      ? filePath
      : resolve(this.workspaceFolder?.uri.fsPath ?? process.cwd(), filePath);
  }

  private removeFileChanges(value: unknown): void {
    const paths = new Set(
      parseFilePatchChanges(value).map((change) =>
        this.absoluteFilePath(
          change.kind.type === "update" && change.kind.move_path
            ? change.kind.move_path
            : change.path,
        ),
      ),
    );
    this.fileChanges = this.fileChanges.filter((change) => !paths.has(change.path));
  }

  private finishFileChanges(status: "completed" | "failed"): void {
    for (const change of this.fileChanges) {
      change.status = status;
    }
  }

  private upsertActivity(item: ThreadItem, status: UiActivity["status"]): void {
    const presentation = this.describeActivity(item);
    if (!presentation) {
      return;
    }
    const existing = this.activities.find((activity) => activity.id === item.id);
    if (existing) {
      existing.kind = presentation.kind;
      existing.label = presentation.label;
      existing.detail = presentation.detail;
      existing.status = status;
    } else {
      this.activities.push({ id: item.id, status, ...presentation });
      if (this.activities.length > 20) {
        this.activities = this.activities.slice(-20);
      }
    }
  }

  private describeActivity(item: ThreadItem): Omit<UiActivity, "id" | "status"> | null {
    switch (item.type) {
      case "commandExecution":
        return {
          kind: "command",
          label: "Terminal",
          detail: typeof item.command === "string" ? item.command : "Running command",
        };
      case "fileChange": {
        const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
        const paths = changes
          .map((change) => (typeof change.path === "string" ? change.path : ""))
          .filter(Boolean)
          .join(", ");
        return { kind: "file", label: "Files changed", detail: paths || "Updating workspace files" };
      }
      case "mcpToolCall":
      case "dynamicToolCall":
        return {
          kind: "tool",
          label: typeof item.tool === "string" ? item.tool : "Tool",
          detail: typeof item.server === "string" ? item.server : "Using a tool",
        };
      case "webSearch":
        return { kind: "search", label: "Web search", detail: "Searching the web" };
      case "collabAgentToolCall":
      case "subAgentActivity":
        return { kind: "agent", label: "Agent", detail: typeof item.tool === "string" ? item.tool : "Agent activity" };
      default:
        return null;
    }
  }

  private activityStatus(item: ThreadItem): UiActivity["status"] {
    const value = typeof item.status === "string" ? item.status.toLowerCase() : "";
    return value.includes("fail") || value.includes("declin") ? "failed" : "completed";
  }

  private toUiAccount(): PublicState["account"] {
    if (!this.account) {
      return null;
    }
    if (this.account.type === "chatgpt") {
      const email = typeof this.account.email === "string" ? this.account.email : null;
      const plan = typeof this.account.planType === "string" ? this.account.planType : "unknown";
      return {
        type: "chatgpt",
        label: email ?? "ChatGPT account",
        plan,
      };
    }
    if (this.account.type === "apiKey") {
      return { type: "apiKey", label: "OpenAI API key", plan: "usage-based" };
    }
    return { type: this.account.type, label: this.account.type, plan: null };
  }

  private toUiRateLimits(): UiRateLimit[] {
    if (!this.rateLimits) {
      return [];
    }
    const snapshots = this.rateLimits.rateLimitsByLimitId && Object.keys(this.rateLimits.rateLimitsByLimitId).length
      ? Object.entries(this.rateLimits.rateLimitsByLimitId)
      : [[this.rateLimits.rateLimits.limitId ?? "codex", this.rateLimits.rateLimits] as const];
    const result: UiRateLimit[] = [];
    for (const [id, snapshot] of snapshots) {
      for (const [window, value] of [
        ["primary", snapshot.primary],
        ["secondary", snapshot.secondary],
      ] as const) {
        if (!value) {
          continue;
        }
        result.push({
          id: `${id}:${window}`,
          label: snapshot.limitName ?? snapshot.limitId ?? id,
          usedPercent: clampPercent(value.usedPercent),
          resetsAt: value.resetsAt,
          window,
        });
      }
    }
    return result;
  }

  private emitState(): void {
    this.emit("state", this.state);
  }

  dispose(): void {
    this.server.dispose();
    this.removeAllListeners();
  }
}

function createIdleTurnProgress(): UiTurnProgress {
  return {
    status: "idle",
    label: "Ready",
    detail: "",
    startedAtMs: null,
    lastProgressAtMs: null,
    completedAtMs: null,
    durationMs: null,
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function parseFilePatchEvent(
  params: Record<string, unknown>,
  phase: FilePatchEvent["phase"],
): FilePatchEvent | null {
  const changes = parseFilePatchChanges(params.changes);
  if (
    changes.length === 0 ||
    typeof params.threadId !== "string" ||
    typeof params.turnId !== "string" ||
    typeof params.itemId !== "string"
  ) {
    return null;
  }
  return {
    phase,
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    changes,
  };
}

function parseFilePatchItem(
  params: Record<string, unknown>,
  item: ThreadItem,
  phase: FilePatchEvent["phase"],
): FilePatchEvent | null {
  const changes = parseFilePatchChanges(item.changes);
  if (changes.length === 0 || typeof params.threadId !== "string" || typeof params.turnId !== "string") {
    return null;
  }
  return {
    phase,
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: item.id,
    changes,
  };
}

function parseFilePatchChanges(value: unknown): FilePatchChange[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const changes: FilePatchChange[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.path !== "string" || typeof candidate.diff !== "string") {
      continue;
    }
    const kind = isRecord(candidate.kind) ? candidate.kind : {};
    if (kind.type !== "add" && kind.type !== "delete" && kind.type !== "update") {
      continue;
    }
    changes.push({
      path: candidate.path,
      diff: candidate.diff,
      kind: {
        type: kind.type,
        move_path: typeof kind.move_path === "string" ? kind.move_path : null,
      },
    });
  }
  return changes;
}
