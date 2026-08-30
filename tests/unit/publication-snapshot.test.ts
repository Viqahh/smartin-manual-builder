/**
 * Phase 6 slice 6 — canonical publication snapshot (spec §40, AC-P6-10).
 *
 * The snapshot hash is `sha256(stableStringify(json))`: identical for the same logical content
 * regardless of object key insertion order, DIFFERENT for any semantic content change, and
 * UNAFFECTED by volatile data (signed URLs, timestamps, row versions).
 */

import { describe, it, expect } from "vitest";
import {
  buildPublishedSnapshot,
  computeSnapshotHash,
  scanSnapshotForLeaks,
} from "@/lib/publication/snapshot";
import type { ManualViewModel } from "@/lib/manual/view-model";

const OPTS = { templateId: "tpl-1", templateVersion: 3, publicSlug: "test-ea", publicVersion: "1.0.0" };

/** One fully-specified, deterministic VM (no generated ids). Clone per test with structuredClone. */
const CANON_VM: ManualViewModel = {
  manual: { id: "m1", locale: "id" },
  manualVersion: { id: "mv1", version: "1.0.0", status: "APPROVED", rowVersion: 1, updatedAt: "2026-01-01T00:00:00Z" },
  eaProduct: { id: "p1", name: "TestEA", slug: "test-ea", description: "EA uji" },
  eaVersion: {
    id: "ev1",
    version: "1.2.0",
    platform: "MT5",
    releaseDate: "2026-01-01",
    requirements: { pbkScope: "IN_SCOPE" },
    support: { email: "s@t.demo" },
  },
  organization: { id: "org-a", name: "PT Smartin" },
  developer: { name: "Andi" },
  supportedSetups: [
    { id: "s1", symbol: "XAUUSD", timeframe: "M15", presetRef: "x.set", testedMinimumLot: 0.01, notes: null, isSupported: true, position: 0 },
    { id: "s2", symbol: "EURUSD", timeframe: "H1", presetRef: "y.set", testedMinimumLot: 0.02, notes: "b", isSupported: true, position: 1 },
  ],
  sections: [
    {
      id: "sec-cover", key: "cover", title: "Sampul", required: true, isCustom: false, position: 0,
      completionState: "complete", rowVersion: 1,
      blocks: [
        { id: "b1", type: "text", payload: { type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: ["Sampul manual."] } }, position: 0, imageAssetId: null, parameterGroupIds: [], rowVersion: 1 },
      ],
    },
    {
      id: "sec-params", key: "parameters", title: "Parameter", required: true, isCustom: false, position: 1,
      completionState: "complete", rowVersion: 1,
      blocks: [
        { id: "b2", type: "parameterTable", payload: { type: "parameterTable", schemaVersion: 1, groupIds: ["grp-0"] }, position: 0, imageAssetId: null, parameterGroupIds: ["grp-0"], rowVersion: 1 },
        { id: "b3", type: "image", payload: { type: "image", schemaVersion: 1, imageAssetId: "img-1", caption: "Diagram." }, position: 1, imageAssetId: "img-1", parameterGroupIds: [], rowVersion: 1 },
      ],
    },
  ],
  parameterGroups: [
    {
      id: "grp-0", name: "Trading", position: 0,
      parameters: [
        { id: "par-0", displayName: "Fixed Lot", technicalName: "FixedLot", paramType: "double", defaultValue: "0.01", unit: null, safeRange: "0.01-1", description: "lot", orderEffect: null, mutability: "before_start", required: true, position: 0 },
      ],
    },
  ],
  images: { "img-1": { id: "img-1", altText: "alt", caption: "Diagram.", signedUrl: "https://x/y?token=AAA&exp=1" } },
  changelog: [
    { id: "cl-1", position: 0, entryType: "ADDED", body: "Rilis awal.", sourceEaVersionId: "ev1", isFeatureChange: true, openPositionImpact: null },
  ],
};

const clone = (): ManualViewModel => structuredClone(CANON_VM);
const hashOf = (vm: ManualViewModel) => computeSnapshotHash(buildPublishedSnapshot(vm, OPTS));

