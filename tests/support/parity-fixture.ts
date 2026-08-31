/**
 * Phase 7 slice 5 — TEST-ONLY comprehensive parity fixture (Snapshot v2 shape).
 *
 * One immutable snapshot with every PUBLIC block type + the structural cases the parity manifest
 * and the visual fixture must exercise: multiple rich-text blocks, warning + info callouts,
 * multi-step instructions with a step image, a standalone image + caption, an FAQ, a `presets`
 * chapter (triggers the injected supported-configuration table), 3 parameter groups incl. a long
 * table, an empty templated chapter (lead placeholder), a custom chapter, ~14 chapters total.
 *
 * All prose is neutral — NO "Approved" / "Bappebti Approved" / "Certified" / "Compliant" (AC-P7-10).
 */

// the canonical persisted rich-text v2 wrapper (matches `richTextSchema`)
const rt = (paras: string[]) => ({
  schemaVersion: 2 as const,
  format: "doc" as const,
  doc: {
    type: "doc",
    content: paras.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })),
  },
});

const LOREM =
  "Expert Advisor ini menjalankan strategi mengikuti tren pada MetaTrader 5. Bagian ini " +
  "menjelaskan cara kerja, pengaturan, dan batasan penggunaan secara netral dan faktual.";

const param = (grp: string, n: number) => ({
  displayName: `${grp} Parameter ${n}`,
  technicalName: `${grp}_Param_${n}`,
  paramType: ["double", "int", "bool", "string"][n % 4],
  defaultValue: String((n / 100).toFixed(2)),
  unit: n % 2 ? "pip" : null,
  safeRange: `${n}-${n + 40}`,
  description: `Deskripsi ${grp} nomor ${n}.`,
  orderEffect: n % 3 ? `Mengatur perilaku ${grp} nomor ${n}.` : null,
  mutability: "before_start",
  required: n % 2 === 0,
  position: n - 1,
});

export const PARITY_SLUG = "p7-parity-fixture";
export const PARITY_VERSION = "1.0.0";

