import {
  ensurePublishedPdfArtifact,
  generatePublishedPdfArtifact,
} from "@/lib/pdf/artifact";
import { pdfArtifactStatus } from "@/lib/pdf/artifact-download";
import { resolvePublishedSnapshotRef } from "@/lib/publication/get-public-manual";
import { verifyPrintToken, PRINT_TOKEN_HEADER } from "@/lib/pdf/print-token";
import { logServerError } from "@/lib/observability/request-id";

/**
 * Phase 7 slice 4B — INTERNAL PDF-artifact generation trigger.
 *
 * Chromium runs here (and only here + the ADMIN retry server action). It is NOT a public surface:
 * it requires a valid short-lived HMAC print token (the same `x-smartin-print-token` header + the
 * server-only `PDF_PRINT_SECRET` used for the signed print page) bound to the exact slug+version.
 * Any failure is a generic 404 with no reason — an unauthenticated caller cannot enumerate.
 *
 * It goes through the SAME atomic DB claim as publish-time generation, so calling it concurrently
 * for one snapshot still launches at most one Chromium. Used by publish-time seeding / ops and by
 * the deployed e2e; it does NOT replace the post-publish step (that fires automatically).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let slug = "";
  let version = "";
  try {
    const body = (await req.json()) as { slug?: unknown; version?: unknown };
    slug = typeof body.slug === "string" ? body.slug : "";
    version = typeof body.version === "string" ? body.version : "";
  } catch {
    return new Response("Not Found", { status: 404 });
  }

  const token = req.headers.get(PRINT_TOKEN_HEADER);
  if (!slug || !version || !verifyPrintToken(token, slug, version)) {
    return new Response("Not Found", { status: 404 });
  }

  const ref = await resolvePublishedSnapshotRef(slug, version).catch(() => null);
  if (!ref) return new Response("Not Found", { status: 404 });

  try {
    await ensurePublishedPdfArtifact(slug, version);
    const gen = await generatePublishedPdfArtifact(slug, version);
    const status = await pdfArtifactStatus(ref.publishedSnapshotId);
    return Response.json({
      outcome: gen.outcome,
      status,
      sha256: gen.outcome === "generated" ? gen.sha256 : undefined,
      byteSize: gen.outcome === "generated" ? gen.byteSize : undefined,
      pageCount: gen.outcome === "generated" ? gen.pageCount : undefined,
    });
  } catch (e) {
    await logServerError("pdf-artifact", "internal generate trigger failed", {
      slug,
      version,
      msg: String(e).slice(0, 120),
    });
    return new Response("generation error", { status: 502 });
  }
}
