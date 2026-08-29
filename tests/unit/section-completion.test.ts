import { describe, it, expect } from "vitest";
import {
  sectionCompletionBlockers,
  eaDeclaresDangerMode,
  type CompletionBlock,
} from "@/lib/domain/section-completion";

const img = (id: string | null): CompletionBlock => ({
  type: "image",
  payload: id ? { imageAssetId: id } : {},
  imageAssetId: id,
});
const callout = (tone: string): CompletionBlock => ({ type: "callout", payload: { tone }, imageAssetId: null });
const text: CompletionBlock = { type: "text", payload: {}, imageAssetId: null };

describe("AC-P3-9 — empty ALT blocks chapter completion", () => {
  it("blocks completion when an image block's asset has no alt text", () => {
    const reasons = sectionCompletionBlockers({
      sectionKey: "installation",
      blocks: [img("a1")],
      imageAltText: { a1: "" },
    });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/ALT/);
  });

  it("blocks completion when an image block has no asset chosen at all", () => {
    const reasons = sectionCompletionBlockers({ sectionKey: "installation", blocks: [img(null)], imageAltText: {} });
    expect(reasons.some((r) => /ALT/.test(r))).toBe(true);
  });

  it("allows completion once every image asset has alt text", () => {
    const reasons = sectionCompletionBlockers({
      sectionKey: "installation",
      blocks: [img("a1"), img("a2"), text],
      imageAltText: { a1: "Tombol AutoTrading", a2: "Jendela Navigator" },
    });
    expect(reasons).toEqual([]);
  });

  it("chapters with no image blocks are unaffected", () => {
    expect(sectionCompletionBlockers({ sectionKey: "overview", blocks: [text], imageAltText: {} })).toEqual([]);
  });
});

describe("AC-P3-11 — risk chapter of a danger-mode EA needs a warning callout", () => {
  it("blocks completion when the risk chapter has no warning callout and the EA declares a danger mode", () => {
    const reasons = sectionCompletionBlockers({
      sectionKey: "risk",
      blocks: [text, callout("info")],
      imageAltText: {},
      eaDangerMode: true,
    });
    expect(reasons.some((r) => /berisiko tinggi/.test(r))).toBe(true);
  });

  it("passes once a warning callout is present", () => {
    const reasons = sectionCompletionBlockers({
      sectionKey: "risk",
      blocks: [callout("warning"), text],
      imageAltText: {},
      eaDangerMode: true,
    });
    expect(reasons).toEqual([]);
  });

  it("no danger mode → no warning required", () => {
    expect(
      sectionCompletionBlockers({ sectionKey: "risk", blocks: [text], imageAltText: {}, eaDangerMode: false }),
    ).toEqual([]);
  });

  it("only the risk chapter is checked", () => {
    expect(
      sectionCompletionBlockers({ sectionKey: "overview", blocks: [text], imageAltText: {}, eaDangerMode: true }),
    ).toEqual([]);
  });
});

describe("eaDeclaresDangerMode", () => {
  it("reads the forward-compatible flags", () => {
    expect(eaDeclaresDangerMode({ dangerMode: true })).toBe(true);
    expect(eaDeclaresDangerMode({ highRisk: true })).toBe(true);
    expect(eaDeclaresDangerMode({ riskMode: "danger" })).toBe(true);
    expect(eaDeclaresDangerMode({ vps: "Disarankan" })).toBe(false);
    expect(eaDeclaresDangerMode(null)).toBe(false);
  });
});
