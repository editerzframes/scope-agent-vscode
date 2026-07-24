import { isRecord, UserInput } from "./protocol";

export const TAD_SKILL_NAME = "tad";

export function attachTadSkill(input: UserInput[], skillPath: string): UserInput[] {
  return [
    ...input,
    {
      type: "skill",
      name: TAD_SKILL_NAME,
      path: skillPath,
    },
  ];
}

export function contentInvokesTad(content: unknown): boolean {
  return Array.isArray(content) && content.some(
    (part) =>
      isRecord(part) &&
      part.type === "skill" &&
      part.name === TAD_SKILL_NAME,
  );
}
