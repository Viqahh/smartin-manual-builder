/**
 * Phase 8B-8 (perf) — `signManualImageUrls` replaces the previous
 * `for (key of keys) await createSignedUrl(key)` loops (one Storage round-trip per image, on
 * every Builder load / picker open) with ONE batched `createSignedUrls(keys, ttl)` call.
 *
 * These tests pin the behaviour that matters for correctness AND for the perf claim:
 *   - exactly one `createSignedUrls` call, never a per-key `createSignedUrl`;
 *   - positional result → key mapping is exact;
 *   - a single failed item does not shift another key onto the wrong URL;
 *   - the private bucket and the 30-minute TTL are unchanged.
 */
import { describe, it, expect, vi } from "vitest";
import { signManualImageUrls, SIGNED_URL_TTL_SECONDS } from "@/lib/images/sign-urls";

function fakeStorage() {
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}?token=abc` })),
    error: null,
  }));
  // must never be called by the batched path
  const createSignedUrl = vi.fn(async () => {
    throw new Error("createSignedUrl (singular) must not be used — batch with createSignedUrls");
  });
  const from = vi.fn(() => ({ createSignedUrls, createSignedUrl }));
  return { storage: { from }, from, createSignedUrls, createSignedUrl };
}

describe("signManualImageUrls", () => {
  it("makes exactly ONE createSignedUrls call for many keys — never per-key createSignedUrl", async () => {
    const s = fakeStorage();
    await signManualImageUrls(s.storage, ["a.png", "b.png", "c.png", "d.png"]);
    expect(s.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(s.createSignedUrl).not.toHaveBeenCalled();
    expect(s.from).toHaveBeenCalledWith("manual-images"); // private bucket unchanged
  });

  it("signs against the private manual-images bucket with a 30-minute TTL by default", async () => {
    const s = fakeStorage();
    await signManualImageUrls(s.storage, ["x.png"]);
    expect(SIGNED_URL_TTL_SECONDS).toBe(1800);
    expect(s.createSignedUrls).toHaveBeenCalledWith(["x.png"], 1800);
  });

  it("honours an explicit TTL override", async () => {
    const s = fakeStorage();
    await signManualImageUrls(s.storage, ["x.png"], 42);
    expect(s.createSignedUrls).toHaveBeenCalledWith(["x.png"], 42);
  });

  it("maps every key to its own URL, positionally", async () => {
    const s = fakeStorage();
    const map = await signManualImageUrls(s.storage, ["k0.png", "k1.png", "k2.png"]);
    expect(map.get("k0.png")).toBe("https://signed.example/k0.png?token=abc");
    expect(map.get("k1.png")).toBe("https://signed.example/k1.png?token=abc");
    expect(map.get("k2.png")).toBe("https://signed.example/k2.png?token=abc");
  });

  it("a single failed item stays null and never shifts another key's URL", async () => {
    const from = vi.fn(() => ({
      createSignedUrls: vi.fn(async (paths: string[]) => ({
        // middle item failed to sign
        data: [
          { path: paths[0], signedUrl: `https://signed/${paths[0]}` },
          { path: paths[1], signedUrl: null, error: { message: "not found" } },
          { path: paths[2], signedUrl: `https://signed/${paths[2]}` },
        ],
        error: null,
      })),
    }));
    const map = await signManualImageUrls({ from } as never, ["good0.png", "bad.png", "good2.png"]);
    expect(map.get("good0.png")).toBe("https://signed/good0.png");
    expect(map.get("bad.png")).toBeNull(); // failed → null, NOT good2's URL
    expect(map.get("good2.png")).toBe("https://signed/good2.png");
  });

  it("a whole-batch failure (data === null) maps every key to null", async () => {
    const from = vi.fn(() => ({
      createSignedUrls: vi.fn(async () => ({ data: null, error: { message: "boom" } })),
    }));
    const map = await signManualImageUrls({ from } as never, ["a.png", "b.png"]);
    expect(map.get("a.png")).toBeNull();
    expect(map.get("b.png")).toBeNull();
  });

  it("empty input signs nothing", async () => {
    const s = fakeStorage();
    const map = await signManualImageUrls(s.storage, []);
    expect(s.from).not.toHaveBeenCalled();
    expect(s.createSignedUrls).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });
});
