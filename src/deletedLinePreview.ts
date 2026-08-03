import { changedLinesForHunk, UnifiedDiffHunk } from "./unifiedDiff";

export const MAX_VISIBLE_DELETED_LINES = 18;

export interface DeletedLinePreview {
  afterLine: number;
  heightInLines: number;
  lines: string[];
  hiddenLineCount: number;
  signature: string;
}

export function deletedLinePreviewForHunk(
  hunk: UnifiedDiffHunk,
  documentLineCount: number,
  maxVisibleLines = MAX_VISIBLE_DELETED_LINES,
): DeletedLinePreview | null {
  const removed = changedLinesForHunk(hunk).removed;
  if (removed.length === 0) {
    return null;
  }

  const safeLineCount = Math.max(1, documentLineCount);
  const insertionBoundary = Math.max(0, hunk.newStart - 1);
  const afterLine = insertionBoundary === 0
    ? -1
    : Math.min(safeLineCount - 1, insertionBoundary - 1);
  const visibleLimit = Math.max(1, maxVisibleLines);
  const lines = removed.slice(0, visibleLimit);
  const hiddenLineCount = Math.max(0, removed.length - lines.length);
  const heightInLines = lines.length + (hiddenLineCount > 0 ? 1 : 0);

  return {
    afterLine,
    heightInLines,
    lines,
    hiddenLineCount,
    signature: [
      afterLine,
      heightInLines,
      hiddenLineCount,
      ...lines,
    ].join("\u0000"),
  };
}

export function deletedLinePreviewHtml(
  preview: DeletedLinePreview,
  cspSource: string,
): string {
  const rows = preview.lines
    .map(
      (line) =>
        `<div class="deleted-line"><span class="marker" aria-hidden="true">−</span><code>${escapeHtml(line) || " "}</code></div>`,
    )
    .join("");
  const remaining = preview.hiddenLineCount > 0
    ? `<div class="deleted-line remainder"><span class="marker" aria-hidden="true">…</span><code>${preview.hiddenLineCount} more removed line${preview.hiddenLineCount === 1 ? "" : "s"} — hover the green block for the full diff</code></div>`
    : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(cspSource)} 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      color-scheme: light dark;
    }

    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: transparent;
    }

    body {
      box-sizing: border-box;
      border-left: 3px solid var(--vscode-editorOverviewRuler-deletedForeground, var(--vscode-editorError-foreground, #f14c4c));
      background: var(--vscode-diffEditor-removedLineBackground, rgba(255, 0, 0, 0.16));
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      font-weight: var(--vscode-editor-font-weight, normal);
      pointer-events: none;
    }

    .deleted-line {
      display: flex;
      align-items: center;
      box-sizing: border-box;
      min-width: 100%;
      min-height: calc(100% / ${preview.heightInLines});
      white-space: pre;
    }

    .marker {
      flex: 0 0 2.5ch;
      box-sizing: border-box;
      padding-left: 0.55ch;
      color: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-editorError-foreground, #f14c4c));
      font-weight: 600;
      user-select: none;
    }

    code {
      display: block;
      min-width: 0;
      padding-right: 1ch;
      overflow: hidden;
      text-overflow: clip;
      color: inherit;
      font: inherit;
    }

    .remainder {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }

    @media (forced-colors: active) {
      body {
        border: 1px solid CanvasText;
        border-left-width: 3px;
        background: Canvas;
        color: CanvasText;
      }

      .marker {
        color: CanvasText;
      }
    }
  </style>
</head>
<body aria-label="Removed code preview">
  ${rows}${remaining}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
