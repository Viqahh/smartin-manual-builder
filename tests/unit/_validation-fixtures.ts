/**
 * Shared deterministic fixtures for the Phase 5 validation tests. Not a test file (no
 * `.test.` in the name, so vitest ignores it).
 *
 * `passingContent()` is crafted so every one of the 31 v1 checks is PASS or NOT_APPLICABLE
 * for an IN_SCOPE EA with parameters, real support, no danger mode, no GUI, no verified
 * features and no performance figures.
 */

import type { ManualViewModel } from "@/lib/manual/view-model";
import { richTextFromParagraphs } from "@/lib/domain/rich-text";

type VmBlock = ManualViewModel["sections"][number]["blocks"][number];
export type Blocks = VmBlock[];

export const CANON = [
  "cover", "overview", "requirements", "package", "installation", "quick-start",
  "how-it-works", "parameters", "risk", "presets", "interface", "performance",
  "troubleshooting", "faq", "changelog", "disclaimer", "support", "transparency",
];

let uid = 0;
const id = (p: string) => `${p}-${(uid++).toString(16).padStart(4, "0")}`;

export function textBlock(text: string, pos = 0) {
  return {
    id: id("blk"),
    type: "text" as const,
    payload: { type: "text", schemaVersion: 1, content: richTextFromParagraphs([text]) },
    position: pos,
    imageAssetId: null as string | null,
    parameterGroupIds: [] as string[],
    rowVersion: 1,
  } as VmBlock;
}
export function calloutBlock(tone: string, text: string, pos = 0) {
  return {
    id: id("blk"),
    type: "callout" as const,
    payload: { type: "callout", schemaVersion: 1, tone, content: richTextFromParagraphs([text]) },
    position: pos,
    imageAssetId: null as string | null,
    parameterGroupIds: [] as string[],
    rowVersion: 1,
  } as VmBlock;
}
export function paramTableBlock(groupIds: string[], pos = 0) {
  return {
    id: id("blk"),
    type: "parameterTable" as const,
    payload: { type: "parameterTable", schemaVersion: 1, groupIds },
    position: pos,
    imageAssetId: null as string | null,
    parameterGroupIds: groupIds,
    rowVersion: 1,
  } as VmBlock;
}
export function stepsBlock(steps: string[], pos = 0) {
  return {
    id: id("blk"),
    type: "steps" as const,
    payload: {
      type: "steps",
      schemaVersion: 1,
      steps: steps.map((s, i) => ({ title: `Langkah ${i + 1}`, instruction: s, menuPath: i === 1 ? "File > Open Data Folder" : "" })),
    },
    position: pos,
    imageAssetId: null as string | null,
    parameterGroupIds: [] as string[],
    rowVersion: 1,
  } as VmBlock;
}
export function imageBlock(caption: string, pos = 0) {
  return {
    id: id("blk"),
    type: "image" as const,
    payload: { type: "image", schemaVersion: 1, caption, altText: caption },
    position: pos,
    imageAssetId: id("img"),
    parameterGroupIds: [] as string[],
    rowVersion: 1,
  } as VmBlock;
}

