/**
 * Canonical Smartin EA Manual Book structure (docs/CONTENT_REQUIREMENTS.md "Chapter map").
 * The first ManualVersion instantiates exactly these sections (PRD-MAN-006, AC-P2-10).
 *
 * `required` here follows the CONTENT_REQUIREMENTS chapter map: chapters 10/15/16/17 are
 * conditional (GUI presence / Bappebti scope) and are seeded as NOT required by default;
 * the Phase 5 checklist template refines this. `PRD-OQ-005` tracks the final split.
 */

export type CanonicalSection = {
  key: string;
  order: number;
  title: string;
  required: boolean;
};

export const CANONICAL_SECTIONS: readonly CanonicalSection[] = [
  { key: "cover", order: 0, title: "Sampul & Identitas Produk", required: true },
  { key: "overview", order: 1, title: "Ringkasan Produk", required: true },
  { key: "requirements", order: 2, title: "Persyaratan Sistem & Broker", required: true },
  { key: "package", order: 3, title: "Isi Paket", required: false },
  { key: "installation", order: 4, title: "Instalasi", required: true },
  { key: "quick-start", order: 5, title: "Mulai Cepat", required: true },
  { key: "how-it-works", order: 6, title: "Cara Kerja EA", required: true },
  { key: "parameters", order: 7, title: "Referensi Input / Parameter", required: true },
  { key: "risk", order: 8, title: "Risiko & Manajemen Dana", required: true },
  { key: "presets", order: 9, title: "Preset, Pair & Timeframe", required: true },
  { key: "interface", order: 10, title: "Antarmuka EA", required: false },
  { key: "performance", order: 11, title: "Informasi Backtest", required: true },
  { key: "troubleshooting", order: 12, title: "Pemecahan Masalah", required: true },
  { key: "faq", order: 13, title: "Pertanyaan Umum", required: false },
  { key: "changelog", order: 14, title: "Catatan Perubahan", required: true },
  { key: "disclaimer", order: 15, title: "Pernyataan Risiko", required: false },
  { key: "support", order: 16, title: "Dukungan", required: false },
  { key: "transparency", order: 17, title: "Transparansi Strategi", required: false },
] as const;

export const CANONICAL_SECTION_KEYS: readonly string[] = CANONICAL_SECTIONS.map((s) => s.key);

export function isCanonicalSectionKey(key: string): boolean {
  return CANONICAL_SECTION_KEYS.includes(key);
}
