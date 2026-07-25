import assert from "node:assert/strict";
import test from "node:test";
import {
  deletedLinePreviewForHunk,
  deletedLinePreviewHtml,
} from "../src/deletedLinePreview";
import { UnifiedDiffHunk } from "../src/unifiedDiff";

function hunk(values: Partial<UnifiedDiffHunk> = {}): UnifiedDiffHunk {
  return {
    id: "hunk-0",
    header: "@@ -2,1 +2,1 @@",
    oldStart: 2,
    oldCount: 1,
    newStart: 2,
    newCount: 1,
    lines: ["-before();", "+after();"],
    ...values,
  };
}

test("anchors removed lines immediately before the modified block", () => {
  const preview = deletedLinePreviewForHunk(hunk(), 8);

  assert.ok(preview);
  assert.equal(preview.afterLine, 0);
  assert.equal(preview.heightInLines, 1);
  assert.deepEqual(preview.lines, ["before();"]);
});

test("supports a deletion before the first document line", () => {
  const preview = deletedLinePreviewForHunk(hunk({ newStart: 1 }), 4);

  assert.ok(preview);
  assert.equal(preview.afterLine, -1);
});

test("anchors an end-of-file deletion after the final line", () => {
  const preview = deletedLinePreviewForHunk(hunk({ newStart: 20 }), 5);

  assert.ok(preview);
  assert.equal(preview.afterLine, 4);
});

test("does not create a preview for a pure addition", () => {
  const preview = deletedLinePreviewForHunk(
    hunk({
      oldCount: 0,
      lines: ["+after();"],
    }),
    4,
  );

  assert.equal(preview, null);
});

test("limits very large deleted blocks while preserving the omitted count", () => {
  const preview = deletedLinePreviewForHunk(
    hunk({
      oldCount: 4,
      lines: ["-one", "-two", "-three", "-four", "+replacement"],
    }),
    8,
    2,
  );

  assert.ok(preview);
  assert.deepEqual(preview.lines, ["one", "two"]);
  assert.equal(preview.hiddenLineCount, 2);
  assert.equal(preview.heightInLines, 3);
});

test("escapes source text before placing it in the inset webview", () => {
  const preview = deletedLinePreviewForHunk(
    hunk({ lines: ["-<script>alert('x')</script>", "+safe"] }),
    4,
  );

  assert.ok(preview);
  const html = deletedLinePreviewHtml(preview, "https://example.invalid");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  assert.match(html, /diffEditor-removedLineBackground/);
});
