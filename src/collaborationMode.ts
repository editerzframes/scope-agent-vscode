export type CollaborationModeSelection = "agent" | "plan" | "tad" | "clickup";

export interface CodexCollaborationMode {
  mode: "default" | "plan";
  settings: {
    model: string;
    reasoning_effort: string | null;
    developer_instructions: null;
  };
}

export function normalizeCollaborationMode(value: unknown): CollaborationModeSelection {
  return value === "plan" || value === "tad" || value === "clickup" ? value : "agent";
}

export function buildCodexCollaborationMode(
  selection: CollaborationModeSelection,
  model: string,
  reasoningEffort: string,
): CodexCollaborationMode | undefined {
  const normalizedModel = model.trim();
  if (!normalizedModel) {
    return undefined;
  }

  return {
    mode: selection === "plan" || selection === "tad" ? "plan" : "default",
    settings: {
      model: normalizedModel,
      reasoning_effort: reasoningEffort.trim() || (
        selection === "plan" || selection === "tad" ? "medium" : null
      ),
      developer_instructions: null,
    },
  };
}
