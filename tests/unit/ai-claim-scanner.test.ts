/**
 * Phase 4 — advisory claim scanner matrix (spec §30, AC-P4-8,
 * docs/COMPLIANCE_REQUIREMENTS.md §4).
 *
 * Every prohibited category has at least one Bahasa Indonesia fixture and, where the rule set
 * carries English phrasing, one English fixture. Clean control fixtures must produce zero
 * findings. The scanner is ADVISORY: it returns typed findings and never mutates input.
 */

import { describe, it, expect } from "vitest";
import { scanClaims } from "@/lib/ai/claim-scanner";
import { CLAIM_CATEGORIES, type ClaimCategory } from "@/lib/ai/types";

function categoriesFor(text: string): ClaimCategory[] {
  return [...new Set(scanClaims(text).map((f) => f.category))];
}

const FIXTURES: Record<ClaimCategory, { id: string; en?: string }> = {
  "CLAIM-PROFIT-GUARANTEE": { id: "EA ini memberi profit pasti setiap bulan.", en: "This EA delivers guaranteed profit." },
  "CLAIM-CONSISTENCY": { id: "Robot ini konsisten profit dan tidak pernah rugi.", en: "This robot is always profitable." },
  "CLAIM-RISK-FREE": { id: "Strategi ini benar-benar tanpa risiko.", en: "A completely risk-free strategy." },
  "CLAIM-UNCONDITIONED-PERF": { id: "Win rate 95% dari seluruh transaksi pengguna kami." },
  "CLAIM-PROFIT-SHARING": { id: "Kami menawarkan skema bagi hasil dari keuntungan EA.", en: "We offer profit sharing from the EA gains." },
  "CLAIM-ON-BEHALF": { id: "EA bertransaksi atas nama nasabah secara penuh.", en: "The EA trades on your behalf automatically." },
  "CLAIM-MLM": { id: "Ajak teman dan rekrut member untuk membangun downline Anda.", en: "Join our member get member program." },
  "CLAIM-DEV-MARGIN": { id: "Silakan kirim dana ke rekening developer untuk aktivasi.", en: "Please send funds to the developer's account." },
  "CLAIM-REGULATOR-ENDORSE": { id: "Produk ini sudah disetujui Bappebti.", en: "This product is Bappebti approved." },
  "CLAIM-BROKER-PARTNER": { id: "Kami adalah mitra resmi broker XM.", en: "We are an official partner broker of XM." },
};

describe("claim scanner — every §4 category is detected", () => {
  it("covers exactly the 10 documented categories with one rule each", () => {
    // (scanning a deliberately loud string must be able to raise every category)
    const all = categoriesFor(Object.values(FIXTURES).map((f) => `${f.id}\n${f.en ?? ""}`).join("\n"));
    expect([...all].sort()).toEqual([...CLAIM_CATEGORIES].sort());
  });

  for (const cat of CLAIM_CATEGORIES) {
    const fx = FIXTURES[cat];
    it(`${cat} — Bahasa Indonesia fixture`, () => {
      expect(categoriesFor(fx.id)).toContain(cat);
    });
    if (fx.en) {
      it(`${cat} — English fixture`, () => {
        expect(categoriesFor(fx.en!)).toContain(cat);
      });
    }
  }
});

describe("claim scanner — clean control fixtures raise nothing", () => {
  const CLEAN = [
    "Pasang file EX5 ke folder Experts lalu mulai ulang terminal MetaTrader.",
    "EA ini dapat mengalami kerugian; selalu gunakan manajemen risiko yang wajar.",
    "Baca bab Pernyataan Risiko sebelum mengaktifkan EA pada akun riil.",
    "Win rate 62% pada broker IC Markets, spread rata-rata 18 poin, model tick akurat, periode Jan 2023 sampai Des 2024.",
    "Broker yang kompatibel adalah yang mendukung hedging dan lot 0.01.",
  ];
  for (const line of CLEAN) {
    it(line.slice(0, 48), () => {
      expect(scanClaims(line)).toEqual([]);
    });
  }
});

describe("claim scanner — advisory shape & purity", () => {
  it("every finding is advisory and carries category / excerpt / explanation / action / location", () => {
    const findings = scanClaims([
      { text: "EA ini menjamin untung setiap hari.", location: 'Bab "Ikhtisar" — teks' },
    ]);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.severity).toBe("advisory");
      expect(f.category).toBeTruthy();
      expect(f.categoryLabel).toBeTruthy();
      expect(f.excerpt.length).toBeGreaterThan(0);
      expect(f.explanation.length).toBeGreaterThan(0);
      expect(f.recommendedAction.length).toBeGreaterThan(0);
      expect(f.location).toBe('Bab "Ikhtisar" — teks');
    }
  });

  it("does not mutate the input array", () => {
    const lines = [{ text: "bagi hasil 50:50", location: "x" }];
    const snapshot = JSON.stringify(lines);
    scanClaims(lines);
    expect(JSON.stringify(lines)).toBe(snapshot);
  });

  it("UNCONDITIONED-PERF is suppressed when full test conditions are present", () => {
    expect(categoriesFor("Return 40% (broker Exness, spread 12 poin, model tick, Jan 2024 sampai Jun 2024).")).not.toContain(
      "CLAIM-UNCONDITIONED-PERF",
    );
  });
});
