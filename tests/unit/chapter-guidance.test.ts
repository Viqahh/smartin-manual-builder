/**
 * UAT-18 — chapter guidance metadata: one source of truth for the builder empty state, the
 * Template reference and the Panduan Dokumentasi page. UI-only (never persisted / rendered / scored).
 */
import { describe, it, expect } from "vitest";
import { allChapterGuidance, chapterGuidance, FACT_OWNER_LABEL } from "@/lib/domain/chapter-guidance";
import { CANONICAL_SECTION_KEYS } from "@/lib/domain/canonical-sections";

describe("chapter guidance", () => {
  it("covers all 18 canonical chapters, in order", () => {
    const all = allChapterGuidance();
    expect(all).toHaveLength(18);
    expect(all.map((g) => g.key)).toEqual([...CANONICAL_SECTION_KEYS]);
    expect(all.map((g) => g.order)).toEqual(Array.from({ length: 18 }, (_, i) => i));
  });

  it("returns null for a custom (non-canonical) chapter key", () => {
    expect(chapterGuidance("custom-1234")).toBeNull();
  });

  it("every chapter has a purpose, at least one 'belongs' item and a suggested block", () => {
    for (const g of allChapterGuidance()) {
      expect(g.purpose.length, g.key).toBeGreaterThan(10);
      expect(g.belongs.length, g.key).toBeGreaterThan(0);
      expect(g.suggestedBlocks.length, g.key).toBeGreaterThan(0);
    }
  });

  it("how-it-works guidance explicitly forbids inventing entry/exit/filter/risk logic", () => {
    const g = chapterGuidance("how-it-works")!;
    expect(g.doNotAssume.join(" ")).toMatch(/jangan mengarang/i);
    expect(g.factOwner).toBe("source-of-truth");
  });

  it("parameters guidance points at the EA Version as the single source (no manual copy)", () => {
    const g = chapterGuidance("parameters")!;
    expect(g.belongs.join(" ")).toMatch(/EA Version/i);
    expect(g.doNotAssume.join(" ")).toMatch(/daftar parameter manual yang terpisah/i);
  });

  it("support/disclaimer/transparency are owned by organisation/compliance, not the author alone", () => {
    expect(chapterGuidance("support")!.factOwner).toBe("organisation");
    expect(chapterGuidance("disclaimer")!.factOwner).toBe("compliance");
    expect(chapterGuidance("transparency")!.factOwner).toBe("compliance");
    expect(FACT_OWNER_LABEL.compliance).toMatch(/kepatuhan/i);
  });

  it("no guidance text contains internal-phase wording", () => {
    const blob = JSON.stringify(allChapterGuidance());
    expect(blob).not.toMatch(/Phase\s*\d/i);
    expect(blob).not.toMatch(/akan (dihubungkan|disusun)/i);
  });
});
