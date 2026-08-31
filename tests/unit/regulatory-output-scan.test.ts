/**
 * Phase 7 slice 5 — AC-P7-10: the public web page + PDF must carry NO regulatory-approval label
 * ("Approved" / "Bappebti Approved" / "Certified" / "Compliant").
 *
 * Enforcement reuses the EXISTING deterministic compliance engine — no second engine, no
 * render-time censorship:
 *   forbidden label in content  →  `scanClaims` finding (CLAIM-REGULATOR-ENDORSE)
 *                               →  `CHK-NO-PROHIBITED-CLAIMS` rule → WARNING
 *                               →  that checklist item is required + publish_blocking
 *                               →  `publish_manual_version` refuses the new publication.
 *
 * These tests cover the SCANNER + the RULE + the checklist wiring. The DB refusal + "no snapshot /
 * version / PDF artifact" is proven by the integration suite.
 */

import { describe, it, expect } from "vitest";
import { scanClaims } from "@/lib/ai/claim-scanner";
import { RULES, CHECKLIST_V1 } from "@/lib/validation/rules";
import { snapshotToViewModel } from "@/lib/publication/snapshot-view-model";
import { projectManualLines } from "@/lib/ai/manual-projection";
import { parityComprehensiveSnapshot, PARITY_SLUG, PARITY_VERSION } from "@/tests/support/parity-fixture";

const cats = (s: string) => new Set(scanClaims(s).map((f) => f.category));
const hasEndorse = (s: string) => cats(s).has("CLAIM-REGULATOR-ENDORSE");

describe("AC-P7-10 — forbidden regulatory-approval labels are detected (case-insensitive)", () => {
  const forbidden = [
    "Bappebti Approved",
    "BAPPEBTI APPROVED",
    "bappebti-approved",
    "Bappebti Certified",
    "Bappebti Compliant",
    "Regulator Approved",
    "Regulatory Compliant",
    "Bursa Certified",
    "Certified by Bappebti",
    "approved by the regulator",
    "Disahkan oleh Bappebti",
    "Tersertifikasi oleh Otoritas",
    "Status: Approved",
    "Sertifikasi: Compliant",
    "Badge - Certified",
    "EA ini telah Certified",
    "Manual ini Approved",
    "Aplikasi ini sudah tersertifikasi",
    "APPROVED",
    "✓ Certified",
    "  Compliant  ",
  ];

  for (const label of forbidden) {
    it(`detects: ${JSON.stringify(label)}`, () => {
      expect(hasEndorse(label), `"${label}" must raise CLAIM-REGULATOR-ENDORSE`).toBe(true);
    });
  }
});

describe("AC-P7-10 — neutral / allowed wording is NOT flagged", () => {
  const allowed = [
    "Dokumen ini siap untuk review kepatuhan internal Smartin.",
    "Checklist dokumentasi telah selesai.",
    "Semua item dokumentasi wajib telah tersedia.",
    "Perubahan fitur pada v2.1 disetujui klien sebelum rilis.", // Pasal 8 changelog language
    "The client approved the change before it reached production.",
    "EA ini menjalankan strategi mengikuti tren pada MetaTrader 5.",
    "Gunakan lot minimum sesuai persyaratan broker Anda.",
    "Kinerja masa lalu tidak menjamin hasil di masa depan.",
  ];
  for (const line of allowed) {
    it(`allows: ${JSON.stringify(line)}`, () => {
      expect(hasEndorse(line), `"${line}" must NOT raise CLAIM-REGULATOR-ENDORSE`).toBe(false);
    });
  }
});

describe("AC-P7-10 — CHK-NO-PROHIBITED-CLAIMS rule + publish-gate wiring", () => {
  const vmWith = (line: string) =>
    snapshotToViewModel(
      {
        snapshotVersion: 2,
        public: { slug: "x", version: "1.0.0" },
        template: { id: "t", version: 1 },
        content: {
          manual: { locale: "id" },
          manualVersion: { version: "1.0.0" },
          organization: { name: "Org" },
          eaProduct: { name: "EA", slug: "x", description: "" },
          eaVersion: { version: "1.0.0", platform: "MT5", releaseDate: null, requirements: {}, support: {} },
          developer: null,
          supportedSetups: [],
          parameterGroups: [],
          sections: [
            {
              key: "intro",
              title: "Pendahuluan",
              required: true,
              isCustom: false,
              position: 0,
              blocks: [
                {
                  type: "text",
                  position: 0,
                  payload: {
                    type: "text",
                    content: { schemaVersion: 2, format: "doc", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: line }] }] } },
                  },
                  groupRefs: [],
                },
              ],
            },
          ],
          images: [],
          changelog: [],
        },
        images: [],
      },
      { slug: "x", version: "1.0.0", status: "PUBLISHED" },
    );

  it("a manual with 'Bappebti Approved' in a text block → rule WARNING, publish-blocking", () => {
    const out = RULES["CHK-NO-PROHIBITED-CLAIMS"](vmWith("EA ini Bappebti Approved dan siap dipakai."));
    expect(out.state).toBe("WARNING");
    const ev = out.evidence as { publishBlockingCategories: string[] };
    expect(ev.publishBlockingCategories).toContain("CLAIM-REGULATOR-ENDORSE");
  });

  it("a neutral manual → rule PASS", () => {
    const out = RULES["CHK-NO-PROHIBITED-CLAIMS"](vmWith("EA ini mengikuti tren; hasil bergantung pada pasar."));
    expect(out.state).toBe("PASS");
    expect((out.evidence as { findingCount: number }).findingCount).toBe(0);
  });

  it("CHK-NO-PROHIBITED-CLAIMS is required + publish_blocking (the gate)", () => {
    const item = CHECKLIST_V1.find((i) => i.checkKey === "CHK-NO-PROHIBITED-CLAIMS");
    expect(item).toBeTruthy();
    expect(item!.required).toBe(true);
    expect(item!.publishBlocking).toBe(true);
  });
});

describe("AC-P7-10 — the comprehensive parity fixture is regulatory-clean", () => {
  it("no CLAIM-REGULATOR-ENDORSE finding anywhere in the fixture's projected text", () => {
    const vm = snapshotToViewModel(parityComprehensiveSnapshot(), {
      slug: PARITY_SLUG,
      version: PARITY_VERSION,
      status: "PUBLISHED",
    });
    const findings = scanClaims(projectManualLines(vm));
    expect(findings.filter((f) => f.category === "CLAIM-REGULATOR-ENDORSE")).toEqual([]);
  });

  it("case-insensitive raw string scan of the fixture text finds none of the four labels", () => {
    const vm = snapshotToViewModel(parityComprehensiveSnapshot(), {
      slug: PARITY_SLUG,
      version: PARITY_VERSION,
      status: "PUBLISHED",
    });
    const text = projectManualLines(vm).map((l) => l.text).join("\n").toLowerCase();
    for (const label of ["approved", "bappebti approved", "certified", "compliant"]) {
      expect(text.includes(label), `fixture text must not contain "${label}"`).toBe(false);
    }
  });
});
