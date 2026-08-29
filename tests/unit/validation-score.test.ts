/**
 * Phase 5 — score / eligibility / scope / counts (AC-P5-3/6/7, spec §40/§41).
 * Exact integer arithmetic; no floating-precision noise.
 */

import { describe, it, expect } from "vitest";
import type { ManualViewModel } from "@/lib/manual/view-model";
import type { ChecklistItemDef, ItemResult } from "@/lib/validation/types";
import { computeScore, computeEligibility, computeCounts, evaluateManual } from "@/lib/validation/evaluate";
import { CHECKLIST_V1 } from "@/lib/validation/rules";
import { makeVm, passingContent, passingGroups, passingSupport } from "./_validation-fixtures";

const R = (required: boolean, state: ItemResult["state"], label = "x"): Pick<ItemResult, "required" | "state" | "label"> => ({
  required,
  state,
  label,
});

describe("computeScore (AC-P5-3)", () => {
  it("all applicable required PASS -> 100%", () => {
    const s = computeScore(Array.from({ length: 6 }, () => R(true, "PASS")));
    expect(s).toEqual({ numerator: 6, denominator: 6, percent: 100 });
  });
  it("8 PASS of 10 required applicable -> 80% (1 WARNING + 1 MISSING stay in the denominator)", () => {
    const items = [
      ...Array.from({ length: 8 }, () => R(true, "PASS")),
      R(true, "WARNING"),
      R(true, "MISSING"),
    ];
    expect(computeScore(items)).toEqual({ numerator: 8, denominator: 10, percent: 80 });
  });
  it("NOT_APPLICABLE is excluded from BOTH numerator and denominator", () => {
    const items = [R(true, "PASS"), R(true, "PASS"), R(true, "NOT_APPLICABLE"), R(true, "MISSING")];
    expect(computeScore(items)).toEqual({ numerator: 2, denominator: 3, percent: 67 });
  });
  it("optional items never enter the required score", () => {
    const items = [R(true, "PASS"), R(false, "MISSING"), R(false, "PASS")];
    expect(computeScore(items)).toEqual({ numerator: 1, denominator: 1, percent: 100 });
  });
  it("zero applicable required items -> percent null (never a misleading 100%)", () => {
    expect(computeScore([R(true, "NOT_APPLICABLE"), R(false, "PASS")])).toEqual({
      numerator: 0,
      denominator: 0,
      percent: null,
    });
  });
});

describe("computeEligibility (AC-P5-6)", () => {
  it("a required MISSING blocks readiness and is named", () => {
    const e = computeEligibility([R(true, "PASS"), R(true, "MISSING", "Bab wajib tersedia dan berisi")]);
    expect(e.ready).toBe(false);
    expect(e.blockingReasons).toEqual(["Bab wajib tersedia dan berisi"]);
  });
  it("a WARNING alone does NOT block readiness", () => {
    const e = computeEligibility([R(true, "PASS"), R(true, "WARNING"), R(true, "NOT_APPLICABLE")]);
    expect(e.ready).toBe(true);
    expect(e.blockingReasons).toEqual([]);
  });
  it("only PASS / NOT_APPLICABLE -> ready", () => {
    expect(computeEligibility([R(true, "PASS"), R(true, "NOT_APPLICABLE")]).ready).toBe(true);
  });
  it("an optional MISSING does not block", () => {
    expect(computeEligibility([R(true, "PASS"), R(false, "MISSING")]).ready).toBe(true);
  });
});

describe("computeCounts", () => {
  it("tallies each state", () => {
    const c = computeCounts([R(true, "PASS"), R(true, "PASS"), R(true, "WARNING"), R(true, "MISSING"), R(true, "NOT_APPLICABLE")]);
    expect(c).toEqual({ PASS: 2, WARNING: 1, MISSING: 1, NOT_APPLICABLE: 0 + 1 });
  });
});

