import type { ManualStatusDb } from "@/lib/supabase/database.types";

export type ManualListRow = {
  manualId: string;
  eaName: string;
  platform: "MT4" | "MT5";
  eaVersion: string;
  manualVersion: string;
  status: ManualStatusDb;
  updatedAt: string;
  sectionsTotal: number;
};

/** `manual_versions.version` is DB-checked as `^\d+\.\d+\.\d+$` — parse defensively anyway. */
function parseSemver(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/** Highest manual version wins, comparing numerically (major, then minor, then patch). */
function isNewerVersion(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

/**
 * Phase 8B-5 — `listManuals`'s underlying query is one row per manual_version, not per manual: a
 * manual with more than one version (e.g. an ARCHIVED v1 + a PUBLISHED v2) produced duplicate
 * `manualId`s, which both violated the "one row per manual" contract and threw a React
 * duplicate-key warning wherever the list is rendered (Dashboard "Manual terbaru", `/manuals`).
 *
 * "Latest manual version" means the highest `(major, minor, patch)` version number for that
 * manual — decided by parsing `manualVersion` (DB-checked semver, unique per manual), NEVER by
 * `updatedAt` or input/row order. `updated_at` is an activity timestamp: an older version can be
 * touched again (e.g. archived) after a newer version already exists, which would make it look
 * "more recent" by `updatedAt` while still being the wrong version to show — and two versions
 * can legitimately share the same `updated_at` (e.g. bulk-created), where relying on whichever
 * row the database happened to return first would be non-deterministic. Comparing the version
 * number itself has no such ambiguity: `unique (manual_id, version)` guarantees no ties.
 *
 * The relative ORDER of manuals in the output (which one appears first in a list) still follows
 * the input order — callers order the underlying query by `updated_at` DESC, so more recently
 * active manuals still sort first; only the row CONTENT chosen to represent each manual is
 * version-based rather than order-based. Pure (no I/O) — kept out of
 * `features/manuals/queries.ts` (which is `server-only`) so it's unit-testable directly.
 */
export function dedupeLatestManualVersion(rows: ManualListRow[]): ManualListRow[] {
  const order: string[] = [];
  const best = new Map<string, ManualListRow>();
  for (const r of rows) {
    if (!best.has(r.manualId)) order.push(r.manualId);
    const current = best.get(r.manualId);
    if (!current || isNewerVersion(r.manualVersion, current.manualVersion)) {
      best.set(r.manualId, r);
    }
  }
  return order.map((id) => best.get(id) as ManualListRow);
}
