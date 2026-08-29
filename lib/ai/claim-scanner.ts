/**
 * Deterministic, ADVISORY claim scanner (PRD-AI-006, AC-P4-8, docs/COMPLIANCE_REQUIREMENTS.md
 * §4). Covers every prohibited category. Bahasa Indonesia + English phrasing.
 *
 * Both `MockAIProvider.detectClaims` and `ConfiguredAIProvider.detectClaims` delegate here:
 * compliance-category coverage must be deterministic and testable, and the AI is not the
 * compliance authority. Findings are advisory — they NEVER mutate a block, change workflow
 * status, mark a manual compliant, or approve anything (Phase 5+ owns that).
 */

import { CLAIM_CATEGORIES, type ClaimCategory, type ClaimFinding } from "./types";

type Rule = {
  category: ClaimCategory;
  categoryLabel: string;
  explanation: string;
  recommendedAction: string;
  /** Case-insensitive patterns. A hit on ANY pattern raises one finding for the line. */
  patterns: RegExp[];
  /** Optional guard: the pattern only counts as a finding if this ALSO matches (context). */
  requireAlso?: RegExp;
  /** Optional exemption: if this matches the line, suppress the finding (e.g. a disclaimer). */
  suppressIf?: RegExp;
};

const PERF_NUMBER = /\b(\d{1,3}(?:[.,]\d+)?\s*%|\d+(?:[.,]\d+)?\s*(pip|poin|points?)|(?:rp|usd|\$|idr)\s?\d)/i;
const PERF_CONDITION = /\b(spread|broker|model|tick|kondisi|periode|tanggal|dari .* sampai|jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des|20\d\d)/i;

