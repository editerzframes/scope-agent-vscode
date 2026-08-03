import assert from "node:assert/strict";
import test from "node:test";
import {
  attachClickUpSkill,
  CLICKUP_SKILL_NAME,
  contentInvokesClickUp,
  FETCH_MY_CLICKUP_TICKETS_PROMPT,
} from "../src/clickUpMode";

test("attaches the bundled ClickUp skill after the visible prompt", () => {
  assert.deepEqual(
    attachClickUpSkill(
      [{ type: "text", text: FETCH_MY_CLICKUP_TICKETS_PROMPT, text_elements: [] }],
      "/extension/skills/clickup-my-tickets/SKILL.md",
    ),
    [
      { type: "text", text: FETCH_MY_CLICKUP_TICKETS_PROMPT, text_elements: [] },
      {
        type: "skill",
        name: CLICKUP_SKILL_NAME,
        path: "/extension/skills/clickup-my-tickets/SKILL.md",
      },
    ],
  );
});

test("the automatic ClickUp request is assigned-user, workspace-verifying, and read-only scoped", () => {
  assert.match(FETCH_MY_CLICKUP_TICKETS_PROMPT, /assigned to the currently authenticated ClickUp user/i);
  assert.match(FETCH_MY_CLICKUP_TICKETS_PROMPT, /Bug and Improvement/i);
  assert.match(FETCH_MY_CLICKUP_TICKETS_PROMPT, /active authorized Workspace/i);
  assert.match(FETCH_MY_CLICKUP_TICKETS_PROMPT, /read-only/i);
});

test("detects ClickUp skill attachments when restoring a chat", () => {
  assert.equal(
    contentInvokesClickUp([
      { type: "text", text: "Fetch tickets" },
      { type: "skill", name: CLICKUP_SKILL_NAME, path: "/extension/SKILL.md" },
    ]),
    true,
  );
  assert.equal(
    contentInvokesClickUp([{ type: "skill", name: "another-skill", path: "/extension/SKILL.md" }]),
    false,
  );
  assert.equal(contentInvokesClickUp(null), false);
});
