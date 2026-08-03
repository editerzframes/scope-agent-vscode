export interface ReviewSnapshot {
  exists: boolean;
  text: string;
}

export type ReviewChangeKind = "add" | "delete" | "update";

export function appliedSnapshotIsVisible(
  original: ReviewSnapshot | null,
  after: ReviewSnapshot,
  kind: ReviewChangeKind,
): boolean {
  if (kind === "add") {
    return after.exists;
  }
  if (kind === "delete") {
    return !after.exists;
  }
  if (!original) {
    return true;
  }
  return original.exists !== after.exists || original.text !== after.text;
}
