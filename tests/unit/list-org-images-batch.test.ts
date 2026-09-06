/**
 * Phase 8B-8 (perf) — `listOrgImages` (editor asset picker, runs on every Builder load, up to
 * `limit=60` images) must sign the whole list in ONE `createSignedUrls` call, not one
 * `createSignedUrl` per image. This test drives the real query path with a fake Supabase client
 * and asserts the batched behaviour + the row→URL mapping.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const createSignedUrls = vi.fn();
const createSignedUrl = vi.fn(() => {
  throw new Error("listOrgImages must batch — createSignedUrl (singular) must not be called");
});
const storageFrom = vi.fn(() => ({ createSignedUrls, createSignedUrl }));

let assetRows: unknown[] = [];
const fromImageAssets = {
  select: () => fromImageAssets,
  eq: () => fromImageAssets,
  order: () => fromImageAssets,
  limit: () => Promise.resolve({ data: assetRows, error: null }),
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      if (table !== "image_assets") throw new Error(`unexpected table ${table}`);
      return fromImageAssets;
    },
    storage: { from: storageFrom },
  }),
}));

const { listOrgImages } = await import("@/features/images/queries");

beforeEach(() => {
  createSignedUrls.mockReset();
  createSignedUrl.mockClear();
  storageFrom.mockClear();
  assetRows = [
    { id: "img-0", storage_key: "org/k0.png", alt_text: "zero", caption: null, width: 10, height: 20 },
    { id: "img-1", storage_key: "org/k1.png", alt_text: null, caption: "one", width: null, height: null },
    { id: "img-2", storage_key: "org/k2.png", alt_text: "two", caption: null, width: 30, height: 40 },
  ];
});

describe("listOrgImages — batched signing", () => {
  it("issues ONE createSignedUrls call for all keys, in order, at a 30-minute TTL — no per-key createSignedUrl", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "org/k0.png", signedUrl: "url0" },
        { path: "org/k1.png", signedUrl: "url1" },
        { path: "org/k2.png", signedUrl: "url2" },
      ],
      error: null,
    });

    const out = await listOrgImages("org-1");

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(["org/k0.png", "org/k1.png", "org/k2.png"], 1800);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(storageFrom).toHaveBeenCalledWith("manual-images"); // private bucket, unchanged

    expect(out.map((r) => [r.id, r.signedUrl])).toEqual([
      ["img-0", "url0"],
      ["img-1", "url1"],
      ["img-2", "url2"],
    ]);
    // non-URL fields still mapped straight from the row
    expect(out[0]).toMatchObject({ altText: "zero", width: 10, height: 20 });
    expect(out[1]).toMatchObject({ altText: null, caption: "one", width: null });
  });

  it("a failed middle item → that image's signedUrl is null; the others keep their own URL", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "org/k0.png", signedUrl: "url0" },
        { path: "org/k1.png", signedUrl: null, error: { message: "gone" } },
        { path: "org/k2.png", signedUrl: "url2" },
      ],
      error: null,
    });

    const out = await listOrgImages("org-1");
    expect(out.find((r) => r.id === "img-0")!.signedUrl).toBe("url0");
    expect(out.find((r) => r.id === "img-1")!.signedUrl).toBeNull();
    expect(out.find((r) => r.id === "img-2")!.signedUrl).toBe("url2");
  });

  it("no images → no signing call at all", async () => {
    assetRows = [];
    const out = await listOrgImages("org-1");
    expect(out).toEqual([]);
    expect(createSignedUrls).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
  });
});
