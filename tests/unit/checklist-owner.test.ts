/**
 * UAT-29 / UAT-12D — the "needs attention" list groups by RESOLUTION OWNER (not "invent more
 * wording"). The owner map is presentation only: it never changes a rule state or the publish gate.
 */
import { describe, it, expect } from "vitest";
import { CHECKLIST_V1 } from "@/lib/validation/rules";
import {
  CHECKLIST_OWNER_LABEL,
  CHECKLIST_OWNER_ORDER,
  checklistOwner,
} from "@/lib/validation/types";

describe("checklistOwner classification", () => {
  it("assigns a known owner to every v1 checklist item", () => {
    for (const c of CHECKLIST_V1) {
      const owner = checklistOwner(c.checkKey);
      expect(CHECKLIST_OWNER_ORDER, c.checkKey).toContain(owner);
    }
  });

  it("routes disclaimer / claim-language / algorithm-language checks to Compliance", () => {
    for (const key of ["CHK-DISCLAIMER-5-5-D", "CHK-NO-PROHIBITED-CLAIMS", "CHK-BAHASA-ALGO", "CHK-DISCLOSURE-REF"]) {
      expect(checklistOwner(key), key).toBe("compliance");
    }
  });

  it("routes support-contact / developer-legal / onboarding-margin to the organisation", () => {
    for (const key of ["CHK-KONTAK", "CHK-DEV-LEGAL", "CHK-ONBOARDING-MARGIN"]) {
      expect(checklistOwner(key), key).toBe("organisation");
    }
  });

  it("routes strategy / setting / parameter-completeness to source-of-truth (not the author)", () => {
    for (const key of ["CHK-CARA-KERJA", "CHK-SETTING", "CHK-PARAM-COMPLETE", "CHK-SPECIAL-CONDITIONS"]) {
      expect(checklistOwner(key), key).toBe("source-of-truth");
    }
  });

  it("routes install / quick-start / changelog to the author", () => {
    for (const key of ["CHK-INSTALASI", "CHK-QUICKSTART-DEMO", "CHK-CHANGELOG-VERSI"]) {
      expect(checklistOwner(key), key).toBe("author");
    }
  });

  it("owner labels never imply the developer failed", () => {
    expect(CHECKLIST_OWNER_LABEL["source-of-truth"]).not.toMatch(/gagal|salah|kurang teliti/i);
    expect(CHECKLIST_OWNER_LABEL.compliance).toMatch(/Compliance/);
  });
});
