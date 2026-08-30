import {
  resolvePublishedSnapshotRef,
  PublicSnapshotCorruptError,
} from "@/lib/publication/get-public-manual";
import { getReadyPdfArtifactForDownload } from "@/lib/pdf/artifact-download";
import { contentDisposition } from "@/lib/pdf/filename";
import { logServerError } from "@/lib/observability/request-id";

/**
 * Phase 7 slice 4B — public download of the IMMUTABLE PDF artifact for a PUBLISHED / ARCHIVED
 * manual version.
 *
 * THIS ROUTE NEVER LAUNCHES CHROMIUM. It does exactly: publication lookup → artifact lookup →
 * private-bucket read (bytes verified against the frozen `pdf_sha256` + `byte_size`) → response.
 * First-time generation happens at publish time (and via the ADMIN retry action), never here.
 *
 *   READY                     → 200 application/pdf, strong ETag = the pdf sha-256, immutable cache
 *   PENDING / GENERATING      → 503 + Retry-After (the artifact is still being built)
 *   FAILED                    → 503 + Retry-After (generic; an admin can retry generation)
 *   unknown / never-published → 404
 *   READY but bytes corrupt   → 502 (sanitized log; never serves unverified bytes)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = Promise<{ eaSlug: string; version: string }>;

const RETRY = { "Retry-After": "15", "Cache-Control": "no-store" };

export async function GET(req: Request, { params }: { params: RouteParams }) {
  const { eaSlug, version } = await params;

  let ref;
  try {
    ref = await resolvePublishedSnapshotRef(eaSlug, version);
  } catch (e) {
    if (e instanceof PublicSnapshotCorruptError) return new Response("Server Error", { status: 500 });
    throw e;
  }
  if (!ref) return new Response("Not Found", { status: 404 });

  const art = await getReadyPdfArtifactForDownload(ref);

  if (art.outcome === "pending" || art.outcome === "generating") {
    return new Response("PDF is being prepared", { status: 503, headers: RETRY });
  }
  if (art.outcome === "failed") {
    return new Response("PDF is temporarily unavailable", { status: 503, headers: RETRY });
  }
  if (art.outcome === "corrupt") {
    await logServerError("pdf-artifact", "download integrity failure", { slug: eaSlug, version });
    return new Response("PDF integrity error", { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  const etag = `"${art.sha256}"`;
  if ((req.headers.get("if-none-match") || "").split(",").some((t) => t.trim() === etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "public, max-age=31536000, immutable" } });
  }

  return new Response(new Uint8Array(art.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(art.filename),
      "Content-Length": String(art.byteSize),
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      // the artifact is immutable once READY (DB guard + content-addressed key)
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
      "X-Pdf-Pages": String(art.pageCount ?? ""),
    },
  });
}
