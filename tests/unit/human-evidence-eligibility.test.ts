/**
 * UAT-35 — "Sudah ada di manual" eligibility is an EXPLICIT, individually-audited per-rule set
 * (lib/validation/types.ts::HUMAN_EVIDENCE_ELIGIBLE), NOT inferred from "author-owned ∧
 * WARNING-capable". A rule is eligible only if its WARNING can plausibly be a genuine
 * prose-detection false negative that a reviewer could verify by reading the referenced chapter —
 * never a data-quality defect (e.g. invalid SemVer), never a structured / source-of-truth fact,
 * never a MISSING.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  HUMAN_EVIDENCE_ELIGIBLE,
  WARNING_CAPABLE,
  isHumanEvidenceEligible,
  checklistOwner,
} from "@/lib/validation/types";
import { evaluateManual } from "@/lib/validation/evaluate";
import { CHECKLIST_V1 } from "@/lib/validation/rules";
import {
  makeVm,
  passingContent,
  passingGroups,
  passingSupport,
  textBlock,
} from "./_validation-fixtures";

const MIGRATION = "supabase/migrations/20260901003000_phase8_human_evidence_eligible_reaudit.sql";

describe("UAT-35 eligibility — explicit audited set", () => {
  it("is exactly { CHK-INSTALL-AUTOTRADING, CHK-PACKAGE-FILES }", () => {
    expect([...HUMAN_EVIDENCE_ELIGIBLE].sort()).toEqual(["CHK-INSTALL-AUTOTRADING", "CHK-PACKAGE-FILES"]);
    expect(isHumanEvidenceEligible("CHK-INSTALL-AUTOTRADING")).toBe(true);
    expect(isHumanEvidenceEligible("CHK-PACKAGE-FILES")).toBe(true);
  });

  it("matches the DB copy (migration 31) exactly", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const m = sql.match(/check_key in \(([^)]+)\)/i);
    expect(m, "migration must set the flag from an explicit key list").toBeTruthy();
    const dbKeys = [...m![1].matchAll(/'([A-Z0-9-]+)'/g)].map((x) => x[1]).sort();
    expect([...HUMAN_EVIDENCE_ELIGIBLE].sort()).toEqual(dbKeys);
  });

  it("CHK-VERSI-DUA is INELIGIBLE — its WARNING is invalid-SemVer data, not a prose false negative", () => {
    // author-owned + WARNING-capable, but re-audited out: no chapter a reviewer reads makes an
    // invalid version string valid.
    expect(checklistOwner("CHK-VERSI-DUA")).toBe("author");
    expect(WARNING_CAPABLE.has("CHK-VERSI-DUA")).toBe(true);
    expect(isHumanEvidenceEligible("CHK-VERSI-DUA")).toBe(false);
    expect(HUMAN_EVIDENCE_ELIGIBLE.has("CHK-VERSI-DUA")).toBe(false);
  });

  it("NEVER eligible: any non-author owner, even when WARNING-capable", () => {
    for (const k of [...WARNING_CAPABLE].filter((x) => checklistOwner(x) !== "author")) {
      expect(isHumanEvidenceEligible(k), k).toBe(false);
    }
    // spot-check one of each non-author owner
    for (const k of ["CHK-KONTAK" /* org */, "CHK-CARA-KERJA" /* SoT */, "CHK-NO-PROHIBITED-CLAIMS" /* compliance */]) {
      expect(WARNING_CAPABLE.has(k), k).toBe(true);
      expect(isHumanEvidenceEligible(k), k).toBe(false);
    }
  });

  it("NEVER eligible: an author-owned rule that is only ever PASS/MISSING (no WARNING)", () => {
    for (const k of [
      "CHK-VERSI-MATCH",
      "CHK-INSTALASI",
      "CHK-QUICKSTART-DEMO",
      "CHK-SAFE-STOP",
      "CHK-KONTAK-SPLIT",
      "CHK-CHANGELOG-VERSI",
      "CHK-INTERFACE",
    ]) {
      expect(WARNING_CAPABLE.has(k), k).toBe(false);
      expect(isHumanEvidenceEligible(k), k).toBe(false);
    }
  });

  it("every eligible check is real, author-owned and WARNING-capable (necessary, not sufficient)", () => {
    for (const k of HUMAN_EVIDENCE_ELIGIBLE) {
      expect(CHECKLIST_V1.find((i) => i.checkKey === k), k).toBeTruthy();
      expect(checklistOwner(k), k).toBe("author");
      expect(WARNING_CAPABLE.has(k), k).toBe(true);
    }
  });
});

describe("WARNING_CAPABLE audit is sound (no rule emits an un-listed WARNING)", () => {
  const base = { support: passingSupport, groups: passingGroups } as const;
  const vms = [
    makeVm({ content: {}, ...base }),
    makeVm({ content: passingContent(), ...base }),
    (() => {
      const c = passingContent();
      c.installation = [textBlock("Aktifkan Algo Trading pada toolbar agar trading otomatis diizinkan.")];
      return makeVm({ content: c, ...base });
    })(),
    makeVm({ content: passingContent(), ...base, eaVersion: "1.0", manualVersion: "1.0.0" }),
  ];

  it("every WARNING produced across representative manuals is in WARNING_CAPABLE", () => {
    const emitted = new Set<string>();
    for (const vm of vms) {
      const view = evaluateManual(vm, CHECKLIST_V1, { templateId: "t", templateVersion: 1 });
      for (const it of view.items) if (it.systemState === "WARNING") emitted.add(it.checkKey);
    }
    for (const k of emitted) expect(WARNING_CAPABLE.has(k), `${k} emitted WARNING but is not audited`).toBe(true);
    expect(emitted.has("CHK-INSTALL-AUTOTRADING")).toBe(true);
    expect(emitted.has("CHK-VERSI-DUA")).toBe(true);
  });
});

describe("evaluateManual stamps humanEvidenceEligible correctly per WARNING", () => {
  it("a genuine prose-detection WARNING (Algo-Trading) → eligible; an invalid-SemVer WARNING → NOT eligible", () => {
    const c = passingContent();
    // installation names Algo Trading but no verification wording → CHK-INSTALL-AUTOTRADING WARNING
    c.installation = [textBlock("Aktifkan Algo Trading agar trading otomatis diizinkan.")];
    const view = evaluateManual(
      makeVm({ content: c, support: {}, groups: passingGroups, eaVersion: "1.0", manualVersion: "1.0.0" }),
      CHECKLIST_V1,
      { templateId: "t", templateVersion: 1 },
    );
    const autotrading = view.items.find((i) => i.checkKey === "CHK-INSTALL-AUTOTRADING")!;
    const versiDua = view.items.find((i) => i.checkKey === "CHK-VERSI-DUA")!;

    expect(autotrading.systemState).toBe("WARNING");
    expect(autotrading.humanEvidenceEligible).toBe(true); // prose false negative → button shows

    expect(versiDua.systemState).toBe("WARNING"); // "1.0" is not valid SemVer
    expect(versiDua.humanEvidenceEligible).toBe(false); // data-quality → NO button
  });
});
