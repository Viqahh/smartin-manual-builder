export type ManualStatus =
  | "DRAFT"
  | "TECHNICAL_REVIEW"
  | "COMPLIANCE_REVIEW"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "PUBLISHED";

export type ChapterState = "complete" | "current" | "incomplete" | "issue";

export type ManualRecord = {
  id: string;
  eaName: string;
  platform: "MT4" | "MT5";
  eaVersion: string;
  manualVersion: string;
  completion: number;
  compliance: string;
  status: ManualStatus;
  updated: string;
};

export type Chapter = {
  id: string;
  number: string;
  title: string;
  required: boolean;
  state: ChapterState;
};

export const manuals: ManualRecord[] = [
  {
    id: "vmax-ea",
    eaName: "VMax EA",
    platform: "MT5",
    eaVersion: "1.0.0",
    manualVersion: "1.0.0",
    completion: 82,
    compliance: "21 / 26",
    status: "DRAFT",
    updated: "28 Agu 2026",
  },
  {
    id: "smart-grid-pro",
    eaName: "Smart Grid Pro",
    platform: "MT5",
    eaVersion: "2.4.1",
    manualVersion: "2.4.0",
    completion: 96,
    compliance: "25 / 26",
    status: "COMPLIANCE_REVIEW",
    updated: "27 Agu 2026",
  },
  {
    id: "momentum-edge",
    eaName: "Momentum Edge",
    platform: "MT4",
    eaVersion: "3.1.0",
    manualVersion: "3.1.0",
    completion: 100,
    compliance: "26 / 26",
    status: "PUBLISHED",
    updated: "25 Agu 2026",
  },
  {
    id: "nusa-scalper",
    eaName: "Nusa Scalper",
    platform: "MT5",
    eaVersion: "0.9.0",
    manualVersion: "0.8.2",
    completion: 61,
    compliance: "16 / 26",
    status: "CHANGES_REQUESTED",
    updated: "23 Agu 2026",
  },
];

export const chapters: Chapter[] = [
  { id: "cover", number: "0", title: "Sampul & Identitas Produk", required: true, state: "complete" },
  { id: "overview", number: "1", title: "Ringkasan Produk", required: true, state: "complete" },
  { id: "requirements", number: "2", title: "Persyaratan Sistem & Broker", required: true, state: "complete" },
  { id: "package", number: "3", title: "Isi Paket", required: false, state: "complete" },
  { id: "installation", number: "4", title: "Instalasi", required: true, state: "complete" },
  { id: "quick-start", number: "5", title: "Mulai Cepat", required: true, state: "complete" },
  { id: "how-it-works", number: "6", title: "Cara Kerja EA", required: true, state: "issue" },
  { id: "parameters", number: "7", title: "Referensi Input / Parameter", required: true, state: "complete" },
  { id: "risk", number: "8", title: "Risiko & Manajemen Dana", required: true, state: "incomplete" },
  { id: "presets", number: "9", title: "Preset, Pair & Timeframe", required: true, state: "complete" },
  { id: "interface", number: "10", title: "Antarmuka EA", required: false, state: "incomplete" },
  { id: "performance", number: "11", title: "Informasi Backtest", required: true, state: "issue" },
  { id: "troubleshooting", number: "12", title: "Pemecahan Masalah", required: true, state: "complete" },
  { id: "faq", number: "13", title: "Pertanyaan Umum", required: false, state: "incomplete" },
  { id: "changelog", number: "14", title: "Catatan Perubahan", required: true, state: "complete" },
  { id: "disclaimer", number: "15", title: "Pernyataan Risiko", required: true, state: "complete" },
  { id: "support", number: "16", title: "Dukungan", required: true, state: "complete" },
  { id: "transparency", number: "17", title: "Transparansi Strategi", required: true, state: "incomplete" },
];

export const parameters = [
  {
    displayName: "Fixed Lot",
    technicalName: "FixedLot",
    type: "double",
    defaultValue: "0.01",
    safeRange: "0.01–1.00 lot",
    effect: "Menentukan ukuran transaksi tetap.",
  },
  {
    displayName: "Maximum Orders",
    technicalName: "MaxOrder",
    type: "integer",
    defaultValue: "5",
    safeRange: "1–10 order",
    effect: "Membatasi jumlah posisi aktif secara bersamaan.",
  },
  {
    displayName: "Magic Number",
    technicalName: "MagicNumber",
    type: "integer",
    defaultValue: "40021",
    safeRange: "Unik per chart",
    effect: "Membedakan transaksi VMax EA dari EA lain.",
  },
];

export const statusLabels: Record<ManualStatus, string> = {
  DRAFT: "Draf",
  TECHNICAL_REVIEW: "Review teknis",
  COMPLIANCE_REVIEW: "Review kepatuhan",
  CHANGES_REQUESTED: "Perlu perubahan",
  APPROVED: "Disetujui",
  PUBLISHED: "Diterbitkan",
};
