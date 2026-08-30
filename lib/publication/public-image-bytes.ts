import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getPublicImageDescriptor, loadVerifiedPublishedSnapshot } from "@/lib/publication/get-public-manual";
import {
  IMAGE_MIME_ALLOWLIST,
  mimeForStorageKey,
  parseImageIndex,
  snapshotImageDescriptors,
} from "@/lib/publication/snapshot-image";

/**
 * Phase 7 — resolve published images (public slug + version + deterministic index) to raw bytes and
 * a safe MIME, straight from the private `manual-images` bucket. Authorisation is unchanged from
 * Slice 3: snapshot membership only. Any miss → null. A corrupt snapshot throws
 * `PublicSnapshotCorruptError` (callers map it to a generic 500 / failure).
 *
 *  - `loadPublicImageBytes` — one image, one verified snapshot read. Used by the same-origin proxy
 *    route (one browser request = one image).
 *  - `openPublicImageSource` — verify the snapshot ONCE, then serve many images by index with only a
 *    Storage download each. Used by the in-process PDF generator, which fulfils every
 *    `/manual/.../image/N` request the print page makes; per-image re-verification (a full
 *    render_json SHA-256) made an image-heavy manual take ~1 min.
 */

export type PublicImageBytes = { bytes: ArrayBuffer; mime: string };

async function downloadDescriptor(storageKey: string | null): Promise<PublicImageBytes | null> {
  if (!storageKey) return null;
  const mimeFromKey = mimeForStorageKey(storageKey);
  if (!mimeFromKey) return null;

  const svc = createSupabaseServiceClient();
  const { data: blob, error } = await svc.storage.from("manual-images").download(storageKey);
  if (error || !blob) return null;

  const blobType = (blob.type || "").toLowerCase();
  const mime = IMAGE_MIME_ALLOWLIST.has(blobType) ? blobType : mimeFromKey;
  if (!IMAGE_MIME_ALLOWLIST.has(mime)) return null;

  return { bytes: await blob.arrayBuffer(), mime };
}

export async function loadPublicImageBytes(
  slug: string,
  version: string,
  idxRaw: string | number,
): Promise<PublicImageBytes | null> {
  const i = typeof idxRaw === "number" ? (Number.isInteger(idxRaw) && idxRaw >= 0 ? idxRaw : null) : parseImageIndex(idxRaw);
  if (i === null) return null;
  const descriptor = await getPublicImageDescriptor(slug, version, i);
  if (!descriptor) return null;
  return downloadDescriptor(descriptor.storageKey);
}

export type PublicImageSource = {
  /** raw bytes for the Nth publication image, or null for an out-of-range / objectless / bad index */
  get(idxRaw: string | number): Promise<PublicImageBytes | null>;
};

export async function openPublicImageSource(slug: string, version: string): Promise<PublicImageSource | null> {
  const verified = await loadVerifiedPublishedSnapshot(slug, version);
  if (!verified) return null;
  const descriptors = snapshotImageDescriptors(verified.renderJson);
  return {
    get(idxRaw) {
      const i = typeof idxRaw === "number" ? idxRaw : parseImageIndex(idxRaw);
      if (i === null || !Number.isInteger(i) || i < 0 || i >= descriptors.length) return Promise.resolve(null);
      return downloadDescriptor(descriptors[i].storageKey);
    },
  };
}
