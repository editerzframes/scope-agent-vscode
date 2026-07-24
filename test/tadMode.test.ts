import assert from "node:assert/strict";
import test from "node:test";
import { attachTadSkill, contentInvokesTad } from "../src/tadMode";

test("attaches the bundled TAD skill after the visible prompt", () => {
  assert.deepEqual(
    attachTadSkill(
      [{ type: "text", text: "Create the architecture document", text_elements: [] }],
      "/extension/skills/tad/SKILL.md",
    ),
    [
      { type: "text", text: "Create the architecture document", text_elements: [] },
      { type: "skill", name: "tad", path: "/extension/skills/tad/SKILL.md" },
    ],
  );
});

test("detects persisted TAD skill inputs without exposing them as chat text", () => {
  assert.equal(
    contentInvokesTad([
      { type: "text", text: "Create a TAD" },
      { type: "skill", name: "tad", path: "/extension/skills/tad/SKILL.md" },
    ]),
    true,
  );
  assert.equal(contentInvokesTad([{ type: "text", text: "Create a plan" }]), false);
  assert.equal(contentInvokesTad(undefined), false);
});
