import { createHash } from "node:crypto";

/**
 * Phase 7 slice 4B — pure helpers for the content-addressed PDF artifact.
 *
 * Kept free of `server-only` / Supabase imports so the key convention (which the DB RPC also
 * validates) is unit-testable. The storage key is derived ONLY from the frozen immutable snapshot
 * hash + the pipeline version — no DB uuid, no user input.
 */

export const PDF_ARTIFACT_BUCKET = "manual-pdf-artifacts";
/** PDF generation pipeline + storage-key schema version. Bump only on a deliberate pipeline change. */
export const PDF_ARTIFACT_VERSION = 1;

/** `pdf/v<version>/<snapshotContentHash>.pdf` — the `complete_pdf_artifact_generation` RPC
 *  rejects anything that does not match this exact shape for the row's hash + version. */
export function pdfArtifactStorageKey(snapshotContentHash: string, version = PDF_ARTIFACT_VERSION): string {
  if (!/^[0-9a-f]{64}$/.test(snapshotContentHash)) {
    throw new Error("pdfArtifactStorageKey: snapshot content hash must be 64 lowercase hex");
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("pdfArtifactStorageKey: version must be a positive integer");
  }
  return `pdf/v${version}/${snapshotContentHash}.pdf`;
}

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
