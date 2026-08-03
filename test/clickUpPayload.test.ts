import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  extractClickUpPayload,
  isSafeClickUpTicketUrl,
}: {
  extractClickUpPayload: (text: string) => {
    status: "valid" | "invalid" | "incomplete" | "none";
    payload: null | {
      workspace: { id: string | null; name: string; spaces: string[] };
      summary: {
        total: number;
        bugs: number;
        improvements: number;
        blocked: number;
        overdue: number;
      };
      tickets: Array<{
        rank: number;
        id: string;
        category: "Bug" | "Improvement";
        title: string;
        status: string;
        dueDate: string | null;
        whyActionable: string | null;
        url: string | null;
      }>;
      notes: string[];
    };
    displayText: string;
  };
  isSafeClickUpTicketUrl: (value: unknown) => boolean;
} = require("../media/clickupPayload.js");

function ticket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rank: 1,
    id: "BB-86022",
    category: "Bug",
    title: "Cooldown timestamp is not initialized",
    status: "Open",
    dueDate: "2026-07-24",
    overdue: true,
    blocked: false,
    assignees: ["Puneet Garg"],
    list: "Bingo Bash - Bugs",
    priority: "High",
    url: "https://app.clickup.com/t/86d3tzb0g",
    whyActionable: "Recently updated.",
    ...overrides,
  };
}

function response(payload: unknown, intro = "Found your assigned work."): string {
  return `${intro}\n\n\`\`\`clickup-tickets\n${JSON.stringify(payload)}\n\`\`\``;
}

test("parses a valid ClickUp payload and derives trustworthy summary counts", () => {
  const parsed = extractClickUpPayload(response({
    workspace: { id: "68051", name: "Workspace", spaces: ["BingoProjectManagement"] },
    summary: { total: 999, bugs: 999, improvements: 999, blocked: 999, overdue: 999 },
    tickets: [
      ticket(),
      ticket({
        rank: 2,
        id: "BB-86016",
        category: "Improvement",
        overdue: false,
        blocked: true,
      }),
    ],
    notes: ["Nothing was modified."],
  }));

  assert.equal(parsed.status, "valid");
  assert.equal(parsed.displayText, "Found your assigned work.");
  assert.deepEqual(parsed.payload?.summary, {
    total: 2,
    bugs: 1,
    improvements: 1,
    blocked: 1,
    overdue: 1,
  });
  assert.equal(parsed.payload?.workspace.spaces[0], "BingoProjectManagement");
  assert.equal(parsed.payload?.tickets[1].category, "Improvement");
});

test("keeps five or more tickets as ordered compact-card data", () => {
  const tickets = Array.from({ length: 6 }, (_, index) => ticket({
    rank: index + 1,
    id: `BB-${86022 - index}`,
    title: `Ticket ${index + 1}`,
  }));
  const parsed = extractClickUpPayload(response({
    workspace: { name: "Workspace", spaces: ["BingoProjectManagement"] },
    tickets,
  }));

  assert.equal(parsed.status, "valid");
  assert.equal(parsed.payload?.tickets.length, 6);
  assert.deepEqual(parsed.payload?.tickets.map((item) => item.rank), [1, 2, 3, 4, 5, 6]);
});

test("hides malformed and partial JSON instead of exposing it as chat text", () => {
  const malformed = extractClickUpPayload(
    "Results\n```clickup-tickets\n{\"workspace\":{\"secret\":\"raw\"}, bad}\n```",
  );
  assert.equal(malformed.status, "invalid");
  assert.doesNotMatch(malformed.displayText, /secret|workspace|bad/);
  assert.match(malformed.displayText, /could not be displayed safely/i);

  const partial = extractClickUpPayload(
    "Preparing cards\n```clickup-tickets\n{\"tickets\":[{\"id\":\"BB-",
  );
  assert.equal(partial.status, "incomplete");
  assert.equal(partial.displayText, "Preparing cards");
});

test("drops non-ClickUp ticket URLs while preserving safe ticket content", () => {
  const parsed = extractClickUpPayload(response({
    workspace: { name: "Workspace" },
    tickets: [ticket({ url: "https://evil.example/t/86d3tzb0g" })],
  }));
  assert.equal(parsed.status, "valid");
  assert.equal(parsed.payload?.tickets[0].url, null);

  assert.equal(isSafeClickUpTicketUrl("https://app.clickup.com/t/86d3tzb0g"), true);
  assert.equal(isSafeClickUpTicketUrl("http://app.clickup.com/t/86d3tzb0g"), false);
  assert.equal(isSafeClickUpTicketUrl("https://app.clickup.com/settings"), false);
  assert.equal(isSafeClickUpTicketUrl("https://app.clickup.com.evil.example/t/86d3tzb0g"), false);
});

test("upgrades the legacy Markdown table from existing ClickUp chats into card data", () => {
  const legacy = [
    "Verified active authorized Workspace: **Workspace** (`68051`), containing the **BingoProjectManagement** Space.",
    "",
    "| Rank | Ticket | Type | Actionability |",
    "|---|---|---|---|",
    "| 1 | [BB-86022](https://app.clickup.com/t/86d3tzb0g) — Cooldown timestamp isn't initialized during an active session | Bug | Recently updated and solely assigned to you. |",
    "| 2 | [BB-86016](https://app.clickup.com/t/86d3tz3mn) — Cooldown should start after runtime skip-count reduction | Improvement | Updated today and related to BB-86022. |",
    "| 3 | [BB-12276](https://app.clickup.com/t/86d1058he) — Purchased Album Bash Pack isn't displayed | Bug | Potential live reward-loss issue. |",
    "| 4 | [BB-12293](https://app.clickup.com/t/86d105x5v) — Expired Album rewards remain | Bug | Existing live issue. |",
    "| 5 | [BB-11640](https://app.clickup.com/t/86d0y29bg) — Freebie link redirects to the game | Bug | Clear reproduction path. |",
    "",
    "All five are `Open`, with no due dates or explicit priorities. No changes were made.",
  ].join("\n");
  const parsed = extractClickUpPayload(legacy);

  assert.equal(parsed.status, "valid");
  assert.equal(parsed.displayText, "");
  assert.equal(parsed.payload?.workspace.id, "68051");
  assert.equal(parsed.payload?.workspace.name, "Workspace");
  assert.deepEqual(parsed.payload?.workspace.spaces, ["BingoProjectManagement"]);
  assert.deepEqual(parsed.payload?.summary, {
    total: 5,
    bugs: 4,
    improvements: 1,
    blocked: 0,
    overdue: 0,
  });
  assert.equal(parsed.payload?.tickets[0].status, "Open");
  assert.equal(parsed.payload?.tickets[0].title, "Cooldown timestamp isn't initialized during an active session");
  assert.equal(parsed.payload?.tickets[1].category, "Improvement");
  assert.equal(parsed.payload?.tickets[4].url, "https://app.clickup.com/t/86d0y29bg");
  assert.match(parsed.payload?.notes[0] || "", /No changes were made/);
});
