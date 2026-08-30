/**
 * Phase 6 slice 1 — deterministic review-content fingerprint (AC-P6-10 groundwork; full
 * immutability is slice 6). Proves: byte stability, key-order invariance, content-change
 * sensitivity (order / params / defaults / setups / text), volatile-field exclusion.
 */

import { describe, it, expect } from "vitest";
import type { ManualViewModel } from "@/lib/manual/view-model";
import { computeContentFingerprint, projectReviewContent } from "@/lib/reviews/fingerprint";
import { makeVm, passingContent, passingGroups, passingSupport, textBlock } from "./_validation-fixtures";

const build = (opts: Parameters<typeof makeVm>[0] = {}) =>
  makeVm({ content: passingContent(), groups: passingGroups, support: passingSupport, requirements: { pbkScope: "IN_SCOPE" }, ...opts });

/** deep-clone with keys re-inserted in reverse order at every object level */
function reverseKeyOrder<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseKeyOrder) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).reverse()) {
      out[k] = reverseKeyOrder((value as Record<string, unknown>)[k]);
    }
    return out as T;
  }
  return value;
}

describe("byte stability", () => {
  it("identical logical content → identical hash (rebuilt fixture)", () => {
    const a = computeContentFingerprint({ vm: build() });
    const b = computeContentFingerprint({ vm: build() });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stable across many recomputations of the same VM", () => {
    const vm = build();
    const hashes = new Set(Array.from({ length: 8 }, () => computeContentFingerprint({ vm })));
    expect(hashes.size).toBe(1);
  });
});

describe("object key insertion order does not change the hash", () => {
  it("reversing every object's key order yields the same digest", () => {
    const vm = build();
    const scrambled = reverseKeyOrder(vm) as ManualViewModel;
    expect(computeContentFingerprint({ vm: scrambled })).toBe(computeContentFingerprint({ vm }));
  });

  it("projection is logically equal regardless of key order (stableStringify handles it)", () => {
    const vm = build();
    const p1 = JSON.stringify(projectReviewContent({ vm }));
    const p2 = JSON.stringify(projectReviewContent({ vm: reverseKeyOrder(vm) as ManualViewModel }));
    // raw JSON.stringify may differ by key order; the hash (which sorts keys) must not
    expect(computeContentFingerprint({ vm }) === computeContentFingerprint({ vm: reverseKeyOrder(vm) as ManualViewModel })).toBe(true);
    expect(typeof p1).toBe("string");
    expect(typeof p2).toBe("string");
  });
});

describe("meaningful content changes alter the hash", () => {
  const baseHash = () => computeContentFingerprint({ vm: build() });

  it("section order change", () => {
    const vm = build();
    // swap positions of the first two sections
    const [a, b] = [vm.sections[0], vm.sections[1]];
    a.position = 1;
    b.position = 0;
    expect(computeContentFingerprint({ vm })).not.toBe(baseHash());
  });

  it("block order change within a section", () => {
    const c = passingContent();
    c.installation = [textBlock("Langkah A", 0), textBlock("Langkah B", 1)];
    const forward = computeContentFingerprint({ vm: build({ content: c }) });
    const c2 = passingContent();
    c2.installation = [textBlock("Langkah A", 1), textBlock("Langkah B", 0)];
    expect(computeContentFingerprint({ vm: build({ content: c2 }) })).not.toBe(forward);
  });

  it("manual text change", () => {
    const c = passingContent();
    c.overview = [textBlock("Ringkasan asli.")];
    const h1 = computeContentFingerprint({ vm: build({ content: c }) });
    const c2 = passingContent();
    c2.overview = [textBlock("Ringkasan yang diubah.")];
    expect(computeContentFingerprint({ vm: build({ content: c2 }) })).not.toBe(h1);
  });

  it("parameter default change", () => {
    const g1 = [{ name: "Trading", params: [{ technicalName: "FixedLot", displayName: "Fixed Lot", defaultValue: "0.01" }] }];
    const g2 = [{ name: "Trading", params: [{ technicalName: "FixedLot", displayName: "Fixed Lot", defaultValue: "0.5" }] }];
    expect(computeContentFingerprint({ vm: build({ groups: g1 }) })).not.toBe(computeContentFingerprint({ vm: build({ groups: g2 }) }));
  });

  it("new parameter added to a group", () => {
    const g2 = [
      { name: "Trading", params: [
        { technicalName: "FixedLot", displayName: "Fixed Lot", defaultValue: "0.01" },
        { technicalName: "MaxOrders", displayName: "Max Orders", defaultValue: "5" },
      ] },
    ];
    expect(computeContentFingerprint({ vm: build({ groups: g2 }) })).not.toBe(baseHash());
  });

  it("supported setup change", () => {
    const vm = build();
    vm.supportedSetups = [
      { id: "s1", symbol: "XAUUSD", timeframe: "M15", presetRef: null, testedMinimumLot: null, notes: null, isSupported: true, position: 0 },
    ];
    const h1 = computeContentFingerprint({ vm });
    const vm2 = build();
    vm2.supportedSetups = [
      { id: "s1", symbol: "EURUSD", timeframe: "H1", presetRef: null, testedMinimumLot: null, notes: null, isSupported: true, position: 0 },
    ];
    expect(computeContentFingerprint({ vm: vm2 })).not.toBe(h1);
  });

  it("EA version identity / requirements change", () => {
    expect(computeContentFingerprint({ vm: build({ eaVersion: "1.2.0" }) })).not.toBe(
      computeContentFingerprint({ vm: build({ eaVersion: "1.3.0" }) }),
    );
    expect(computeContentFingerprint({ vm: build({ requirements: { pbkScope: "IN_SCOPE" } }) })).not.toBe(
      computeContentFingerprint({ vm: build({ requirements: { pbkScope: "OUT_OF_SCOPE" } }) }),
    );
  });

  it("changelog entry change", () => {
    const vm = build();
    const h0 = computeContentFingerprint({ vm });
    const h1 = computeContentFingerprint({
      vm,
      changelog: [{ position: 0, entryType: "ADDED", body: "Fitur baru.", sourceEaVersionId: null, isFeatureChange: true, openPositionImpact: null }],
    });
    expect(h1).not.toBe(h0);
  });
});

