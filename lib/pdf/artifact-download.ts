import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { logServerError } from "@/lib/observability/request-id";
import { pdfFilename } from "@/lib/pdf/filename";
import { downloadPdfArtifact, sha256Hex } from "@/lib/pdf/artifact-storage";
import { resolvePublishedSnapshotRef, type PublishedSnapshotRef } from "@/lib/publication/get-public-manual";

/**
 * Phase 7 slice 4B — READ side of the immutable PDF artifact.
 *
 * This module NEVER imports the generator / `playwright-core` — the public `GET /pdf` route depends
 * only on it, so a download can never launch Chromium. It resolves the artifact row for an
 * immutable snapshot, serves the stored bytes after verifying them against the frozen
 * `pdf_sha256` + `byte_size`, and keeps a tiny per-instance cache of READY artifacts (safe: a READY
 * artifact is immutable).
 */

export type PdfArtifactStatus = "NONE" | "PENDING" | "GENERATING" | "READY" | "FAILED";

type ArtifactRow = {
  status: Exclude<PdfArtifactStatus, "NONE">;
  storage_key: string | null;
  pdf_sha256: string | null;
  byte_size: number | null;
  page_count: number | null;
  failure_code: string | null;
};

async function readArtifactRow(snapshotId: string): Promise<ArtifactRow | null> {
  const svc = createSupabaseServiceClient();
  const { data } = await svc
    .from("published_pdf_artifacts")
    .select("status, storage_key, pdf_sha256, byte_size, page_count, failure_code")
    .eq("published_snapshot_id", snapshotId)
    .maybeSingle();
  return (data as ArtifactRow | null) ?? null;
}

/** Lightweight status for the download button (no bytes). */
export async function pdfArtifactStatus(snapshotId: string): Promise<PdfArtifactStatus> {
  return (await readArtifactRow(snapshotId))?.status ?? "NONE";
}

/** Resolve slug/version → the artifact lifecycle status for a page's download button. No bytes,
 *  no Chromium. `NONE` for an unknown route too (the button just shows "belum tersedia"). */
export async function pdfArtifactUiStatus(slug: string, version: string): Promise<PdfArtifactStatus> {
  const ref = await resolvePublishedSnapshotRef(slug, version).catch(() => null);
  return ref ? pdfArtifactStatus(ref.publishedSnapshotId) : "NONE";
}

type ReadyPdf = {
  outcome: "ready";
  bytes: Buffer;
  sha256: string;
  byteSize: number;
  pageCount: number | null;
  filename: string;
};
type NotReady =
  | { outcome: "pending" }
  | { outcome: "generating" }
  | { outcome: "failed" }
  | { outcome: "corrupt" };

// ponytail: per-instance cache of an IMMUTABLE artifact keyed by snapshot id. A READY artifact's
// bytes/hash never change, so this only ever avoids re-downloading the same object. Bounded; a warm
// instance answering a burst of downloads for one version does zero extra Storage reads.
const CACHE_MAX = 8;
const readyCache = new Map<string, Omit<ReadyPdf, "outcome">>();

export async function getReadyPdfArtifactForDownload(
  ref: PublishedSnapshotRef,
): Promise<ReadyPdf | NotReady> {
  const cached = readyCache.get(ref.publishedSnapshotId);
  if (cached) return { outcome: "ready", ...cached };

  const row = await readArtifactRow(ref.publishedSnapshotId);
  if (!row || row.status === "PENDING") return { outcome: "pending" };
  if (row.status === "GENERATING") return { outcome: "generating" };
  if (row.status === "FAILED") return { outcome: "failed" };

  // READY — fetch + verify against the frozen metadata; never hand back unverified bytes.
  if (!row.storage_key || !row.pdf_sha256 || row.byte_size == null) {
    await logServerError("pdf-artifact", "READY row is incomplete", { snapshotId: ref.publishedSnapshotId });
    return { outcome: "corrupt" };
  }
  const bytes = await downloadPdfArtifact(row.storage_key);
  if (!bytes) {
    await logServerError("pdf-artifact", "storage object missing for READY artifact", {
      snapshotId: ref.publishedSnapshotId,
    });
    return { outcome: "corrupt" };
  }
  if (bytes.byteLength !== row.byte_size || sha256Hex(bytes) !== row.pdf_sha256) {
    await logServerError("pdf-artifact", "READY artifact bytes fail integrity check", {
      snapshotId: ref.publishedSnapshotId,
      expectedBytes: row.byte_size,
      gotBytes: bytes.byteLength,
    });
    return { outcome: "corrupt" };
  }

  const ready: Omit<ReadyPdf, "outcome"> = {
    bytes,
    sha256: row.pdf_sha256,
    byteSize: row.byte_size,
    pageCount: row.page_count,
    filename: pdfFilename(ref.eaName, ref.publicVersion),
  };
  if (readyCache.size >= CACHE_MAX) readyCache.delete(readyCache.keys().next().value as string);
  readyCache.set(ref.publishedSnapshotId, ready);
  return { outcome: "ready", ...ready };
}
