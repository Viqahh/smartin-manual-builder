/**
 * Phase 8B-8 — one batched signed-URL request for many private `manual-images` objects.
 *
 * Replaces the previous `for (key of keys) await createSignedUrl(key)` loops (one HTTP round-trip
 * per image, on hot paths like every Builder load) with a single `createSignedUrls(keys, ttl)`
 * call. Same 30-minute TTL, same private bucket, same authorization as before — only the number
 * of round-trips changes.
 *
 * No `import "server-only"` here on purpose: it takes an already-created client so the pure
 * key→url mapping is unit-testable without pulling the server bundle into vitest. It is only ever
 * called from server modules.
 */

export const SIGNED_URL_TTL_SECONDS = 60 * 30; // 30 minutes

const BUCKET = "manual-images";

type SignedUrlItem = { path?: string | null; signedUrl?: string | null; error?: unknown };
type StorageLike = {
  from: (bucket: string) => {
    createSignedUrls: (
      paths: string[],
      expiresIn: number,
    ) => Promise<{ data: SignedUrlItem[] | null; error: unknown }>;
  };
};

/**
 * Sign `storageKeys` in ONE request. Returns a `storageKey -> signedUrl | null` map. Results are
 * matched to inputs positionally (the batch endpoint echoes results in request order); a key that
 * failed to sign maps to `null` and never shifts another key's URL. An empty input signs nothing.
 */
export async function signManualImageUrls(
  storage: StorageLike,
  storageKeys: string[],
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (storageKeys.length === 0) return out;

  const { data } = await storage.from(BUCKET).createSignedUrls(storageKeys, ttlSeconds);
  storageKeys.forEach((key, i) => {
    out.set(key, data?.[i]?.signedUrl ?? null);
  });
  return out;
}
