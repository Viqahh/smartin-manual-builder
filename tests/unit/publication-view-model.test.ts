/**
 * Phase 7 slice 1 — the snapshot → ManualViewModel adapter (spec §18).
 *
 * A published page is rebuilt from the immutable snapshot ONLY. The adapter must produce the exact
 * shape the shared `ManualRenderer` consumes, with SYNTHETIC non-UUID ids (no database identifier
 * reaches the public HTML). Since Slice 3 a public image's `signedUrl` is a SAME-ORIGIN proxy path
 * (`/manual/<slug>/<version>/image/<idx>`), never a Supabase signed URL and never the private
 * `storageKey`; an image with no `storageKey` keeps `signedUrl: null`. Handles v2 + legacy v1.
 */

import { describe, it, expect } from "vitest";
import { buildPublishedSnapshot } from "@/lib/publication/snapshot";
import { snapshotToViewModel } from "@/lib/publication/snapshot-view-model";
import type { ManualViewModel } from "@/lib/manual/view-model";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const U = (n: number) => {
  const h = n.toString(16);
  return `${h.padStart(8, "0")}-0000-4000-8000-${h.padStart(12, "0")}`;
};

/** a VM whose every id is a real-looking UUID — proves the adapter never surfaces them */
const VM: ManualViewModel = {
  manual: { id: U(1), locale: "id" },
  manualVersion: { id: U(2), version: "2.1.0", status: "APPROVED", rowVersion: 4, updatedAt: "2026-02-02T00:00:00Z" },
  eaProduct: { id: U(3), name: "Vmax EA", slug: "vmax-ea", description: "EA scalping" },
  eaVersion: { id: U(4), version: "3.0.0", platform: "MT5", releaseDate: "2026-01-15", requirements: { ram: "4GB" }, support: { email: "s@demo" } },
  organization: { id: U(5), name: "PT Smartin" },
  developer: { name: "Andi" },
  supportedSetups: [
    { id: U(6), symbol: "XAUUSD", timeframe: "M15", presetRef: "x.set", testedMinimumLot: 0.01, notes: null, isSupported: true, position: 0 },
  ],
  sections: [
    {
      id: U(7), key: "cover", title: "Sampul", required: true, isCustom: false, position: 0,
      completionState: "complete", rowVersion: 1,
      blocks: [{ id: U(8), type: "text", payload: { type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: ["Halo."] } }, position: 0, imageAssetId: null, parameterGroupIds: [], rowVersion: 1 }],
    },
    {
      id: U(9), key: "parameters", title: "Parameter", required: true, isCustom: false, position: 1,
      completionState: "complete", rowVersion: 1,
      blocks: [
        { id: U(10), type: "parameterTable", payload: { type: "parameterTable", schemaVersion: 1, groupIds: [U(20)] }, position: 0, imageAssetId: null, parameterGroupIds: [U(20)], rowVersion: 1 },
        { id: U(11), type: "image", payload: { type: "image", schemaVersion: 1, imageAssetId: U(30), caption: "Gambar." }, position: 1, imageAssetId: U(30), parameterGroupIds: [], rowVersion: 1 },
      ],
    },
  ],
  parameterGroups: [
    { id: U(20), name: "Trading", position: 0, parameters: [
      { id: U(21), displayName: "Fixed Lot", technicalName: "FixedLot", paramType: "double", defaultValue: "0.01", unit: null, safeRange: "0.01-1", description: "lot", orderEffect: null, mutability: "before_start", required: true, position: 0 },
    ] },
  ],
  images: { [U(30)]: { id: U(30), altText: "alt", caption: "Gambar.", signedUrl: "https://x/y?token=SEKRET" } },
  changelog: [{ id: U(40), position: 0, entryType: "ADDED", body: "Rilis.", sourceEaVersionId: U(4), isFeatureChange: true, openPositionImpact: null }],
};

const OPTS = { templateId: U(50), templateVersion: 2, publicSlug: "vmax-ea", publicVersion: "2.1.0", imageStorageKeys: { [U(30)]: "a/b.png" } };

