import { isSafeClickUpTicketUrl } from "./externalUrls";
import { isRecord } from "./protocol";

export interface ClickUpActionTicket {
  id: string;
  title: string;
  category: "Bug" | "Improvement";
  status: string | null;
  url: string | null;
  whyActionable: string | null;
}

export function parseClickUpActionTicket(value: unknown): ClickUpActionTicket | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") {
    return null;
  }
  const id = value.id.trim().slice(0, 120);
  const title = value.title.trim().slice(0, 500);
  if (!id || !title) {
    return null;
  }
  return {
    id,
    title,
    category: String(value.category || "").toLowerCase() === "improvement"
      ? "Improvement"
      : "Bug",
    status: optionalString(value.status, 120),
    url: isSafeClickUpTicketUrl(value.url) ? value.url : null,
    whyActionable: optionalString(value.whyActionable, 1000),
  };
}

export function buildClickUpSummaryPrompt(ticket: ClickUpActionTicket): string {
  return [
    `Summarize ClickUp ${ticket.category.toLowerCase()} ${ticket.id}: ${ticket.title}.`,
    "Use the ticket context already available in this chat and retrieve read-only details only when needed.",
    "Cover the problem, expected behavior, impact, reproduction evidence, important unknowns, and the recommended next step.",
    "Do not change ClickUp or workspace files.",
  ].join(" ");
}

export function buildClickUpFixPrompt(ticket: ClickUpActionTicket): string {
  return [
    `Fix ClickUp ${ticket.category.toLowerCase()} ${ticket.id}: ${ticket.title}.`,
    "Use the ticket context already available in this chat.",
    "Inspect the repository, confirm the root cause, implement the safest focused code change, and run the relevant verification.",
    "Do not modify the ClickUp ticket.",
    "If the available ticket context is insufficient or a meaningful product decision is required, ask me in chat before changing code.",
  ].join(" ");
}

function optionalString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" ? value.trim().slice(0, maxLength) || null : null;
}
