import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClickUpFixPrompt,
  buildClickUpSummaryPrompt,
  parseClickUpActionTicket,
} from "../src/clickUpActions";

test("normalizes the ticket data used by ClickUp card actions", () => {
  const ticket = parseClickUpActionTicket({
    id: "BB-86022",
    title: "Cooldown timestamp is not initialized",
    category: "Bug",
    status: "Open",
    url: "https://app.clickup.com/t/86d3tzb0g",
    whyActionable: "Reproducible",
  });
  assert.deepEqual(ticket, {
    id: "BB-86022",
    title: "Cooldown timestamp is not initialized",
    category: "Bug",
    status: "Open",
    url: "https://app.clickup.com/t/86d3tzb0g",
    whyActionable: "Reproducible",
  });
  assert.equal(parseClickUpActionTicket({ id: "", title: "Missing ID" }), null);
  assert.equal(
    parseClickUpActionTicket({
      id: "BB-1",
      title: "Unsafe link",
      url: "https://evil.example/t/BB-1",
    })?.url,
    null,
  );
});

test("builds read-only summary and confirmation-gated fix prompts", () => {
  const ticket = parseClickUpActionTicket({
    id: "BB-86016",
    title: "Cooldown should start after runtime reduction",
    category: "Improvement",
  });
  assert.ok(ticket);
  assert.match(buildClickUpSummaryPrompt(ticket), /Summarize ClickUp improvement BB-86016/);
  assert.match(buildClickUpSummaryPrompt(ticket), /Do not change ClickUp or workspace files/);
  assert.match(buildClickUpFixPrompt(ticket), /Fix ClickUp improvement BB-86016/);
  assert.match(buildClickUpFixPrompt(ticket), /implement the safest focused code change/);
  assert.match(buildClickUpFixPrompt(ticket), /ask me in chat before changing code/);
});