describe("publication snapshot — canonical hash", () => {
  it("repeated build of the same content → identical hash", () => {
    expect(hashOf(clone())).toBe(hashOf(clone()));
  });

  it("object key insertion order does not change the hash", () => {
    const a = { a: 1, b: { x: 1, y: 2 }, c: [1, 2] };
    const b = { c: [1, 2], b: { y: 2, x: 1 }, a: 1 };
    expect(computeSnapshotHash(a)).toBe(computeSnapshotHash(b));
  });

  it("section ORDER change → different hash", () => {
    const vm = clone();
    vm.sections[0].position = 99;
    expect(hashOf(vm)).not.toBe(hashOf(clone()));
  });

  it("block content change → different hash", () => {
    const vm = clone();
    (vm.sections[0].blocks[0].payload as { content: { paragraphs: string[] } }).content.paragraphs = ["Diedit."];
    expect(hashOf(vm)).not.toBe(hashOf(clone()));
  });

  it("resolved parameter default change → different hash", () => {
    const vm = clone();
    vm.parameterGroups[0].parameters[0].defaultValue = "0.02";
    expect(hashOf(vm)).not.toBe(hashOf(clone()));
  });

  it("supported setup change → different hash", () => {
    const vm = clone();
    vm.supportedSetups[0].timeframe = "H1";
    expect(hashOf(vm)).not.toBe(hashOf(clone()));
  });

  it("changelog change → different hash", () => {
    const vm = clone();
    vm.changelog![0].body = "Rilis awal + perbaikan.";
    expect(hashOf(vm)).not.toBe(hashOf(clone()));
  });

  it("signed URL change → NO hash change", () => {
    const vm = clone();
    vm.images["img-1"].signedUrl = "https://x/y?token=DIFFERENT&exp=999999";
    expect(hashOf(vm)).toBe(hashOf(clone()));
  });

  it("volatile timestamp / row version change → NO hash change", () => {
    const vm = clone();
    vm.manualVersion.updatedAt = "2099-12-31T23:59:59Z";
    vm.manualVersion.rowVersion = 999;
    vm.sections[0].rowVersion = 42;
    vm.sections[0].blocks[0].rowVersion = 7;
    expect(hashOf(vm)).toBe(hashOf(clone()));
  });
});

describe("publication snapshot — leak scan (spec §8)", () => {
  it("a freshly built snapshot contains no volatile / secret keys", () => {
    expect(scanSnapshotForLeaks(buildPublishedSnapshot(clone(), OPTS))).toEqual([]);
  });

  it("the scan catches an injected signed URL / token / row version", () => {
    const dirty = { content: { images: [{ id: "x", signedUrl: "https://s/u" }] }, meta: { rowVersion: 3 } };
    const hits = scanSnapshotForLeaks(dirty);
    expect(hits.some((h) => h.toLowerCase().includes("signedurl"))).toBe(true);
    expect(hits.some((h) => h.toLowerCase().includes("rowversion"))).toBe(true);
  });

  it("the persisted snapshot never carries the signed URL, only stable image metadata", () => {
    const snap = buildPublishedSnapshot(clone(), { ...OPTS, imageStorageKeys: { "img-1": "manuals/img-1.png" } });
    const json = JSON.stringify(snap);
    expect(json).not.toMatch(/token=AAA/);
    expect(json).not.toMatch(/signedUrl/i);
    // v2: `images` is an ORDERED array; storageKey lives only on the top-level server-only array
    expect(snap.images[0]).toMatchObject({ altText: "alt", caption: "Diagram.", storageKey: "manuals/img-1.png" });
    expect((snap.content.images as unknown[])[0]).toEqual({ altText: "alt", caption: "Diagram." });
  });
});