describe("volatile / non-content fields are excluded", () => {
  it("signed URL differences do not affect the hash", () => {
    const withUrl = (url: string): ManualViewModel => {
      const vm = build();
      vm.images = { "asset-1": { id: "asset-1", altText: "Panel", caption: "Panel EA", signedUrl: url } };
      return vm;
    };
    expect(computeContentFingerprint({ vm: withUrl("https://x.supabase.co/sign/a?token=AAA&exp=1") })).toBe(
      computeContentFingerprint({ vm: withUrl("https://x.supabase.co/sign/a?token=ZZZ&exp=999999") }),
    );
    // but the image ALT/caption (real content) still count
    const vmAlt = build();
    vmAlt.images = { "asset-1": { id: "asset-1", altText: "Berbeda", caption: "Panel EA", signedUrl: "x" } };
    expect(computeContentFingerprint({ vm: vmAlt })).not.toBe(computeContentFingerprint({ vm: withUrl("x") }));
  });

  it("updatedAt / rowVersion / status changes do not affect the hash", () => {
    const vm = build();
    const h0 = computeContentFingerprint({ vm });
    vm.manualVersion.updatedAt = "2099-01-01T00:00:00Z";
    vm.manualVersion.rowVersion = 999;
    vm.manualVersion.status = "TECHNICAL_REVIEW";
    vm.sections[0].rowVersion = 42;
    vm.sections[0].completionState = "complete";
    vm.sections[0].blocks.forEach((b) => (b.rowVersion = 7));
    expect(computeContentFingerprint({ vm })).toBe(h0);
  });

  it("DB row ids for setups / parameters do not affect the hash", () => {
    const vm = build();
    const h0 = computeContentFingerprint({ vm });
    vm.supportedSetups.forEach((s) => (s.id = "rewritten-" + s.id));
    vm.parameterGroups.forEach((g) => {
      g.id = "rewritten-" + g.id;
      g.parameters.forEach((p) => (p.id = "rewritten-" + p.id));
    });
    vm.sections.forEach((s) => {
      s.id = "rewritten-" + s.id;
      s.blocks.forEach((b) => (b.id = "rewritten-" + b.id));
    });
    expect(computeContentFingerprint({ vm })).toBe(h0);
  });

  it("the projection contains no signed URL, token, or secret-looking string", () => {
    const vm = build();
    vm.images = { a: { id: "a", altText: "x", caption: "y", signedUrl: "https://x/sign?token=SECRET" } };
    const blob = JSON.stringify(projectReviewContent({ vm })).toLowerCase();
    for (const bad of ["token=", "signedurl", "http://", "https://", "sb_secret", "bearer "]) {
      expect(blob).not.toContain(bad);
    }
  });
});