export function makeVm(opts: {
  content?: Record<string, Blocks>;
  requirements?: Record<string, unknown>;
  support?: Record<string, unknown>;
  eaVersion?: string;
  manualVersion?: string;
  developer?: { name: string } | null;
  organization?: string;
  groups?: { name: string; params: { technicalName: string; displayName: string; defaultValue: string | null }[] }[];
  changelog?: ManualViewModel["changelog"];
} = {}): ManualViewModel {
  const content = opts.content ?? {};
  const orgName = opts.organization ?? "PT Smartin Advisor Sistem";
  const groups = (opts.groups ?? []).map((g, gi) => ({
    id: `grp-${gi}`,
    name: g.name,
    position: gi,
    parameters: g.params.map((p, pi) => ({
      id: `par-${gi}-${pi}`,
      displayName: p.displayName,
      technicalName: p.technicalName,
      paramType: "double" as const,
      defaultValue: p.defaultValue,
      unit: null,
      safeRange: null,
      description: null,
      orderEffect: null,
      mutability: "before_start" as const,
      required: true,
      position: pi,
    })),
  }));
  return {
    manual: { id: "m1", locale: "id" },
    manualVersion: { id: "mv1", version: opts.manualVersion ?? "1.0.0", status: "DRAFT", rowVersion: 1, updatedAt: "2026-01-01T00:00:00Z" },
    eaProduct: { id: "p1", name: "TestEA", slug: "test-ea", description: "" },
    eaVersion: {
      id: "ev1",
      version: opts.eaVersion ?? "1.2.0",
      platform: "MT5",
      releaseDate: "2026-01-01",
      requirements: opts.requirements ?? {},
      support: opts.support ?? {},
    },
    organization: { id: "org-a", name: orgName },
    developer: opts.developer === undefined ? { name: orgName } : opts.developer,
    supportedSetups: [],
    sections: CANON.map((key, i) => ({
      id: `sec-${key}`,
      key,
      title: key,
      required: true,
      isCustom: false,
      position: i,
      completionState: "in_progress" as const,
      rowVersion: 1,
      blocks: content[key] ?? [],
    })),
    parameterGroups: groups,
    images: {},
    changelog: opts.changelog ?? [],
  };
}