describe("publication snapshot — v2 publication references (Phase 7 §15)", () => {
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  it("snapshotVersion is 2 and the build is deterministic", () => {
    const a = buildPublishedSnapshot(clone(), OPTS);
    const b = buildPublishedSnapshot(clone(), OPTS);
    expect(a.snapshotVersion).toBe(2);
    expect(computeSnapshotHash(a)).toBe(computeSnapshotHash(b));
  });

  it("parameterTable raw group ids become positional groupRefs; image ids become imageRef", () => {
    const snap = buildPublishedSnapshot(clone(), OPTS);
    const sections = snap.content.sections as { blocks: Record<string, unknown>[] }[];
    const paramBlock = sections[1].blocks[0];
    const imageBlock = sections[1].blocks[1];
    expect(paramBlock.groupRefs).toEqual([0]);
    expect(paramBlock.parameterGroupIds).toBeUndefined();
    expect(imageBlock.imageRef).toBe(0);
    expect(imageBlock.imageAssetId).toBeUndefined();
  });

  it("a parameter subset resolves to the right index (2 groups, block references only the 2nd)", () => {
    const vm = clone();
    vm.parameterGroups.push({
      id: "grp-1", name: "Risk", position: 1,
      parameters: [{ id: "p9", displayName: "Max DD", technicalName: "MaxDD", paramType: "double", defaultValue: "20", unit: "%", safeRange: "0-50", description: null, orderEffect: null, mutability: "before_start", required: false, position: 0 }],
    });
    vm.sections[1].blocks[0].parameterGroupIds = ["grp-1"];
    (vm.sections[1].blocks[0].payload as { groupIds: string[] }).groupIds = ["grp-1"];
    const snap = buildPublishedSnapshot(vm, OPTS);
    const block = (snap.content.sections as { blocks: Record<string, unknown>[] }[])[1].blocks[0];
    expect(block.groupRefs).toEqual([1]);
  });

  it("no raw database UUID survives in the public-renderable content", () => {
    const snap = buildPublishedSnapshot(clone(), OPTS);
    expect(JSON.stringify(snap.content)).not.toMatch(UUID_RE);
  });

  it("image order follows first block appearance, not input-map key order", () => {
    const vm = clone();
    // two images; the block references img-z first even though the map lists img-a first
    vm.images = {
      "img-a": { id: "img-a", altText: "A", caption: null, signedUrl: null },
      "img-z": { id: "img-z", altText: "Z", caption: null, signedUrl: null },
    };
    vm.sections[1].blocks[1].imageAssetId = "img-z";
    (vm.sections[1].blocks[1].payload as { imageAssetId: string }).imageAssetId = "img-z";
    const snap = buildPublishedSnapshot(vm, OPTS);
    expect(snap.content.images).toEqual([
      { altText: "Z", caption: null }, // referenced by the block first
      { altText: "A", caption: null }, // orphan, appended in sorted order
    ]);
    expect((snap.content.sections as { blocks: Record<string, unknown>[] }[])[1].blocks[1].imageRef).toBe(0);
  });

  it("steps[].imageAssetId is transformed to a positional imageRef and shares the image namespace", () => {
    const UUID_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"; // referenced by a step
    const UUID_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"; // referenced by an image block AFTER the steps block
    const build = () => {
      const vm = clone();
      // vm.images deliberately inserted in REVERSE of appearance order
      vm.images = {
        [UUID_B]: { id: UUID_B, altText: "B", caption: null, signedUrl: "https://x?token=Z" },
        [UUID_A]: { id: UUID_A, altText: "A", caption: null, signedUrl: "https://x?token=Y" },
      };
      vm.sections[1].blocks = [
        {
          id: "s1", type: "steps", position: 0, imageAssetId: null, parameterGroupIds: [], rowVersion: 1,
          payload: { type: "steps", schemaVersion: 1, steps: [
            { title: "Buka", instruction: "Langkah 1" },
            { title: "Pasang", instruction: "Langkah 2", imageAssetId: UUID_A },
          ] },
        },
        {
          id: "i1", type: "image", position: 1, imageAssetId: UUID_B, parameterGroupIds: [], rowVersion: 1,
          payload: { type: "image", schemaVersion: 1, imageAssetId: UUID_B, caption: "B" },
        },
      ];
      return buildPublishedSnapshot(vm, OPTS);
    };

    const snap = build();
    const blocks = (snap.content.sections as { blocks: Record<string, unknown>[] }[])[1].blocks;
    const steps = blocks[0].payload as { steps: Record<string, unknown>[] };

    // step image -> imageRef 0 (first appearance); image block -> imageRef 1
    expect(steps.steps[0].imageAssetId).toBeUndefined();
    expect(steps.steps[0].imageRef).toBeUndefined();
    expect(steps.steps[1].imageAssetId).toBeUndefined();
    expect(steps.steps[1].imageRef).toBe(0);
    expect(blocks[1].imageRef).toBe(1);

    // no raw asset UUID anywhere in public-renderable content; deterministic + key-order-insensitive
    const json = JSON.stringify(snap.content);
    expect(json).not.toMatch(new RegExp(UUID_A));
    expect(json).not.toMatch(new RegExp(UUID_B));
    expect(json).not.toMatch(UUID_RE);
    expect(computeSnapshotHash(build())).toBe(computeSnapshotHash(build()));
  });
});
