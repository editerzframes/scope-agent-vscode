import assert from "node:assert/strict";
import test from "node:test";
import { buildUserInputs, clampPercent, parseRpcLine } from "../src/protocol";

test("parseRpcLine accepts app-server responses and notifications", () => {
  assert.deepEqual(parseRpcLine('{"id":1,"result":{"ok":true}}'), {
    id: 1,
    result: { ok: true },
  });
  assert.deepEqual(parseRpcLine('{"method":"turn/completed","params":{"threadId":"t1"}}'), {
    method: "turn/completed",
    params: { threadId: "t1" },
  });
});

test("parseRpcLine rejects invalid protocol payloads", () => {
  assert.throws(() => parseRpcLine("[]"), /non-object/);
  assert.throws(() => parseRpcLine('{"params":{}}'), /invalid protocol/);
});

test("buildUserInputs keeps file mentions and selected text structured", () => {
  const input = buildUserInputs("Fix the bug", [
    {
      id: "file",
      kind: "file",
      label: "app.ts",
      path: "/repo/app.ts",
    },
    {
      id: "selection",
      kind: "selection",
      label: "util.ts:4-8",
      path: "/repo/util.ts",
      range: "lines 4-8",
      text: "return false;",
    },
  ]);

  assert.deepEqual(input[0], { type: "text", text: "Fix the bug", text_elements: [] });
  assert.deepEqual(input[1], { type: "mention", name: "app.ts", path: "/repo/app.ts" });
  assert.equal(input[2]?.type, "text");
  assert.match(input[2]?.type === "text" ? input[2].text : "", /return false/);
});

test("clampPercent normalizes rate-limit values", () => {
  assert.equal(clampPercent(-2), 0);
  assert.equal(clampPercent(52.5), 52.5);
  assert.equal(clampPercent(180), 100);
  assert.equal(clampPercent("50"), 0);
});
