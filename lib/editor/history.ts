/**
 * Application-level snapshot history for structural editor operations (AC-P3-12).
 *
 * TipTap owns undo/redo for keystroke-level rich-text editing *inside* a text/callout/faq body.
 * This stack owns undo/redo for structural operations the editor performs on the block list:
 * block add, block remove/restore, block reorder, and committed block-payload edits. Each entry
 * is a full immutable snapshot of the editable state, so undo cannot produce a partial or
 * diverging tree — it replays a known-good snapshot, which is then reconciled to the server.
 *
 * It is a pure state container (no React) so it is unit-testable and can be driven by a hook.
 */

export type History<S> = {
  present: S;
  past: S[];
  future: S[];
  limit: number;
};

export function createHistory<S>(initial: S, limit = 50): History<S> {
  return { present: initial, past: [], future: [], limit };
}

/**
 * Record a new present state, clearing the redo stack. No-op when `next` is equal to the
 * current present — by reference, or by the optional `eq` comparator (so a redundant snapshot,
 * e.g. a re-save that only bumped a row version, never creates a phantom undo step).
 */
export function pushHistory<S>(h: History<S>, next: S, eq: (a: S, b: S) => boolean = Object.is): History<S> {
  if (eq(next, h.present)) return h;
  const past = [...h.past, h.present];
  if (past.length > h.limit) past.shift();
  return { ...h, present: next, past, future: [] };
}

/** Replace the present state WITHOUT creating an undo entry (e.g. server reconciliation). */
export function replacePresent<S>(h: History<S>, next: S): History<S> {
  return { ...h, present: next };
}

export function canUndo<S>(h: History<S>): boolean {
  return h.past.length > 0;
}
export function canRedo<S>(h: History<S>): boolean {
  return h.future.length > 0;
}

export function undo<S>(h: History<S>): History<S> {
  if (h.past.length === 0) return h;
  const past = h.past.slice(0, -1);
  const present = h.past[h.past.length - 1];
  return { ...h, present, past, future: [h.present, ...h.future] };
}

export function redo<S>(h: History<S>): History<S> {
  if (h.future.length === 0) return h;
  const [present, ...future] = h.future;
  return { ...h, present, past: [...h.past, h.present], future };
}
