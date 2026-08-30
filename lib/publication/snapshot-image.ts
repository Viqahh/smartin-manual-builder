/**
 * Phase 7 slice 3 — THE canonical publication-image index.
 *
 * `snapshotImageDescriptors(renderJson)` returns the ordered publication-image list for one
 * immutable snapshot. It is the SINGLE source of image ordering — `snapshotToViewModel`, the
 * `/manual/[eaSlug]/[version]/image/[idx]` proxy route, and any future print/PDF page all resolve
 * `imageRef N` / `/image/N` through this function, so the adapter and the route can never disagree
 * about which object index N points at.
 *
 *   v2  — the exact top-level `snapshot.images[]` produced by `buildPublishedSnapshot`, in order,
 *          never reordered.
 *   v1  — legacy `content.images` keyed by asset id, taken in sorted-key order (the same rule the
 *          Slice-1 adapter used).
 *
 * `storageKey` is SERVER-ONLY (private bucket object key). Descriptors must never be handed to a
 * client — only `publicImageUrl(...)` (a same-origin proxy path) crosses that boundary.
 */

export type SnapshotImageDescriptor = {
  /** private-bucket object key — SERVER-ONLY, never serialised to a client */
  storageKey: string | null;
  altText: string | null;
  caption: string | null;
  /** v1 only: the raw asset-id key this descriptor came from (block/step UUID → index mapping) */
  sourceKey?: string;
};

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const s = (x: unknown): string | null => (typeof x === "string" ? x : null);

export function snapshotImageDescriptors(renderJson: unknown): SnapshotImageDescriptor[] {
  const root = isObj(renderJson) ? renderJson : {};

  if (root.snapshotVersion === 2 && Array.isArray(root.images)) {
    return root.images.map((m) => {
      const mm = isObj(m) ? m : {};
      return { storageKey: s(mm.storageKey), altText: s(mm.altText), caption: s(mm.caption) };
    });
  }

  // v1 fallback — content.images keyed by asset id, sorted-key order
  const content = isObj(root.content) ? root.content : {};
  const imgs = isObj(content.images) ? content.images : {};
  return Object.keys(imgs)
    .sort()
    .map((key) => {
      const mm = isObj(imgs[key]) ? (imgs[key] as Record<string, unknown>) : {};
      return { storageKey: s(mm.storageKey), altText: s(mm.altText), caption: s(mm.caption), sourceKey: key };
    });
}

/** Same-origin proxy path for the Nth publication image. The browser sees only slug/version/idx. */
export const publicImageUrl = (slug: string, version: string, idx: number): string =>
  `/manual/${encodeURIComponent(slug)}/${encodeURIComponent(version)}/image/${idx}`;

/** Formats the app already accepts (`features/images/actions.ts`). */
export const IMAGE_MIME_ALLOWLIST: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** MIME implied by a storage-key extension (keys are `<org>/<asset>.<ext>`), allowlist-gated. */
export function mimeForStorageKey(storageKey: string): string | null {
  const ext = storageKey.toLowerCase().split(".").pop() ?? "";
  return EXT_MIME[ext] ?? null;
}

/** Canonical non-negative base-10 index parse — no leading zero, no sign, no exponent, bounded. */
export function parseImageIndex(raw: string): number | null {
  if (!/^(0|[1-9][0-9]{0,4})$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
