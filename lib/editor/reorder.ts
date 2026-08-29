/**
 * Pure reorder helpers shared by chapter and block reordering (AC-P3-5).
 * Both pointer drag and keyboard up/down resolve to the same `arrayMove` here, so the two
 * input paths can never diverge. The DB reorder RPCs stay the transactional source of truth;
 * these run client-side for optimistic state + to compute the id list to send.
 */

/** Move the item at `from` to index `to`, clamping to bounds. Returns a new array. */
export function arrayMove<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(to, next.length - 1));
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Keyboard step: -1 = up, +1 = down. */
export function moveByStep<T>(list: readonly T[], index: number, dir: -1 | 1): T[] {
  return arrayMove(list, index, index + dir);
}

/** True when `ids` is a permutation of `current` (contiguous + unique + same members). */
export function isValidPermutation(current: readonly string[], ids: readonly string[]): boolean {
  if (ids.length !== current.length) return false;
  if (new Set(ids).size !== ids.length) return false;
  const have = new Set(current);
  return ids.every((id) => have.has(id));
}

/** Assign contiguous 0..n-1 positions in list order. */
export function contiguousPositions<T extends { id: string }>(list: readonly T[]): { id: string; position: number }[] {
  return list.map((item, i) => ({ id: item.id, position: i }));
}
