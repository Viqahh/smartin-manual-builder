/**
 * Phase 8A.5 — the Preview-open transition, extracted so its exactly-once semantics are unit
 * tested independently of <ManualBuilder>.
 *
 * Sequence: SYNCHRONOUS re-entrancy guard → save barrier (`flushPending`) → (on success) fire
 * route revalidation non-blocking → navigate exactly once. On a failed flush the caller stays
 * in the editor with a visible message; nothing navigates silently. `/preview` is
 * `force-dynamic` and never prefetched, so the navigation always renders current data — no hard
 * browser refresh, and the revalidation is not on the critical path.
 */
export type FlushResult = { ok: boolean; failedKeys: string[] };

export type OpenPreviewOutcome = "navigated" | "blocked-unsaved" | "error" | "reentry";

export async function openPreviewTransition(deps: {
  /** shared synchronous guard — the same ref that gates chapter navigation */
  guard: { current: boolean };
  flushPending: () => Promise<FlushResult | undefined>;
  /** fire-and-forget: mark /edit + /preview stale (block saves already do this per write) */
  revalidate: () => void;
  navigate: () => void;
  setOpening: (v: boolean) => void;
  setMessage: (m: string | null) => void;
}): Promise<OpenPreviewOutcome> {
  if (deps.guard.current) return "reentry"; // a repeated click before React re-renders
  deps.guard.current = true;
  deps.setOpening(true);
  let navigating = false;
  try {
    const r = await deps.flushPending();
    if (r && !r.ok) {
      deps.setMessage(
        "Perubahan belum tersimpan — perbaiki blok yang gagal sebelum membuka Preview.",
      );
      return "blocked-unsaved";
    }
    deps.setMessage(null);
    deps.revalidate();
    navigating = true;
    deps.navigate();
    return "navigated";
  } catch {
    deps.setMessage("Gagal membuka Preview. Coba lagi.");
    return "error";
  } finally {
    // On success the builder unmounts as the route changes — keep the button in its
    // "Membuka preview…" state. Only release the guard when we did NOT navigate.
    if (!navigating) {
      deps.guard.current = false;
      deps.setOpening(false);
    }
  }
}
