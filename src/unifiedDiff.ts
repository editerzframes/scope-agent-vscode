export interface ChangedLineRange {
  startLine: number;
  endLine: number;
}

export interface UnifiedDiffHunk {
  id: string;
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

export interface HunkChangedLines {
  added: string[];
  removed: string[];
}

export function parseUnifiedDiffHunks(diff: string): UnifiedDiffHunk[] {
  const lines = diff.split(/\r?\n/);
  const hunks: UnifiedDiffHunk[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(lines[index] ?? "");
    if (!match) {
      continue;
    }
    const hunkLines: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && !lines[cursor]?.startsWith("@@ ") && !lines[cursor]?.startsWith("diff --git ")) {
      const line = lines[cursor] ?? "";
      if (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line.startsWith("\\ ")) {
        hunkLines.push(line);
      }
      cursor += 1;
    }
    hunks.push({
      id: `hunk-${hunks.length}-${match[1]}-${match[3]}`,
      header: lines[index] ?? "",
      oldStart: Number(match[1]),
      oldCount: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newCount: match[4] === undefined ? 1 : Number(match[4]),
      lines: hunkLines,
    });
    index = cursor - 1;
  }
  return hunks;
}

export function oldTextForHunk(hunk: UnifiedDiffHunk, eol: string): string {
  return hunk.lines
    .filter((line) => line.startsWith(" ") || line.startsWith("-"))
    .map((line) => line.slice(1))
    .join(eol);
}

export function changedLinesForHunk(hunk: UnifiedDiffHunk): HunkChangedLines {
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of hunk.lines) {
    if (line.startsWith("+")) {
      added.push(line.slice(1));
    } else if (line.startsWith("-")) {
      removed.push(line.slice(1));
    }
  }
  return { added, removed };
}

export function changedDiffLinesForHunk(hunk: UnifiedDiffHunk): string[] {
  return hunk.lines.filter((line) => line.startsWith("+") || line.startsWith("-"));
}

export function newLineRangesForHunk(hunk: UnifiedDiffHunk): ChangedLineRange[] {
  const touched = new Set<number>();
  let newLine = Math.max(0, hunk.newStart - 1);
  for (const line of hunk.lines) {
    if (line.startsWith("+")) {
      touched.add(newLine);
      newLine += 1;
    } else if (line.startsWith("-")) {
      touched.add(Math.max(0, newLine));
    } else if (line.startsWith(" ")) {
      newLine += 1;
    }
  }
  return mergeLines([...touched]);
}

export function reverseHunkInText(current: string, hunk: UnifiedDiffHunk, eol: "\n" | "\r\n"): string {
  const hasTrailingEol = current.endsWith("\n");
  const lines = current.split(/\r?\n/);
  if (hasTrailingEol) {
    lines.pop();
  }
  const startLine = Math.min(lines.length, Math.max(0, hunk.newStart - 1));
  const oldText = oldTextForHunk(hunk, eol);
  const oldLines = hunk.oldCount === 0 ? [] : oldText.split(eol);
  lines.splice(startLine, hunk.newCount, ...oldLines);
  return `${lines.join(eol)}${hasTrailingEol ? eol : ""}`;
}

/** Returns zero-based, inclusive ranges touched on the new side of a unified diff. */
export function parseUnifiedDiffNewLineRanges(diff: string): ChangedLineRange[] {
  const touched = new Set<number>();
  let newLine = -1;
  let insideHunk = false;

  for (const line of diff.split(/\r?\n/)) {
    const hunk = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line);
    if (hunk) {
      newLine = Math.max(0, Number(hunk[1]) - 1);
      insideHunk = true;
      continue;
    }
    if (!insideHunk || line.startsWith("\\ No newline at end of file")) {
      continue;
    }
    if (line.startsWith("+")) {
      touched.add(newLine);
      newLine += 1;
    } else if (line.startsWith("-")) {
      // A removed line has no new-side line of its own, so mark the line at
      // the deletion boundary. The editor layer clamps EOF deletions safely.
      touched.add(Math.max(0, newLine));
    } else if (line.startsWith(" ")) {
      newLine += 1;
    }
  }

  return mergeLines([...touched]);
}

function mergeLines(values: number[]): ChangedLineRange[] {
  const lines = values.sort((left, right) => left - right);
  const ranges: ChangedLineRange[] = [];
  for (const line of lines) {
    const previous = ranges.at(-1);
    if (previous && line <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, line);
    } else {
      ranges.push({ startLine: line, endLine: line });
    }
  }
  return ranges;
}
