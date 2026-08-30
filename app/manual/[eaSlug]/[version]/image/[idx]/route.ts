import { PublicSnapshotCorruptError } from "@/lib/publication/get-public-manual";
import { parseImageIndex } from "@/lib/publication/snapshot-image";
import { loadPublicImageBytes } from "@/lib/publication/public-image-bytes";
import { logServerError } from "@/lib/observability/request-id";

/**
 * Phase 7 slice 3 — same-origin published-image proxy (AC-P7-8).
 *
 * `GET /manual/[eaSlug]/[version]/image/[idx]`. The browser sees only slug / version / a numeric
 * index; `storageKey`, `image_assets.id`, the org id and the snapshot id never leave the server.
 * The ONLY authorisation is snapshot membership: the index must resolve to a descriptor inside the
 * exact immutable, hash-verified `published_snapshots` row for that slug+version. The `manual-images`
 * bucket stays private — this route downloads the bytes with the service client and streams them
 * itself; it never issues a Supabase signed URL or a redirect. Every failure is a bare 404 (or a
 * generic 500 for a corrupt snapshot) with no enumeration detail.
 */

export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not Found", { status: 404 });

type RouteParams = Promise<{ eaSlug: string; version: string; idx: string }>;

export async function GET(_req: Request, { params }: { params: RouteParams }) {
  const { eaSlug, version, idx } = await params;

  if (parseImageIndex(idx) === null) return NOT_FOUND();

  let img;
  try {
    img = await loadPublicImageBytes(eaSlug, version, idx);
  } catch (e) {
    if (e instanceof PublicSnapshotCorruptError) {
      await logServerError("publication", "public image: snapshot verification failed", { slug: eaSlug, version, idx });
      return new Response("Server Error", { status: 500 });
    }
    throw e;
  }
  // unknown publication OR out-of-range index OR a descriptor with no object OR download failure
  if (!img) return NOT_FOUND();

  const { bytes, mime } = img;
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.byteLength),
      // version-addressed URL + random final storage key + upsert:false => the object identity is
      // immutable for normal app code (not a guarantee against an out-of-band storage admin).
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
