import assert from "node:assert/strict";
import test from "node:test";
import { countUnifiedDiffLines, parseAggregatedUnifiedDiff } from "../src/turnDiff";

test("splits an aggregated git diff into file patches", () => {
  const files = parseAggregatedUnifiedDiff([
    "diff --git a/src/one.ts b/src/one.ts",
    "--- a/src/one.ts",
    "+++ b/src/one.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "diff --git a/src/new file.ts b/src/new file.ts",
    "--- /dev/null",
    "+++ b/src/new file.ts",
    "@@ -0,0 +1 @@",
    "+created",
  ].join("\n"));

  assert.equal(files.length, 2);
  assert.deepEqual(files.map((file) => ({ path: file.path, kind: file.kind })), [
    { path: "src/one.ts", kind: "update" },
    { path: "src/new file.ts", kind: "add" },
  ]);
});

test("counts added and deleted source lines without diff headers", () => {
  assert.deepEqual(countUnifiedDiffLines("--- a/a.ts\n+++ b/a.ts\n-old\n+new\n+extra"), {
    added: 2,
    deleted: 1,
  });
});