describe("snapshotToViewModel — v2", () => {
  const snap = buildPublishedSnapshot(VM, OPTS);
  const vm = snapshotToViewModel(snap, { slug: "vmax-ea", version: "2.1.0", status: "PUBLISHED" });

  it("carries no database UUID anywhere in the returned view model", () => {
    expect(JSON.stringify(vm)).not.toMatch(UUID_RE);
  });

  it("ids are synthetic; image URLs are same-origin proxy paths (never a Supabase URL / storageKey)", () => {
    expect(vm.manual.id).toBe("");
    expect(vm.manualVersion.id).toBe("");
    expect(vm.eaProduct.id).toBe("");
    expect(vm.sections[0].id).toBe("sec-cover");
    expect(vm.sections[1].blocks[0].id).toBe("blk-1-0");
    expect(vm.parameterGroups[0].id).toBe("pg-0");
    for (const img of Object.values(vm.images)) {
      expect(img.signedUrl).toMatch(/^\/manual\/vmax-ea\/2\.1\.0\/image\/\d+$/);
      expect(img.signedUrl).not.toMatch(/supabase|storage|token=|\bstorageKey\b|a\/b\.png/i);
    }
  });

  it("preserves content by value and resolves the parameterTable reference", () => {
    expect(vm.eaProduct.name).toBe("Vmax EA");
    expect(vm.eaVersion.platform).toBe("MT5");
    expect(vm.manualVersion.status).toBe("PUBLISHED");
    // block groupRef 0 -> synthetic pg-0 -> the one group; the renderer filter will match it
    expect(vm.sections[1].blocks[0].parameterGroupIds).toEqual(["pg-0"]);
    expect(vm.parameterGroups[0].parameters[0].technicalName).toBe("FixedLot");
  });

  it("resolves the image reference to synthetic metadata + a proxy URL (no storage key)", () => {
    const imgBlock = vm.sections[1].blocks[1];
    expect(imgBlock.imageAssetId).toBe("img-0");
    expect(vm.images["img-0"]).toEqual({
      id: "img-0",
      altText: "alt",
      caption: "Gambar.",
      signedUrl: "/manual/vmax-ea/2.1.0/image/0",
    });
    expect(JSON.stringify(vm)).not.toMatch(/storageKey|a\/b\.png|SEKRET/);
  });

  it("ARCHIVED status flows through", () => {
    const a = snapshotToViewModel(snap, { slug: "vmax-ea", version: "2.1.0", status: "ARCHIVED" });
    expect(a.manualVersion.status).toBe("ARCHIVED");
  });

  it("restores a synthetic step-image reference from a v2 steps block, with no raw UUID", () => {
    const stepUuid = U(31);
    const vm2 = structuredClone(VM);
    vm2.images[stepUuid] = { id: stepUuid, altText: "step", caption: null, signedUrl: "https://x?token=Q" };
    vm2.sections[1].blocks.push({
      id: U(32), type: "steps", position: 2, imageAssetId: null, parameterGroupIds: [], rowVersion: 1,
      payload: { type: "steps", schemaVersion: 1, steps: [
        { title: "A", instruction: "satu" },
        { title: "B", instruction: "dua", imageAssetId: stepUuid },
      ] },
    });
    const s = buildPublishedSnapshot(vm2, { ...OPTS, imageStorageKeys: { ...OPTS.imageStorageKeys, [stepUuid]: "s/step.png" } });
    const adapted = snapshotToViewModel(s, { slug: "vmax-ea", version: "2.1.0", status: "PUBLISHED" });

    const stepsBlock = adapted.sections[1].blocks[2];
    const steps = (stepsBlock.payload as { steps: Record<string, unknown>[] }).steps;
    expect(steps[0].imageAssetId).toBeUndefined();
    expect(steps[1].imageAssetId).toBe("img-1"); // image block took img-0, step took img-1
    expect(steps[1].imageRef).toBeUndefined();
    expect(adapted.images["img-1"]).toEqual({
      id: "img-1",
      altText: "step",
      caption: null,
      signedUrl: "/manual/vmax-ea/2.1.0/image/1",
    });
    expect(JSON.stringify(adapted)).not.toMatch(UUID_RE);
    expect(JSON.stringify(adapted)).not.toMatch(/storageKey|s\/step\.png|token=Q/);
  });
});

describe("snapshotToViewModel — v1 fallback", () => {
  // a minimal legacy v1 content shape (projectReviewContent output, images keyed by asset id)
  const v1content = {
    manual: { id: U(1), locale: "id" },
    manualVersion: { id: U(2), version: "1.0.0" },
    eaProduct: { id: U(3), name: "Old EA", slug: "old-ea", description: "" },
    eaVersion: { id: U(4), version: "1.0.0", platform: "MT4", releaseDate: null, requirements: {}, support: {} },
    organization: { id: U(5), name: "Org" },
    developer: null,
    supportedSetups: [],
    parameterGroups: [{ name: "G", position: 0, parameters: [] }],
    sections: [
      { key: "cover", title: "Sampul", required: true, isCustom: false, position: 0, blocks: [
        { type: "image", payload: { type: "image", imageAssetId: U(30) }, position: 0, parameterGroupIds: [], imageAssetId: U(30) },
        { type: "parameterTable", payload: { groupIds: [U(20)] }, position: 1, parameterGroupIds: [U(20)], imageAssetId: null },
      ] },
    ],
    images: { [U(30)]: { altText: "a", caption: null } },
    changelog: [],
  };

  it("reads a v1 row without crashing, strips UUIDs, resolves the v1 image by key", () => {
    const vm = snapshotToViewModel({ snapshotVersion: 1, content: v1content }, { slug: "old-ea", version: "1.0.0", status: "PUBLISHED" });
    expect(JSON.stringify(vm)).not.toMatch(UUID_RE);
    expect(vm.eaProduct.name).toBe("Old EA");
    expect(vm.sections[0].blocks[0].imageAssetId).toBe("img-0");
    expect(vm.images["img-0"].signedUrl).toBeNull();
    // v1 parameterTable UUIDs can't be mapped to the id-less group array -> empty -> renderer shows all
    expect(vm.sections[0].blocks[1].parameterGroupIds).toEqual([]);
  });
});