describe("PBK scope suppression (AC-P5-7, OQ-011)", () => {
  const base = () => ({ content: passingContent(), support: passingSupport, groups: passingGroups });

  it("IN_SCOPE: the seven Bappebti-only items are evaluated (not NA)", () => {
    const vm = makeVm({ ...base(), requirements: { pbkScope: "IN_SCOPE" } });
    const v = evaluateManual(vm, CHECKLIST_V1, { templateId: "t", templateVersion: 1 });
    for (const key of ["CHK-DISCLAIMER-5-5-D", "CHK-KONTAK", "CHK-TRANSPARANSI", "CHK-BAHASA-ALGO", "CHK-PERIODE-EFEKTIF", "CHK-DISCLOSURE-REF", "CHK-ONBOARDING-MARGIN"]) {
      expect(v.items.find((i) => i.checkKey === key)!.state, key).toBe("PASS");
    }
  });

  it("OUT_OF_SCOPE: all seven Bappebti-only items become NOT_APPLICABLE with no false MISSING; general checks still evaluate", () => {
    // remove disclaimer content so an IN_SCOPE eval WOULD report MISSING for the scoped items
    const c = passingContent();
    delete c.disclaimer;
    const vm = makeVm({ content: c, support: passingSupport, groups: passingGroups, requirements: { pbkScope: "OUT_OF_SCOPE" } });
    const v = evaluateManual(vm, CHECKLIST_V1, { templateId: "t", templateVersion: 1 });

    const BAPPEBTI = ["CHK-DISCLAIMER-5-5-D", "CHK-KONTAK", "CHK-TRANSPARANSI", "CHK-BAHASA-ALGO", "CHK-PERIODE-EFEKTIF", "CHK-DISCLOSURE-REF", "CHK-ONBOARDING-MARGIN"];
    for (const key of BAPPEBTI) {
      const it = v.items.find((i) => i.checkKey === key)!;
      expect(it.state, key).toBe("NOT_APPLICABLE");
      expect(it.evaluator, key).toBe("system");
    }

    // general checks still run
    expect(v.items.find((i) => i.checkKey === "CHK-PARAM-COMPLETE")!.state).toBe("PASS");
    expect(v.items.find((i) => i.checkKey === "CHK-VERSI-MATCH")!.state).toBe("PASS");
    expect(v.items.find((i) => i.checkKey === "CHK-KONTAK-SPLIT")!.state).toBe("PASS");
    expect(v.items.find((i) => i.checkKey === "CHK-CARA-KERJA")!.state).toBe("PASS");
    // no false MISSING from the suppressed set
    expect(v.eligibility.blockingReasons).toEqual([]);
    expect(v.eligibility.ready).toBe(true);
  });

  it("two otherwise-identical fixtures differ only in the suppressed items", () => {
    const c = passingContent();
    delete c.disclaimer; // disclaimer carries Pasal 5(5)d + Pasal 9 refs — both bappebti-only checks
    const opts = { content: c, support: passingSupport, groups: passingGroups };
    const inScope = evaluateManual(makeVm({ ...opts, requirements: { pbkScope: "IN_SCOPE" } }), CHECKLIST_V1, { templateId: "t", templateVersion: 1 });
    const outScope = evaluateManual(makeVm({ ...opts, requirements: { pbkScope: "OUT_OF_SCOPE" } }), CHECKLIST_V1, { templateId: "t", templateVersion: 1 });

    // in-scope: CHK-DISCLAIMER-5-5-D + CHK-DISCLOSURE-REF MISSING -> not ready
    expect(inScope.eligibility.ready).toBe(false);
    expect(inScope.eligibility.blockingReasons.length).toBeGreaterThan(0);
    // out-of-scope: those suppressed -> ready
    expect(outScope.eligibility.ready).toBe(true);
    // the score denominator shrinks OUT_OF_SCOPE (fewer applicable required items)
    expect(outScope.score.denominator).toBeLessThan(inScope.score.denominator);
  });
});

describe("recompute after a content change (AC-P5-3 'updates when content changes')", () => {
  it("MISSING -> PASS once the failing chapter gets content", () => {
    const c1 = passingContent();
    delete c1.installation;
    const before = evaluateManual(makeVm({ content: c1, support: passingSupport, groups: passingGroups }), CHECKLIST_V1, {
      templateId: "t",
      templateVersion: 1,
    });
    expect(before.items.find((i) => i.checkKey === "CHK-INSTALASI")!.state).toBe("MISSING");
    expect(before.eligibility.ready).toBe(false);

    const after = evaluateManual(makeVm({ content: passingContent(), support: passingSupport, groups: passingGroups }), CHECKLIST_V1, {
      templateId: "t",
      templateVersion: 1,
    });
    expect(after.items.find((i) => i.checkKey === "CHK-INSTALASI")!.state).toBe("PASS");
    expect(after.eligibility.ready).toBe(true);
    expect(after.score.percent).toBeGreaterThan(before.score.percent ?? -1);
  });
});

describe("reviewer N/A override preserved across re-evaluation (§26)", () => {
  it("a stored override keeps NOT_APPLICABLE + provenance even when the rule would now MISSING", () => {
    const c = passingContent();
    delete c.changelog; // CHK-CHANGELOG-VERSI would be MISSING (only that check reads this chapter)
    const vm: ManualViewModel = makeVm({ content: c, support: passingSupport, groups: passingGroups });
    const items: ChecklistItemDef[] = CHECKLIST_V1;
    const view = evaluateManual(vm, items, {
      templateId: "t",
      templateVersion: 1,
      overrides: {
        "CHK-CHANGELOG-VERSI": { actorId: "rev-1", actorName: "Rina", reason: "Changelog dikelola di sistem rilis terpisah untuk build ini.", at: "2026-02-01T00:00:00Z" },
      },
    });
    const it = view.items.find((i) => i.checkKey === "CHK-CHANGELOG-VERSI")!;
    expect(it.state).toBe("NOT_APPLICABLE");
    expect(it.evaluator).toBe("reviewer");
    expect(it.systemState).toBe("MISSING");
    expect(it.override?.actorName).toBe("Rina");
    expect(view.eligibility.ready).toBe(true); // NA no longer blocks
  });
});
