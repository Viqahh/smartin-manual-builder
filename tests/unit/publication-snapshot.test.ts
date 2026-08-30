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
    expect(snap.images["img-1"]).toMatchObject({ altText: "alt", caption: "Diagram.", storageKey: "manuals/img-1.png" });
  });
});
