/**
 * Phase 7 slice 3 — canonical publication-image index (spec §8/§9/§10/§11/§16/§37).
 *
 * `snapshotImageDescriptors` is the ONE ordering used by the adapter and the `/image/[idx]` proxy.
 * These tests pin: v2 = top-level `images[]` in order; v1 = sorted-key order; the adapter and the
 * route resolve the SAME object for the same index; index parsing is canonical; the proxy URL
 * carries no storage key.
 */

import { describe, it, expect } from "vitest";
import {
  IMAGE_MIME_ALLOWLIST,
  mimeForStorageKey,
  parseImageIndex,
  publicImageUrl,
  snapshotImageDescriptors,
} from "@/lib/publication/snapshot-image";
import { snapshotToViewModel } from "@/lib/publication/snapshot-view-model";

const v2snap = {
  snapshotVersion: 2,
  public: { slug: "vmax-ea", version: "1.0.0" },
  content: { images: [{ altText: "A", caption: null }, { altText: "B", caption: "cap B" }], sections: [], parameterGroups: [] },
  images: [
    { storageKey: "org-1/aaa.png", altText: "A", caption: null },
    { storageKey: "org-1/bbb.jpg", altText: "B", caption: "cap B" },
  ],
};

const v1snap = {
  snapshotVersion: 1,
  content: {
    images: {
      // deliberately NOT alphabetical insertion order
      "ffff0000-0000-4000-8000-000000000002": { storageKey: "org-1/two.webp", altText: "two", caption: null },
      "0000aaaa-0000-4000-8000-000000000001": { storageKey: "org-1/one.gif", altText: "one", caption: "c1" },
    },
    sections: [],
    parameterGroups: [],
  },
};

describe("snapshotImageDescriptors", () => {
  it("v2: exact top-level images[] order, storageKey carried", () => {
    expect(snapshotImageDescriptors(v2snap)).toEqual([
      { storageKey: "org-1/aaa.png", altText: "A", caption: null },
      { storageKey: "org-1/bbb.jpg", altText: "B", caption: "cap B" },
    ]);
  });

  it("v1: sorted-key order, with sourceKey for the adapter's UUID→index map", () => {
    const d = snapshotImageDescriptors(v1snap);
    expect(d.map((x) => x.storageKey)).toEqual(["org-1/one.gif", "org-1/two.webp"]);
    expect(d[0].sourceKey).toBe("0000aaaa-0000-4000-8000-000000000001");
    expect(d[1].sourceKey).toBe("ffff0000-0000-4000-8000-000000000002");
  });

  it("missing / malformed json → empty list, never throws", () => {
    expect(snapshotImageDescriptors(null)).toEqual([]);
    expect(snapshotImageDescriptors({})).toEqual([]);
    expect(snapshotImageDescriptors({ snapshotVersion: 2 })).toEqual([]);
  });
});

describe("adapter and route resolve the SAME index", () => {
  it("v2: vm.images[img-N] proxy URL ↔ descriptor N", () => {
    const vm = snapshotToViewModel(v2snap, { slug: "vmax-ea", version: "1.0.0", status: "PUBLISHED" });
    const d = snapshotImageDescriptors(v2snap);
    d.forEach((_, i) => {
      expect(vm.images[`img-${i}`].signedUrl).toBe(publicImageUrl("vmax-ea", "1.0.0", i));
    });
    expect(Object.keys(vm.images)).toEqual(["img-0", "img-1"]);
  });

  it("v1: same sorted order in the adapter and the descriptor helper", () => {
    const vm = snapshotToViewModel({ ...v1snap, content: { ...v1snap.content } }, { slug: "old-ea", version: "1.0.0", status: "PUBLISHED" });
    const d = snapshotImageDescriptors(v1snap);
    // img-0 is the alphabetically-first key's object ("one.gif"), matching descriptor[0]
    expect(vm.images["img-0"].altText).toBe("one");
    expect(d[0].altText).toBe("one");
    expect(vm.images["img-0"].signedUrl).toBe("/manual/old-ea/1.0.0/image/0");
    expect(vm.images["img-1"].signedUrl).toBe("/manual/old-ea/1.0.0/image/1");
  });
});

describe("publicImageUrl", () => {
  it("is a same-origin path with slug/version/idx only — no storage key", () => {
    expect(publicImageUrl("vmax-ea", "1.0.0", 3)).toBe("/manual/vmax-ea/1.0.0/image/3");
    expect(publicImageUrl("a b/c", "1.0.0", 0)).toBe("/manual/a%20b%2Fc/1.0.0/image/0");
    expect(publicImageUrl("vmax-ea", "1.0.0", 0)).not.toMatch(/supabase|storage|token|\.png|\.jpg/);
  });
});

describe("parseImageIndex — canonical base-10 only", () => {
  it("accepts 0, 1, 24", () => {
    expect(parseImageIndex("0")).toBe(0);
    expect(parseImageIndex("1")).toBe(1);
    expect(parseImageIndex("24")).toBe(24);
  });
  it("rejects -1, 1.2, abc, 1e2, 01, huge, empty, whitespace", () => {
    for (const bad of ["-1", "1.2", "abc", "1e2", "01", "999999999999", "", " 1", "1 ", "+1", "0x1", "1_0"]) {
      expect(parseImageIndex(bad), bad).toBeNull();
    }
  });
});

describe("MIME handling", () => {
  it("mimeForStorageKey maps known extensions, rejects the rest", () => {
    expect(mimeForStorageKey("o/a.png")).toBe("image/png");
    expect(mimeForStorageKey("o/a.JPG")).toBe("image/jpeg");
    expect(mimeForStorageKey("o/a.jpeg")).toBe("image/jpeg");
    expect(mimeForStorageKey("o/a.webp")).toBe("image/webp");
    expect(mimeForStorageKey("o/a.gif")).toBe("image/gif");
    expect(mimeForStorageKey("o/a.svg")).toBeNull();
    expect(mimeForStorageKey("o/a.html")).toBeNull();
    expect(mimeForStorageKey("o/a")).toBeNull();
  });
  it("allowlist excludes svg / html / octet-stream", () => {
    expect([...IMAGE_MIME_ALLOWLIST].sort()).toEqual(["image/gif", "image/jpeg", "image/png", "image/webp"]);
    expect(IMAGE_MIME_ALLOWLIST.has("image/svg+xml")).toBe(false);
    expect(IMAGE_MIME_ALLOWLIST.has("text/html")).toBe(false);
    expect(IMAGE_MIME_ALLOWLIST.has("application/octet-stream")).toBe(false);
  });
});
