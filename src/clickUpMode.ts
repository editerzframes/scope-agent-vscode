import { isRecord, UserInput } from "./protocol";

export const CLICKUP_SKILL_NAME = "clickup-my-tickets";

export const FETCH_MY_CLICKUP_TICKETS_PROMPT = [
  "Fetch my incomplete ClickUp Bug and Improvement tickets assigned to the currently authenticated ClickUp user.",
  "Verify and name the active authorized Workspace, keep this read-only, and show the most actionable tickets first.",
  "Finish with exactly one fenced clickup-tickets JSON block using the bundled skill contract; do not return a Markdown table.",
].join(" ");

export function attachClickUpSkill(input: UserInput[], skillPath: string): UserInput[] {
  return [
    ...input,
    {
      type: "skill",
      name: CLICKUP_SKILL_NAME,
      path: skillPath,
    },
  ];
}

export function contentInvokesClickUp(content: unknown): boolean {
  return Array.isArray(content) && content.some(
    (part) =>
      isRecord(part) &&
      part.type === "skill" &&
      part.name === CLICKUP_SKILL_NAME,
  );
}
