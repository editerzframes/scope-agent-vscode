import assert from "node:assert/strict";
import test from "node:test";
import {
  changedDiffLinesForHunk,
  changedLinesForHunk,
  oldTextForHunk,
  parseUnifiedDiffHunks,
  parseUnifiedDiffNewLineRanges,
  reverseHunkInText,
} from "../src/unifiedDiff";

test("extracts the before and after lines for an inline review block", () => {
  const [hunk] = parseUnifiedDiffHunks("@@ -7,2 +7,2 @@\n--- old option\n-before\n+++ new option\n+after");
  assert.deepEqual(hunk && changedLinesForHunk(hunk), {
    removed: ["-- old option", "before"],
    added: ["++ new option", "after"],
  });
  assert.deepEqual(hunk && changedDiffLinesForHunk(hunk), [
    "--- old option",
    "-before",
    "+++ new option",
    "+after",
  ]);
});

test("reverses source lines that resemble unified-diff file headers", () => {
  const [hunk] = parseUnifiedDiffHunks("@@ -1,1 +1,1 @@\n---old flag\n+++new flag");
  assert.equal(hunk && oldTextForHunk(hunk, "\n"), "--old flag");
  assert.equal(hunk && reverseHunkInText("++new flag\n", hunk, "\n"), "--old flag\n");
});

test("parses added and replaced lines from multiple unified-diff hunks", () => {
  const ranges = parseUnifiedDiffNewLineRanges([
    "--- a/app.ts",
    "+++ b/app.ts",
    "@@ -2,3 +2,4 @@",
    " keep",
    "-old",
    "+new",
    "+extra",
    " tail",
    "@@ -20,2 +21,2 @@ function later() {",
    "-before",
    "+after",
    " same",
  ].join("\n"));

  assert.deepEqual(ranges, [
    { startLine: 2, endLine: 3 },
    { startLine: 20, endLine: 20 },
  ]);
});

test("marks the new-side boundary for a deletion-only hunk", () => {
  const ranges = parseUnifiedDiffNewLineRanges("@@ -4,2 +4,0 @@\n-gone\n-also gone");
  assert.deepEqual(ranges, [{ startLine: 3, endLine: 3 }]);
});

test("extracts reversible hunk metadata", () => {
  const [hunk] = parseUnifiedDiffHunks("@@ -4,2 +4,3 @@\n-old\n+new\n+extra\n keep");
  assert.equal(hunk?.oldStart, 4);
  assert.equal(hunk?.oldCount, 2);
  assert.equal(hunk?.newStart, 4);
  assert.equal(hunk?.newCount, 3);
  assert.equal(hunk && oldTextForHunk(hunk, "\n"), "old\nkeep");
  assert.equal(
    hunk && reverseHunkInText("one\ntwo\nthree\nnew\nextra\nkeep\nseven\n", hunk, "\n"),
    "one\ntwo\nthree\nold\nkeep\nseven\n",
  );
});

test("reverses an appended hunk without leaving a stray newline", () => {
  const [hunk] = parseUnifiedDiffHunks("@@ -1,0 +2,1 @@\n+added");
  assert.equal(hunk && reverseHunkInText("base\nadded", hunk, "\n"), "base");
});
