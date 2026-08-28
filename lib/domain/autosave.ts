/**
 * Autosave + optimistic-concurrency logic for the manual builder (PRD-MAN-012, AC-P2-20).
 *
 * Strategy (recorded here and in docs/PHASE_2.md):
 *   - Every editable row carries a monotonic `row_version` (bigint) bumped by a DB trigger.
 *   - The client sends the `row_version` it last read as `expectedVersion`.
 *   - The server mutation runs `UPDATE ... WHERE id = $id AND row_version = $expectedVersion`.
 *   - 0 rows affected => a newer write landed first => return CONFLICT, do NOT overwrite.
 *   - The client shows "Konflik perubahan" and offers reload; it never shows "Tersimpan"
 *     unless the server confirmed success.
 */

export type SaveState =
  | "idle" // Belum disimpan (no unsaved changes)
  | "dirty" // Belum disimpan (unsaved edits pending flush)
  | "saving" // Menyimpan...
  | "saved" // Tersimpan
  | "error" // Gagal menyimpan
  | "conflict"; // Konflik perubahan

export const SAVE_STATE_LABEL: Record<SaveState, string> = {
  idle: "Belum ada perubahan",
  dirty: "Belum disimpan",
  saving: "Menyimpan…",
  saved: "Tersimpan",
  error: "Gagal menyimpan",
  conflict: "Konflik perubahan",
};

export type WriteOutcome<T> =
  | { status: "ok"; row: T }
  | { status: "conflict"; serverVersion: number | null }
  | { status: "error"; message: string };

/**
 * Pure decision used by both the server mutation and its unit tests: given the version
 * the client believed it was editing and the version currently in the database, may the
 * write proceed?
 */
export function resolveWrite(params: {
  expectedVersion: number;
  serverVersion: number | null;
}): { proceed: boolean; reason: "match" | "stale" | "missing" } {
  if (params.serverVersion === null) return { proceed: false, reason: "missing" };
  if (params.serverVersion === params.expectedVersion) return { proceed: true, reason: "match" };
  return { proceed: false, reason: "stale" };
}

export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 800;