const RULES: Rule[] = [
  {
    category: "CLAIM-PROFIT-GUARANTEE",
    categoryLabel: "Jaminan profit",
    explanation:
      "Menjanjikan keuntungan pasti dilarang (Perba 12/2022 Pasal 5 ayat (3)). EA adalah alat bantu; hasil tidak dijamin.",
    recommendedAction: "Hapus kata 'pasti'/'guaranteed'. Nyatakan bahwa hasil bergantung pada pasar dan pengaturan.",
    patterns: [
      /profit\s+pasti/i,
      /pasti\s+(untung|profit|cuan)/i,
      /di?jamin\s+(untung|profit|cuan)/i,
      /guaranteed\s+profit/i,
      /profit\s+setiap\s+hari/i,
      /untung\s+setiap\s+hari/i,
      /pasti\s+menghasilkan/i,
    ],
  },
  {
    category: "CLAIM-CONSISTENCY",
    categoryLabel: "Klaim konsistensi / tanpa rugi",
    explanation: "Klaim 'selalu profit' / 'no-loss' menyesatkan dan wajib dihapus sebelum publikasi.",
    recommendedAction: "Ganti dengan pernyataan berimbang: EA dapat mengalami rugi; gunakan manajemen risiko.",
    patterns: [
      /konsisten\s+profit/i,
      /selalu\s+(profit|untung|menang)/i,
      /tidak\s+pernah\s+(rugi|loss)/i,
      /no[-\s]?loss/i,
      /win[-\s]?rate\s+100\s?%/i,
      /always\s+profitable/i,
    ],
  },
  {
    category: "CLAIM-RISK-FREE",
    categoryLabel: "Klaim bebas risiko",
    explanation: "Menyatakan produk perdagangan berjangka 'bebas risiko' atau 'aman 100%' dilarang.",
    recommendedAction: "Hapus klaim bebas risiko. Cantumkan pernyataan risiko sesuai Pasal 5(5)d di bab Pernyataan Risiko.",
    patterns: [
      /bebas\s+risiko/i,
      /tanpa\s+risiko/i,
      /risk[-\s]?free/i,
      /aman\s*100\s?%/i,
      /100\s?%\s*aman/i,
      /zero\s+risk/i,
      /modal\s+(pasti\s+)?(aman|kembali|terlindungi)/i,
    ],
  },
  {
    category: "CLAIM-UNCONDITIONED-PERF",
    categoryLabel: "Kinerja tanpa kondisi uji",
    explanation:
      "Angka win-rate / return tanpa konteks broker, spread, model, dan periode uji tidak boleh berdiri sendiri (Chapter 11).",
    recommendedAction: "Sertakan kondisi uji lengkap: broker/akun, spread, model kualitas tick, dan rentang tanggal.",
    patterns: [
      /win[-\s]?rate\s*\d/i,
      /winrate\s*\d/i,
      /return\s*\d{1,3}\s?%/i,
      /profit\s*(sebesar|hingga|up\s+to)?\s*(rp|usd|\$)\s?\d/i,
      /keuntungan\s*(rp|usd|\$)\s?\d/i,
      /drawdown\s*\d{1,3}\s?%/i,
      /rata-?rata\s+profit\s+\d/i,
    ],
    requireAlso: PERF_NUMBER,
    suppressIf: PERF_CONDITION,
  },
  {
    category: "CLAIM-PROFIT-SHARING",
    categoryLabel: "Bagi hasil",
    explanation: "Skema bagi hasil dari penggunaan EA dilarang untuk dokumentasi EA di ruang lingkup PBK.",
    recommendedAction: "Hapus tawaran bagi hasil / profit sharing dari manual.",
    patterns: [/bagi\s+hasil/i, /profit\s+shar(ing|e)/i, /sistem\s+bagi\s+untung/i, /skema\s+bagi\s+hasil/i],
  },
  {
    category: "CLAIM-ON-BEHALF",
    categoryLabel: "Transaksi atas nama klien",
    explanation:
      "Menyatakan EA 'bertransaksi atas nama' klien mengaburkan tanggung jawab; keputusan transaksi tetap pada nasabah.",
    recommendedAction: "Nyatakan EA menjalankan instruksi terprogram; nasabah tetap mengendalikan akun dan risiko.",
    patterns: [
      /(bertransaksi|transaksi|trading|berdagang)\s+atas\s+nama\s+(anda|klien|nasabah|kamu)/i,
      /trades?\s+on\s+(your|the\s+client'?s)\s+behalf/i,
      /mewakili\s+(anda|klien|nasabah)\s+(bertransaksi|berdagang)/i,
    ],
  },
  {
    category: "CLAIM-MLM",
    categoryLabel: "MLM / member-get-member",
    explanation: "Distribusi EA lewat skema jaringan/referal berjenjang dilarang.",
    recommendedAction: "Hapus ajakan merekrut downline / member-get-member dari manual.",
    patterns: [
      /member\s+get\s+member/i,
      /downline/i,
      /upline/i,
      /jaringan\s+(referal|referral|member)/i,
      /rekrut\s+(member|anggota)/i,
      /komisi\s+(referal|referral|jaringan)/i,
      /mlm/i,
    ],
  },
  {
    category: "CLAIM-DEV-MARGIN",
    categoryLabel: "Kirim margin ke developer",
    explanation:
      "Instruksi mengirim margin/dana ke rekening developer dilarang; dana nasabah hanya ke rekening terpisah pialang.",
    recommendedAction: "Hapus instruksi transfer dana ke developer. Dana ditempatkan hanya di rekening terpisah pialang berizin.",
    patterns: [
      /(transfer|kirim|setor)\s+(margin|dana|modal|deposit)\s+ke\s+(rekening\s+)?(kami|developer|pengembang)/i,
      /send\s+(margin|funds?|deposit)\s+to\s+(our|the\s+developer'?s)\s+account/i,
      /margin\s+ke\s+rekening\s+(kami|developer)/i,
    ],
  },
  {
    category: "CLAIM-REGULATOR-ENDORSE",
    categoryLabel: "Klaim endorsemen regulator",
    explanation:
      "Aplikasi ini tidak memberi persetujuan regulator. Klaim 'disetujui Bappebti' / 'Bappebti approved' tanpa rekaman resmi dilarang.",
    recommendedAction: "Hapus klaim persetujuan regulator. Sebut proses Bappebti sebagai kewajiban yang dijalankan di luar alat ini.",
    patterns: [
      /di?setujui\s+bappebti/i,
      /bappebti\s+approved/i,
      /lolos\s+verifikasi\s+bappebti/i,
      /terdaftar\s+resmi\s+(di\s+)?bappebti\s+sebagai\s+ea/i,
      /regulator[-\s]?verified/i,
      /(disahkan|diakui|direstui)\s+(oleh\s+)?(bappebti|otoritas|regulator)/i,
    ],
  },
  {
    category: "CLAIM-BROKER-PARTNER",
    categoryLabel: "Kemitraan broker tak terverifikasi",
    explanation: "Klaim 'official partner broker X' tanpa bukti dapat menyesatkan.",
    recommendedAction: "Hapus klaim kemitraan resmi kecuali ada bukti; sebut broker hanya sebagai contoh kompatibilitas.",
    patterns: [
      /official\s+partner\s+broker/i,
      /partner\s+resmi\s+broker/i,
      /mitra\s+resmi\s+(dari\s+)?broker/i,
      /bekerja\s+sama\s+resmi\s+dengan\s+broker/i,
      /broker\s+rekanan\s+resmi/i,
    ],
  },
];

/** Ensure every category in the spec has a rule (guards against drift). */
if (RULES.length !== CLAIM_CATEGORIES.length) {
  throw new Error(
    `claim-scanner: ${RULES.length} rules but ${CLAIM_CATEGORIES.length} categories in COMPLIANCE_REQUIREMENTS.md §4`,
  );
}

export type ScanLine = { text: string; location: string };

/**
 * Scan a set of located lines (from `projectManualText`) or a single string.
 *
 * The rule set is intentionally bilingual (Bahasa Indonesia + English) and locale-agnostic —
 * a manual may mix languages — so there is no `locale` parameter: every rule runs on every line.
 */
export function scanClaims(input: string | ScanLine[]): ClaimFinding[] {
  const lines: ScanLine[] =
    typeof input === "string"
      ? input.split(/\n+/).map((t, i) => ({ text: t, location: `baris ${i + 1}` }))
      : input;

  const findings: ClaimFinding[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    for (const rule of RULES) {
      if (rule.suppressIf && rule.suppressIf.test(text)) continue;
      if (rule.requireAlso && !rule.requireAlso.test(text)) continue;
      const hit = rule.patterns.find((p) => p.test(text));
      if (!hit) continue;
      const m = text.match(hit);
      findings.push({
        category: rule.category,
        categoryLabel: rule.categoryLabel,
        severity: "advisory",
        excerpt: excerptAround(text, m?.index ?? 0, m?.[0]?.length ?? 0),
        location: line.location,
        explanation: rule.explanation,
        recommendedAction: rule.recommendedAction,
      });
    }
  }
  return findings;
}

/** ~90-char window around the match — never a large content dump. */
function excerptAround(text: string, index: number, len: number): string {
  const pad = 30;
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + len + pad);
  const slice = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${slice}${end < text.length ? "…" : ""}`.slice(0, 120);
}