/** Content where every one of the 31 v1 checks evaluates to PASS or NOT_APPLICABLE. */
export function passingContent(): Record<string, Blocks> {
  return {
    cover: [
      textBlock(
        "Manual EA TestEA untuk MetaTrader 5. Diterbitkan oleh PT Smartin Advisor Sistem. Versi EA 1.2.0, versi Manual 1.0.0 ditampilkan terpisah. Dokumentasi ini berlaku untuk versi 1.2.0. Tanggal rilis 1 Januari 2026.",
      ),
    ],
    overview: [
      textBlock(
        "EA masuk pasar berdasarkan perpotongan moving average pada M15. Mengelola satu posisi tunggal tanpa grid. Pengguna mengawasi sebagai mode semi-otomatis. Tidak cocok untuk scalper 1 menit. Pengguna diharapkan memiliki kemampuan margin minimum paling sedikit Rp50.000.000 dan memahami risiko PBK serta bahwa EA tidak menjamin profit.",
      ),
    ],
    requirements: [
      textBlock("MetaTrader 5 build 4000 atau lebih baru. Akun hedging yang sudah diuji. Deposit uji demo USD 1.000. VPS disarankan agar AutoTrading tetap hidup. DLL: Tidak. WebRequest: Tidak."),
    ],
    installation: [
      stepsBlock([
        "Buka terminal MetaTrader 5 yang benar.",
        "Klik File lalu Open Data Folder untuk membuka Data Folder.",
        "Masuk ke folder MQL5/Experts lalu salin berkas .ex5 ke sana.",
        "Salin indikator kustom ke MQL5/Indicators bila ada.",
        "Di Navigator, klik kanan Expert Advisors lalu Refresh.",
        "Mulai ulang terminal bila nama EA belum muncul.",
      ]),
      textBlock(
        "Setelah terpasang, aktifkan tombol Algo Trading global dan centang Allow Algo Trading pada tab Common EA. Ikon smiley di pojok chart berwarna hijau berarti normal, merah berarti trading otomatis diblokir.",
      ),
    ],
    "quick-start": [
      textBlock(
        "Gunakan akun demo terlebih dahulu, jangan akun riil. Buka chart simbol resmi pada timeframe resmi, pasang EA, muat preset resmi, centang izin trading, tekan OK. Anda harus melihat smiley hijau dan baris log initialized. Untuk menghentikan EA dengan aman saat masih ada posisi terbuka, nonaktifkan Algo Trading lalu lepas EA dari chart; jangan sekadar menutup chart.",
      ),
    ],
    "how-it-works": [
      textBlock(
        "Kondisi masuk: jika candle M15 ditutup di atas high sesi Asia dan tidak ada posisi pada magic number EA, maka EA mengirim order buy dengan stop loss di low sesi. Kondisi tidak masuk: saat spread terlalu lebar EA melewatkan sinyal dan tidak entry. Manajemen posisi memakai satu posisi tunggal tanpa martingale. Kondisi keluar: take profit, stop loss, atau sinyal berlawanan. Saat koneksi terputus lalu tersambung kembali, EA menilai ulang posisi terbuka; gap akhir pekan tidak menambah posisi. Bila OnInit gagal, EA menolak untuk start. Bila dua chart simbol sama aktif, EA memakai magic number berbeda agar tidak double order. Jika pengguna menutup posisi manual, EA tidak membuka lagi pada tick berikutnya.",
      ),
    ],
    parameters: [paramTableBlock(["grp-0"])],
    risk: [
      textBlock(
        "Lot dihitung dari (ekuitas x persen risiko / 100) dibagi nilai rugi bila SL terkena. Bila lot hasil hitung di bawah minimum broker, EA memakai lot minimum. Trading forex/CFD berisiko tinggi dan modal dapat berkurang atau bahkan hilang. Hasil masa lalu tidak menjamin hasil di masa depan.",
      ),
    ],
    presets: [
      textBlock("Preset resmi XAUUSD M15 diuji pada broker ECN, rentang tanggal 2024-01 sampai 2024-12, model setiap tick, spread rata-rata dilaporkan. Muat preset lewat tab Inputs lalu Load."),
    ],
    performance: [textBlock("Belum ada data backtest yang dipublikasikan pada versi ini.")],
    troubleshooting: [
      textBlock("EA tidak muncul di Navigator: folder salah atau belum refresh. Smiley merah: aktifkan Algo Trading. Tidak ada order: cek filter spread dan server time."),
    ],
    changelog: [textBlock("[1.2.0] — 2026-01-01: rilis awal EA. Added: strategi MA cross. Tidak ada perubahan breaking.")],
    disclaimer: [
      textBlock(
        "EA ini adalah sistem otomatis yang hanya alat bantu. EA tidak menjamin keuntungan dan tidak menghilangkan risiko Perdagangan Berjangka Komoditi. Trading berisiko dan modal dapat hilang. Hasil masa lalu tidak menjamin hasil di masa depan. Pengguna bertanggung jawab memilih broker dan ukuran lot. Sebelum EA dijalankan di akun pialang berjangka Indonesia, nasabah menyelesaikan disclosure statement dan rekaman video sesuai Perba 12/2022.",
      ),
    ],
    support: [
      textBlock(
        "Kontak dukungan: email support@test.demo dan WhatsApp +62 812. Layanan tersedia 24 jam setiap hari nonstop. Masalah teknis seperti instalasi, input, dan error ditangani tim teknis Smartin; masalah transaksi dan finansial termasuk margin menjadi tanggung jawab pialang berjangka.",
      ),
    ],
    transparency: [
      textBlock(
        "Strategi EA memakai perpotongan moving average dengan konfirmasi RSI sebagai sistem trading utama, konsisten dengan bab Cara Kerja. Algoritma dan instruksi program ditulis dalam Bahasa Indonesia. Periode efektif penggunaan EA adalah dua belas bulan sejak aktivasi lisensi advisory. Layanan purna jual untuk masalah teknis mengacu pada bab Dukungan.",
      ),
    ],
  };
}

export const passingGroups = [
  { name: "Trading", params: [{ technicalName: "FixedLot", displayName: "Fixed Lot", defaultValue: "0.01" }] },
];
export const passingSupport = { email: "support@test.demo", whatsapp: "+62 812", hours: "24 jam" };
