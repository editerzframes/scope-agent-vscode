export type RpcId = number | string;

export interface RpcRequest {
  id: RpcId;
  method: string;
  params?: unknown;
}

export interface RpcNotification {
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  id: RpcId;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export type RpcMessage = RpcRequest | RpcNotification | RpcResponse;

export interface PromptContext {
  id: string;
  kind: "file" | "selection";
  label: string;
  path: string;
  text?: string;
  range?: string;
}

export interface UserTextInput {
  type: "text";
  text: string;
  text_elements: [];
}

export interface UserMentionInput {
  type: "mention";
  name: string;
  path: string;
}

export type UserInput = UserTextInput | UserMentionInput;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRpcLine(line: string): RpcMessage {
  const parsed: unknown = JSON.parse(line);
  if (!isRecord(parsed)) {
    throw new Error("Codex app-server returned a non-object JSON message.");
  }
  if (!("id" in parsed) && typeof parsed.method !== "string") {
    throw new Error("Codex app-server returned an invalid protocol message.");
  }
  return parsed as unknown as RpcMessage;
}

export function rpcErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

export function buildUserInputs(prompt: string, contexts: PromptContext[]): UserInput[] {
  const input: UserInput[] = [
    {
      type: "text",
      text: prompt.trim(),
      text_elements: [],
    },
  ];

  for (const context of contexts) {
    if (context.kind === "file") {
      input.push({
        type: "mention",
        name: context.label,
        path: context.path,
      });
      continue;
    }

    input.push({
      type: "text",
      text: [
        `\n\nSelected code from ${context.path}${context.range ? ` (${context.range})` : ""}:`,
        "```",
        context.text ?? "",
        "```",
      ].join("\n"),
      text_elements: [],
    });
  }

  return input;
}

export function clampPercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}
