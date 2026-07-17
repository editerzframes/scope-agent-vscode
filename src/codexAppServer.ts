import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface, Interface } from "node:readline";
import * as vscode from "vscode";
import {
  isRecord,
  parseRpcLine,
  RpcId,
  RpcMessage,
  RpcRequest,
  RpcResponse,
  rpcErrorMessage,
} from "./protocol";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface ServerRequestEvent {
  id: RpcId;
  method: string;
  params: unknown;
}

export class CodexAppServer extends EventEmitter implements vscode.Disposable {
  private child: ChildProcessWithoutNullStreams | undefined;
  private lines: Interface | undefined;
  private nextId = 1;
  private pending = new Map<RpcId, PendingRequest>();
  private startPromise: Promise<void> | undefined;
  private disposed = false;
  private executable = "";

  constructor(private readonly cwd: string | undefined) {
    super();
  }

  get executablePath(): string {
    return this.executable;
  }

  async start(): Promise<void> {
    if (this.disposed) {
      throw new Error("Codex app-server has been disposed.");
    }
    if (!this.startPromise) {
      this.startPromise = this.doStart().catch((error: unknown) => {
        this.startPromise = undefined;
        throw error;
      });
    }
    return this.startPromise;
  }

  async request<T>(method: string, params?: unknown, timeoutMs = 60_000): Promise<T> {
    await this.start();
    return this.sendRequest<T>(method, params, timeoutMs);
  }

  respond(id: RpcId, result: unknown): void {
    this.write({ id, result });
  }

  respondError(id: RpcId, code: number, message: string): void {
    this.write({ id, error: { code, message } });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  private async doStart(): Promise<void> {
    const candidates = this.getExecutableCandidates();
    let lastError: Error | undefined;

    for (const candidate of candidates) {
      try {
        const child = await this.spawnCandidate(candidate);
        this.child = child;
        this.executable = candidate;
        this.attachProcess(child);
        break;
      } catch (error: unknown) {
        lastError = new Error(`${candidate}: ${rpcErrorMessage(error)}`);
      }
    }

    if (!this.child) {
      throw new Error(
        `Could not start the Codex CLI. Install Codex or set codexAgent.cliExecutable. ${lastError?.message ?? ""}`.trim(),
      );
    }

    try {
      await this.sendRequest(
        "initialize",
        {
          clientInfo: {
            name: "codex_agent_lab_vscode",
            title: "Codex Agent Lab for VS Code",
            version: "0.6.0",
          },
          capabilities: {
            experimentalApi: false,
          },
        },
        30_000,
      );
    } catch (error: unknown) {
      this.child?.kill();
      this.child = undefined;
      throw error;
    }
    this.notify("initialized", {});
    this.emit("ready", { executable: this.executable });
  }

  private getExecutableCandidates(): string[] {
    const configured = vscode.workspace
      .getConfiguration("codexAgent")
      .get<string>("cliExecutable", "")
      .trim();
    if (configured) {
      return [configured];
    }

    const candidates = [process.env.CODEX_CLI_PATH];
    if (process.platform === "darwin") {
      candidates.push("/Applications/ChatGPT.app/Contents/Resources/codex");
    }
    if (process.platform === "win32") {
      candidates.push("codex.exe");
    }
    candidates.push("codex");
    return [...new Set(candidates.filter((value): value is string => Boolean(value)))];
  }

  private spawnCandidate(executable: string): Promise<ChildProcessWithoutNullStreams> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
        cwd: this.cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      const onSpawn = (): void => {
        child.off("error", onError);
        resolve(child);
      };
      const onError = (error: Error): void => {
        child.off("spawn", onSpawn);
        reject(error);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });
  }

  private attachProcess(child: ChildProcessWithoutNullStreams): void {
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk: Buffer) => this.emit("log", chunk.toString("utf8")));
    child.on("exit", (code, signal) => {
      const message = `Codex app-server exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`;
      this.rejectPending(new Error(message));
      this.lines?.close();
      this.lines = undefined;
      this.child = undefined;
      this.startPromise = undefined;
      if (!this.disposed) {
        this.emit("exit", { code, signal, message });
      }
    });
  }

  private handleLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    let message: RpcMessage;
    try {
      message = parseRpcLine(line);
    } catch (error: unknown) {
      this.emit("log", `Invalid app-server message: ${rpcErrorMessage(error)}\n${line}\n`);
      return;
    }

    if ("id" in message && !((message as RpcRequest).method)) {
      const response = message as RpcResponse;
      const pending = this.pending.get(response.id);
      if (!pending) {
        return;
      }
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.error) {
        pending.reject(new Error(response.error.message ?? `Codex request failed (${response.error.code ?? "unknown"}).`));
      } else {
        pending.resolve(response.result);
      }
      return;
    }

    if ("method" in message && typeof message.method === "string") {
      if ("id" in message) {
        this.emit("serverRequest", {
          id: message.id,
          method: message.method,
          params: message.params,
        } satisfies ServerRequestEvent);
      } else {
        this.emit("notification", message);
      }
    }
  }

  private sendRequest<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        this.write(params === undefined ? { id, method } : { id, method, params });
      } catch (error: unknown) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(rpcErrorMessage(error)));
      }
    });
  }

  private write(message: unknown): void {
    if (!this.child?.stdin.writable) {
      throw new Error("Codex app-server is not running.");
    }
    const payload = isRecord(message) ? message : { value: message };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.lines?.close();
    this.rejectPending(new Error("Codex app-server was stopped."));
    this.child?.kill();
    this.child = undefined;
    this.startPromise = undefined;
  }
}
