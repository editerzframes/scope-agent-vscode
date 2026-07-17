export interface UnifiedFileDiff {
  oldPath: string | null;
  newPath: string | null;
  path: string;
  kind: "add" | "delete" | "update";
  diff: string;
}

export function countUnifiedDiffLines(diff: string): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deleted += 1;
    }
  }
  return { added, deleted };
}

export function parseAggregatedUnifiedDiff(diff: string): UnifiedFileDiff[] {
  const lines = diff.split(/\r?\n/);
  const starts = lines
    .map((line, index) => (line.startsWith("diff --git ") ? index : -1))
    .filter((index) => index >= 0);

  if (starts.length === 0) {
    return parseHeaderSections(lines);
  }

  const result: UnifiedFileDiff[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index] ?? 0;
    const end = starts[index + 1] ?? lines.length;
    const parsed = parseSection(lines.slice(start, end));
    if (parsed) {
      result.push(parsed);
    }
  }
  return result;
}

function parseHeaderSections(lines: string[]): UnifiedFileDiff[] {
  const result: UnifiedFileDiff[] = [];
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ")) {
      if (start >= 0) {
        const parsed = parseSection(lines.slice(start, index));
        if (parsed) {
          result.push(parsed);
        }
      }
      start = index;
    }
  }
  if (start >= 0) {
    const parsed = parseSection(lines.slice(start));
    if (parsed) {
      result.push(parsed);
    }
  }
  return result;
}

function parseSection(lines: string[]): UnifiedFileDiff | null {
  const oldHeader = lines.find((line) => line.startsWith("--- "));
  const newHeader = lines.find((line) => line.startsWith("+++ "));
  const oldPath = oldHeader ? parsePatchPath(oldHeader.slice(4)) : null;
  const newPath = newHeader ? parsePatchPath(newHeader.slice(4)) : null;
  const filePath = newPath ?? oldPath;
  if (!filePath || !lines.some((line) => line.startsWith("@@ "))) {
    return null;
  }
  return {
    oldPath,
    newPath,
    path: filePath,
    kind: oldPath === null ? "add" : newPath === null ? "delete" : "update",
    diff: lines.join("\n"),
  };
}

function parsePatchPath(value: string): string | null {
  let path = value.trim();
  if (path === "/dev/null") {
    return null;
  }
  if (path.startsWith('"')) {
    const end = path.lastIndexOf('"');
    path = end > 0 ? path.slice(1, end) : path.slice(1);
    path = path.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  } else {
    path = path.split("\t", 1)[0] ?? path;
  }
  if (path.startsWith("a/") || path.startsWith("b/")) {
    path = path.slice(2);
  }
  return path || null;
}
