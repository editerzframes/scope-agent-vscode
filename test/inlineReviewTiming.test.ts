import assert from "node:assert/strict";
import test from "node:test";
import { appliedSnapshotIsVisible } from "../src/inlineReviewTiming";

test("waits for an update to become visible on disk", () => {
  const original = { exists: true, text: "before" };
  assert.equal(appliedSnapshotIsVisible(original, original, "update"), false);
  assert.equal(appliedSnapshotIsVisible(original, { exists: true, text: "after" }, "update"), true);
});

test("recognizes completed additions and deletions", () => {
  assert.equal(appliedSnapshotIsVisible({ exists: false, text: "" }, { exists: false, text: "" }, "add"), false);
  assert.equal(appliedSnapshotIsVisible({ exists: false, text: "" }, { exists: true, text: "new" }, "add"), true);
  assert.equal(appliedSnapshotIsVisible({ exists: true, text: "old" }, { exists: true, text: "old" }, "delete"), false);
  assert.equal(appliedSnapshotIsVisible({ exists: true, text: "old" }, { exists: false, text: "" }, "delete"), true);
});

test("allows keep-only review when no original snapshot is available", () => {
  assert.equal(appliedSnapshotIsVisible(null, { exists: true, text: "current" }, "update"), true);
});