export function parityComprehensiveSnapshot() {
  const sections: Record<string, unknown>[] = [
    {
      key: "cover",
      title: "Pendahuluan",
      required: true,
      isCustom: false,
      position: 0,
      blocks: [
        { type: "text", position: 0, payload: { type: "text", content: rt([LOREM, "Frasa unik parity: matahari-terbit-di-timur."]) }, groupRefs: [] },
        { type: "text", position: 1, payload: { type: "text", content: rt(["Paragraf kedua untuk menguji banyak blok teks."]) }, groupRefs: [] },
      ],
    },
    {
      key: "presets", // triggers the injected supported-configuration table
      title: "Konfigurasi yang Didukung",
      required: true,
      isCustom: false,
      position: 1,
      blocks: [{ type: "text", position: 0, payload: { type: "text", content: rt(["Tabel di bawah mencantumkan simbol dan timeframe yang telah diuji."]) }, groupRefs: [] }],
    },
    {
      key: "install",
      title: "Instalasi",
      required: true,
      isCustom: false,
      position: 2,
      blocks: [
        {
          type: "steps",
          position: 0,
          payload: {
            type: "steps",
            steps: [
              { title: "Salin file EA", instruction: "Letakkan file .ex5 pada folder Experts.", menuPath: "File > Open Data Folder" },
              { title: "Muat ulang MetaTrader", instruction: "Restart terminal agar EA terbaca.", imageRef: 0 },
              { title: "Aktifkan Algo Trading", instruction: "Klik tombol Algo Trading pada toolbar." },
            ],
          },
          groupRefs: [],
        },
      ],
    },
    {
      key: "how-it-works",
      title: "Cara Kerja EA",
      required: true,
      isCustom: false,
      position: 3,
      blocks: [
        { type: "text", position: 0, payload: { type: "text", content: rt([LOREM]) }, groupRefs: [] },
        { type: "callout", position: 1, payload: { type: "callout", tone: "info", content: rt(["Catatan: uji selalu di akun demo terlebih dahulu."]) }, groupRefs: [] },
        { type: "image", position: 2, payload: { type: "image", caption: "Gambar 2 — panel pengaturan." }, imageRef: 1, groupRefs: [] },
      ],
    },
    {
      key: "core-params",
      title: "Parameter Inti",
      required: true,
      isCustom: false,
      position: 4,
      blocks: [
        { type: "text", position: 0, payload: { type: "text", content: rt(["Parameter inti mengatur ukuran dan frekuensi order."]) }, groupRefs: [] },
        { type: "parameterTable", position: 1, payload: { type: "parameterTable" }, groupRefs: [0] },
      ],
    },
    {
      key: "risk-params",
      title: "Parameter Manajemen Risiko",
      required: true,
      isCustom: false,
      position: 5,
      blocks: [{ type: "parameterTable", position: 0, payload: { type: "parameterTable" }, groupRefs: [1] }],
    },
    {
      key: "advanced-params",
      title: "Parameter Lanjutan",
      required: false,
      isCustom: true,
      position: 6,
      blocks: [{ type: "parameterTable", position: 0, payload: { type: "parameterTable" }, groupRefs: [2] }],
    },
    {
      key: "daily",
      title: "Alur Kerja Harian",
      required: false,
      isCustom: true,
      position: 7,
      blocks: [
        {
          type: "steps",
          position: 0,
          payload: {
            type: "steps",
            steps: [
              { title: "Periksa berita", instruction: "Tinjau kalender ekonomi sebelum sesi." },
              { title: "Pantau drawdown", instruction: "Hentikan EA jika melampaui batas Anda.", imageRef: 2 },
            ],
          },
          groupRefs: [],
        },
      ],
    },
    {
      key: "monitoring",
      title: "Pemantauan",
      required: false,
      isCustom: true,
      position: 8,
      blocks: [
        { type: "callout", position: 0, payload: { type: "callout", tone: "warning", content: rt(["Mode agresif meningkatkan risiko — gunakan lot minimum."]) }, groupRefs: [] },
        { type: "image", position: 1, payload: { type: "image" }, imageRef: 3, groupRefs: [] },
      ],
    },
    {
      key: "errors",
      title: "Penanganan Error",
      required: false,
      isCustom: true,
      position: 9,
      blocks: [{ type: "text", position: 0, payload: { type: "text", content: rt([LOREM, "Frasa unik parity dua: bulan-mengelilingi-bumi."]) }, groupRefs: [] }],
    },
    {
      key: "backtest",
      title: "Backtest",
      required: false,
      isCustom: true,
      position: 10,
      blocks: [{ type: "text", position: 0, payload: { type: "text", content: rt(["Gunakan data tick berkualitas tinggi dan spread realistis."]) }, groupRefs: [] }],
    },
    {
      key: "faq",
      title: "Tanya Jawab",
      required: false,
      isCustom: true,
      position: 11,
      blocks: [
        { type: "faq", position: 0, payload: { type: "faq", question: "Apakah butuh VPS?", answer: rt(["Disarankan agar EA berjalan tanpa gangguan koneksi."]) }, groupRefs: [] },
        { type: "faq", position: 1, payload: { type: "faq", question: "Bisakah untuk akun kecil?", answer: rt(["Ya, mulai dari lot minimum dan tambah bertahap."]) }, groupRefs: [] },
      ],
    },
    {
      key: "risk",
      title: "Batasan dan Risiko",
      required: true,
      isCustom: false,
      position: 12,
      blocks: [
        { type: "callout", position: 0, payload: { type: "callout", tone: "warning", content: rt(["Kinerja masa lalu tidak menjamin hasil di masa depan."]) }, groupRefs: [] },
        { type: "text", position: 1, payload: { type: "text", content: rt([LOREM]) }, groupRefs: [] },
      ],
    },
    {
      key: "changelog",
      title: "Riwayat Perubahan",
      required: false,
      isCustom: true,
      position: 13,
      blocks: [], // empty templated chapter -> lead placeholder
    },
  ];

  const images = [
    { altText: "Terminal MetaTrader dimuat ulang", caption: "Gambar 1 — terminal setelah restart." },
    { altText: "Panel pengaturan EA", caption: "Gambar 2 — panel pengaturan." },
    { altText: "Grafik drawdown harian", caption: "Gambar 3 — contoh kurva drawdown." },
    { altText: "Ikhtisar pemantauan", caption: "Gambar 4 — ringkasan status EA." },
  ];

  return {
    snapshotVersion: 2 as const,
    public: { slug: PARITY_SLUG, version: PARITY_VERSION },
    template: { id: "00000000-0000-4000-8000-0000000000aa", version: 1 },
    content: {
      manual: { locale: "id" },
      manualVersion: { version: PARITY_VERSION },
      organization: { name: "PT Smartin Advisor Sistem" },
      eaProduct: { name: "Parity Demo EA", slug: PARITY_SLUG, description: "Fixture uji paritas keluaran." },
      eaVersion: { version: "3.1.0", platform: "MT5", releaseDate: "2026-02-15", requirements: {}, support: {} },
      developer: "Andi Setiawan",
      supportedSetups: [
        { symbol: "XAUUSD", timeframe: "M15", presetRef: "xau.set", testedMinimumLot: 0.01, notes: null, isSupported: true, position: 0 },
        { symbol: "EURUSD", timeframe: "H1", presetRef: "eur.set", testedMinimumLot: 0.02, notes: "Data uji internal.", isSupported: true, position: 1 },
        { symbol: "GBPUSD", timeframe: "M5", presetRef: null, testedMinimumLot: null, notes: null, isSupported: false, position: 2 },
      ],
      parameterGroups: [
        { name: "Grup Trading", position: 0, parameters: Array.from({ length: 8 }, (_, i) => param("Trading", i + 1)) },
        { name: "Grup Risiko", position: 1, parameters: Array.from({ length: 24 }, (_, i) => param("Risiko", i + 1)) },
        { name: "Grup Lanjutan", position: 2, parameters: Array.from({ length: 6 }, (_, i) => param("Lanjutan", i + 1)) },
      ],
      sections,
      images,
      changelog: [],
    },
    images: images.map((im, i) => ({ storageKey: `org/parity-${i}.png`, altText: im.altText, caption: im.caption })),
  };
}
