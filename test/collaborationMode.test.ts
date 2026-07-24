import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodexCollaborationMode,
  normalizeCollaborationMode,
} from "../src/collaborationMode";

test("normalizes persisted collaboration modes", () => {
  assert.equal(normalizeCollaborationMode("plan"), "plan");
  assert.equal(normalizeCollaborationMode("tad"), "tad");
  assert.equal(normalizeCollaborationMode("clickup"), "clickup");
  assert.equal(normalizeCollaborationMode("agent"), "agent");
  assert.equal(normalizeCollaborationMode("unknown"), "agent");
  assert.equal(normalizeCollaborationMode(undefined), "agent");
});

test("maps the Agent option to the app-server default mode", () => {
  assert.deepEqual(buildCodexCollaborationMode("agent", "gpt-5.6-sol", ""), {
    mode: "default",
    settings: {
      model: "gpt-5.6-sol",
      reasoning_effort: null,
      developer_instructions: null,
    },
  });
});

test("maps Plan to native plan mode with medium reasoning by default", () => {
  assert.deepEqual(buildCodexCollaborationMode("plan", "gpt-5.6-sol", ""), {
    mode: "plan",
    settings: {
      model: "gpt-5.6-sol",
      reasoning_effort: "medium",
      developer_instructions: null,
    },
  });
});

test("maps TAD to native plan mode with medium reasoning by default", () => {
  assert.deepEqual(buildCodexCollaborationMode("tad", "gpt-5.6-sol", ""), {
    mode: "plan",
    settings: {
      model: "gpt-5.6-sol",
      reasoning_effort: "medium",
      developer_instructions: null,
    },
  });
});

test("maps ClickUp to default mode so it can call MCP tools without producing a plan artifact", () => {
  assert.deepEqual(buildCodexCollaborationMode("clickup", "gpt-5.6-sol", ""), {
    mode: "default",
    settings: {
      model: "gpt-5.6-sol",
      reasoning_effort: null,
      developer_instructions: null,
    },
  });
});

test("preserves an explicitly configured reasoning effort", () => {
  assert.equal(
    buildCodexCollaborationMode("plan", "gpt-5.6-sol", "high")?.settings.reasoning_effort,
    "high",
  );
  assert.equal(buildCodexCollaborationMode("agent", "", ""), undefined);
});
