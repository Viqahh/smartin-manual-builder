/**
 * Position helpers for ordered child collections (blocks, parameter groups, parameters).
 * Positions are non-negative; live siblings must be unique (DB enforces both). Gaps are allowed.
 */

export function nextPosition(existing: number[]): number {
  if (existing.length === 0) return 0;
  return Math.max(...existing) + 1;
}

export type ReorderCheck =
  | { ok: true }
  | { ok: false; reason: "count_mismatch" | "duplicate_id" | "unknown_id" };

/** Validate a full reorder list against the current live ids before hitting the DB. */
export function validateReorder(currentIds: string[], orderedIds: string[]): ReorderCheck {
  if (orderedIds.length !== currentIds.length) return { ok: false, reason: "count_mismatch" };
  if (new Set(orderedIds).size !== orderedIds.length) return { ok: false, reason: "duplicate_id" };
  const current = new Set(currentIds);
  for (const id of orderedIds) if (!current.has(id)) return { ok: false, reason: "unknown_id" };
  return { ok: true };
}
