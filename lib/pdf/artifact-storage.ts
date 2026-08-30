import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { PDF_ARTIFACT_BUCKET } from "@/lib/pdf/artifact-key";

/**
 * Phase 7 slice 4B — private storage for immutable published PDF artifacts.
 *
 * Bucket `manual-pdf-artifacts` is PRIVATE and has no anon/authenticated `storage.objects` policy —
 * only the trusted server (service role, which bypasses RLS) reads or writes it. Key convention +
 * the pure hash helper live in `./artifact-key` (unit-testable, no server-only import).
 */

export { PDF_ARTIFACT_BUCKET, PDF_ARTIFACT_VERSION, pdfArtifactStorageKey, sha256Hex } from "@/lib/pdf/artifact-key";

/**
 * Upload the generated PDF. `upsert: true` on purpose — a prior crashed generation may have left a
 * partial/older object at this deterministic key while the DB artifact is NOT yet READY; the bytes
 * are deterministic, so overwriting is safe. A READY artifact is never regenerated (the DB
 * immutability guard + the claim RPC prevent it), so this never overwrites a live artifact.
 */
export async function uploadPdfArtifact(storageKey: string, bytes: Uint8Array): Promise<void> {
  const svc = createSupabaseServiceClient();
  const { error } = await svc.storage.from(PDF_ARTIFACT_BUCKET).upload(storageKey, bytes, {
    contentType: "application/pdf",
    upsert: true,
    cacheControl: "31536000",
  });
  if (error) throw new Error(`pdf artifact upload failed: ${error.message}`);
}

/** Download the stored PDF bytes. `null` if the object is missing (caller returns a controlled 502). */
export async function downloadPdfArtifact(storageKey: string): Promise<Buffer | null> {
  const svc = createSupabaseServiceClient();
  const { data, error } = await svc.storage.from(PDF_ARTIFACT_BUCKET).download(storageKey);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
