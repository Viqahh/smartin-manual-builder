import { describe, it, expect } from "vitest";
import {
  assembleManualViewModel,
  manualIdentity,
  type ManualDataSource,
  type ManualViewModel,
} from "@/lib/manual/view-model";

function makeVm(eaName: string, manualVersionString: string): ManualViewModel {
  return {
    manual: { id: "m-" + eaName, locale: "id" },
    manualVersion: {
      id: "mv-" + eaName,
      version: manualVersionString,
      status: "DRAFT",
      rowVersion: 1,
      updatedAt: "2026-09-01T00:00:00Z",
    },
    eaProduct: { id: "p-" + eaName, name: eaName, slug: eaName.toLowerCase(), description: "" },
    eaVersion: {
      id: "e-" + eaName,
      version: "2.1.0",
      platform: "MT5",
      releaseDate: null,
      requirements: {},
      support: {},
    },
    organization: { id: "o1", name: "Org" },
    developer: null,
    supportedSetups: [
      { id: "s2", symbol: "XAUUSD", timeframe: "H1", presetRef: null, testedMinimumLot: null, notes: null, isSupported: true, position: 1 },
      { id: "s1", symbol: "XAUUSD", timeframe: "M15", presetRef: null, testedMinimumLot: null, notes: null, isSupported: true, position: 0 },
    ],
    sections: [
      { id: "sec1", key: "cover", title: "Sampul", required: true, isCustom: false, position: 0, completionState: "incomplete", rowVersion: 1, blocks: [] },
    ],
    parameterGroups: [],
    images: {},
  };
}

describe("manual view model assembler (spec §18, AC-P2-12)", () => {
  it("returns null for an empty id and for an unknown manual", async () => {
    const source: ManualDataSource = { loadManualVersionByManualId: async () => null };
    expect(await assembleManualViewModel(source, "")).toBeNull();
    expect(await assembleManualViewModel(source, "does-not-exist")).toBeNull();
  });

  it("assembles the exact manual requested — no cross-manual leakage", async () => {
    const polaris = makeVm("Polaris EA", "2.1.0");
    const source: ManualDataSource = {
      loadManualVersionByManualId: async (id) => (id === polaris.manual.id ? polaris : null),
    };
    const out = await assembleManualViewModel(source, polaris.manual.id);
    expect(out).not.toBeNull();
    const id = manualIdentity(out!);
    expect(id.eaName).toBe("Polaris EA");
    expect(id.eaName).not.toContain("VMax");
    expect(id.manualVersion).toBe("2.1.0");
    expect(id.platform).toBe("MT5");
  });

  it("sorts sections, blocks, setups, and parameters by position deterministically", async () => {
    const model = makeVm("Polaris EA", "2.1.0");
    const source: ManualDataSource = { loadManualVersionByManualId: async () => model };
    const out = await assembleManualViewModel(source, model.manual.id);
    expect(out!.supportedSetups.map((s) => s.timeframe)).toEqual(["M15", "H1"]);
  });
});
