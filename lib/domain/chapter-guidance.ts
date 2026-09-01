/**
 * Per-canonical-chapter authoring guidance (UI-only). ONE source of truth for:
 *   - the empty-state helper shown above the first block in the builder (UAT-18),
 *   - the read-only Template reference page (UAT-30),
 *   - the Panduan Dokumentasi resource page (UAT-31).
 *
 * Distilled from docs/CONTENT_REQUIREMENTS.md (the contributor guide + Perba Bappebti 12/2022).
 * It is NEVER persisted, NEVER rendered in Preview / Public / Print / PDF, and NEVER counts as
 * chapter content or validation evidence.
 */

import type { BlockType } from "@/lib/domain/blocks";
import { CANONICAL_SECTIONS } from "@/lib/domain/canonical-sections";

export type ChapterGuidance = {
  key: string;
  order: number;
  title: string;
  required: boolean;
  /** one line: why this chapter exists */
  purpose: string;
  /** the facts that belong here */
  belongs: string[];
  /** what the author must NOT invent / assume */
  doNotAssume: string[];
  /** block types that usually carry this chapter's content */
  suggestedBlocks: BlockType[];
  /** a short, safe example sentence (optional) */
  example?: string;
  /** who typically supplies the missing facts, when they are not the author */
  factOwner?: "author" | "source-of-truth" | "organisation" | "compliance";
};

const G: Record<string, Omit<ChapterGuidance, "key" | "order" | "title" | "required">> = {
  cover: {
    purpose: "Mengidentifikasi produk dan versi persis yang dijelaskan dokumen ini secara tidak ambigu.",
    belongs: [
      "Nama EA (sama persis dengan nama di Navigator dan nama file terkompilasi).",
      "Platform (MT4 atau MT5) dan nama file .ex4 / .ex5.",
      "Versi EA dan Versi Manual sebagai dua nilai terpisah, plus tanggal rilis/build.",
      "Developer/kontributor dan organisasi.",
      'Kalimat "Dokumentasi ini berlaku untuk versi X.Y.Z."',
    ],
    doNotAssume: [
      'Jangan menambahkan tagline yang menjanjikan hasil ("auto profit", "winrate tinggi").',
      'Jangan menulis "Disetujui Bappebti" / "Approved" / "Certified" — tidak ada catatan persetujuan pada alat ini.',
    ],
    suggestedBlocks: ["text", "image", "callout"],
    example: "Contoh: Dokumentasi ini berlaku untuk VMax EA versi 1.0.0 pada MetaTrader 5.",
    factOwner: "author",
  },
  overview: {
    purpose: "Dalam ~10 baris, jelaskan apa yang EA lakukan dan tidak lakukan.",
    belongs: [
      "Dasar EA masuk pasar (mis. pola candle + MA + RSI; breakout sesi Asia).",
      "Cara EA mengelola posisi (single, grid, martingale, hedging, partial close).",
      "Apa yang harus diawasi pengguna (full-auto, semi-auto, perlu konfirmasi tombol).",
      "Untuk siapa EA ini TIDAK cocok.",
    ],
    doNotAssume: [
      "Jangan mencantumkan angka kinerja atau winrate.",
      'Jangan memakai klaim "akurat", "cocok semua pair", "profit setiap hari".',
      "Ringkasan harus konsisten dengan Bab Cara Kerja EA dan record EA Version.",
    ],
    suggestedBlocks: ["text", "callout"],
    factOwner: "source-of-truth",
  },
  requirements: {
    purpose: "Nyatakan kondisi yang membuat EA gagal jika diabaikan (Bappebti: cara instalasi).",
    belongs: [
      "Platform + build minimum; tipe akun (hedging/netting) beserta status teruji/belum.",
      "Konfigurasi yang didukung — setiap baris symbol × timeframe eksplisit dari EA Version (jangan daftar bebas).",
      "Deposit minimum untuk pengujian (demo); jika ada Tested Minimum Lot, tandai sebagai data uji developer.",
      "Kebutuhan VPS / DLL / WebRequest (Ya/Tidak/Disarankan) dan indikator kustom yang wajib.",
    ],
    doNotAssume: [
      'Jangan menyiratkan "berjalan di pair/akun apa pun" tanpa pengujian.',
      "Jangan mengabaikan masalah suffix broker pada symbol.",
      "Jangan menyajikan Tested Minimum Lot sebagai lot minimum universal yang dikontrol EA.",
    ],
    suggestedBlocks: ["text", "callout", "image"],
    factOwner: "source-of-truth",
  },
  package: {
    purpose: "Daftar tepat file yang diterima pengguna.",
    belongs: [
      "File utama Experts/*.ex5 dan setiap dependency Indicators/*.ex5 (tandai yang wajib).",
      "Setiap preset resmi Presets/*.set dan file dokumen/lisensi bila ada.",
      "Apa yang terjadi jika file pendukung hilang (inisialisasi gagal, smiley merah, baris log tertentu).",
    ],
    doNotAssume: [
      "Jangan mencantumkan file yang tidak benar-benar didistribusikan.",
      "Jangan mereferensikan path build internal.",
    ],
    suggestedBlocks: ["text", "callout"],
    factOwner: "source-of-truth",
  },
  installation: {
    purpose: "Instalasi yang dapat diikuti tanpa menebak — pisahkan alur 'dari Market' dan 'dari luar Market'.",
    belongs: [
      "Langkah berurutan: buka terminal → File > Open Data Folder → MQL5/Experts → salin file → refresh Navigator.",
      "Menyalin indikator/preset ke folder terkait bila ada.",
      "Menyalakan Algo Trading (tombol global) dan Allow Algo Trading pada tab Common.",
      "Arti ikon smiley di sudut chart (hijau/normal vs merah/terblokir).",
      "Screenshot pada langkah yang butuh konteks visual, masing-masing dengan caption deskriptif.",
    ],
    doNotAssume: [
      "Jangan mencampur langkah MT4 dan MT5.",
      "Jangan memberi instruksi menonaktifkan proteksi akun atau menyiasati batas broker.",
    ],
    suggestedBlocks: ["steps", "image", "callout"],
    example: "Contoh langkah: \"Buka File > Open Data Folder, lalu masuk ke MQL5/Experts.\"",
    factOwner: "author",
  },
  "quick-start": {
    purpose: "Pengguna pertama kali melihat EA hidup di akun DEMO dalam ≤ 10 menit.",
    belongs: [
      "Pilih akun demo; buka chart symbol resmi pada timeframe resmi.",
      "Attach EA, muat preset resmi, centang izin trading, tekan OK.",
      "Apa yang harus terlihat: smiley hijau, panel/label, baris log \"initialized\".",
      "Cara menghentikan EA dengan aman (jangan sekadar menutup chart bila ada posisi terbuka).",
    ],
    doNotAssume: [
      "Jangan memulai di akun live.",
      "Jangan menyiratkan profit langsung; jangan melewati prosedur safe-stop.",
    ],
    suggestedBlocks: ["steps", "image", "callout"],
    factOwner: "author",
  },
  "how-it-works": {
    purpose: "Menjelaskan logika dalam bahasa trader lalu istilah teknis (Bappebti: cara kerja).",
    belongs: [
      "Kondisi entry (aturan jika–maka) dan kondisi non-entry (kapan EA sengaja diam).",
      "Manajemen posisi (single, grid spacing, averaging, partial close, trailing) dan kondisi exit.",
      "Filter waktu/berita (nyatakan sebagai waktu server) bila ada.",
      "Perilaku pada kondisi khusus: spread lebar, reconnect/weekend gap, OnInit gagal, dua chart symbol sama, posisi ditutup manual.",
      "Indikator yang dipakai dan perannya sesuai indikator yang dideklarasikan EA Version.",
    ],
    doNotAssume: [
      "Jangan mengarang kondisi entry/exit/filter/risk yang tidak dikonfirmasi dari source-of-truth.",
      'Jangan menyembunyikan mekanisme martingale/grid dalam bahasa samar; jangan menulis "logika ini menjamin menang".',
    ],
    suggestedBlocks: ["text", "callout", "image", "faq"],
    factOwner: "source-of-truth",
  },
  parameters: {
    purpose: "Setiap input EA, dikelompokkan, dengan makna (Bappebti: cara setting).",
    belongs: [
      "Parameter berasal dari EA Version yang terhubung — blok Tabel Parameter mereferensikan grup EA Version, bukan salinan manual terpisah.",
      "Setiap baris: nama terminal, nama teknis, tipe, default, rentang aman, efek pada order, kapan boleh diubah.",
      "Kejelasan unit: points atau pips, dan hubungannya dengan _Point.",
      "Input khusus (Magic Number, Lot mode, SL/TP/Trailing, TP USD/SL USD) beserta efeknya.",
    ],
    doNotAssume: [
      "Jangan membuat daftar parameter manual yang terpisah dari EA Version.",
      "Jangan menyalin deskripsi pemasaran ke kolom efek; default di manual harus sama dengan default kode.",
    ],
    suggestedBlocks: ["parameterTable", "text", "callout"],
    factOwner: "source-of-truth",
  },
  risk: {
    purpose: "Menjelaskan matematika lot secara verbal dan memperingatkan mode berbahaya.",
    belongs: [
      "Rumus lot dalam kata-kata (mis. lot = equity × RiskPercent / 100 ÷ nilai rugi saat SL kena).",
      "Floor lot, step lot, dan perilaku saat lot terhitung di bawah minimum broker.",
      "Perilaku fixed-lot vs compounding; kontrol risiko agregat (SL USD / TP USD).",
      "Jika EA punya martingale / grid tak terbatas / recovery: callout warning menonjol di ATAS bab.",
    ],
    doNotAssume: [
      'Jangan memakai "bebas risiko", "recovery pasti", "grid selalu pulih".',
      "Jangan menyajikan martingale sebagai aman; jangan menghilangkan perilaku di bawah lot minimum.",
    ],
    suggestedBlocks: ["callout", "text"],
    factOwner: "source-of-truth",
  },
  presets: {
    purpose: 'Hanya menerbitkan preset yang teruji dan konfigurasi yang didukung ("preset adalah janji").',
    belongs: [
      "Daftar konfigurasi yang didukung (baris ea_version_setups eksplisit dari EA Version).",
      "Untuk setiap .set resmi: symbol, timeframe, broker uji, rentang tanggal uji, model uji, catatan spread.",
      "Cara memuat preset (tab Inputs → Load).",
    ],
    doNotAssume: [
      'Jangan menyiratkan ekspektasi imbal hasil; jangan menulis "cocok semua timeframe".',
      "Jangan mencantumkan preset yang tidak diuji.",
    ],
    suggestedBlocks: ["text", "parameterTable", "callout"],
    factOwner: "source-of-truth",
  },
  interface: {
    purpose: "Mendokumentasikan panel/tombol on-chart JIKA EA memiliki GUI.",
    belongs: [
      "Screenshot panel yang diberi label.",
      "Setiap tombol/toggle/field: nama, fungsi, dan konfirmasi yang dipicunya.",
      "Read-out dashboard (open PnL, jumlah order, status) dan maknanya.",
      "Hubungan aksi panel dengan input (mis. tombol Close All vs input SL USD).",
    ],
    doNotAssume: [
      "Jika EA tidak memiliki GUI, tandai bab ini Tidak Berlaku — jangan mengarang elemen antarmuka.",
      "Jangan menampilkan nomor akun / saldo / nama broker asli pada screenshot (harus disamarkan).",
    ],
    suggestedBlocks: ["image", "text", "callout"],
    factOwner: "source-of-truth",
  },
  performance: {
    purpose: "Menyajikan informasi pengujian secara jujur, selalu dengan kondisi ujinya.",
    belongs: [
      "Kondisi uji: broker, tipe akun, model spread, model data, rentang tanggal, deposit awal, leverage.",
      "Metrik Perba 12/2022 Pasal 4(3): net profit, growth profit, drawdown — masing-masing dengan konteks ujinya.",
      "Pernyataan tegas bahwa hasil tester/masa lalu BUKAN jaminan hasil masa depan.",
      "Mengapa hasil tester berbeda dari live (spread, slippage, eksekusi).",
    ],
    doNotAssume: [
      'Jangan menampilkan winrate/angka profit tanpa kondisi uji ("data menyesatkan").',
      'Jangan menyajikan kurva ekuitas sebagai kinerja yang diharapkan; jangan menulis "konsisten profit".',
    ],
    suggestedBlocks: ["text", "callout", "image"],
    factOwner: "source-of-truth",
  },
  troubleshooting: {
    purpose: "Menyelesaikan masalah dari gejala yang dilihat pengguna, bukan penyebab internal.",
    belongs: [
      "Gejala → penyebab umum → perbaikan untuk minimal: EA tidak di Navigator; smiley merah/AutoTrading off;",
      "tidak ada order; order duplikat; lot 0/order ditolak; error 130/invalid stops.",
      "Setiap perbaikan memiliki tindakan konkret; referensi log/menu akurat.",
    ],
    doNotAssume: [
      '"Jika rugi itu normal, biarkan jalan" — jangan.',
      "Jangan menyarankan menonaktifkan stop-out atau proteksi broker.",
    ],
    suggestedBlocks: ["faq", "steps", "text", "callout"],
    factOwner: "author",
  },
  faq: {
    purpose: "Menjawab pertanyaan berulang yang memicu tiket dukungan.",
    belongs: [
      "Pertanyaan wajib: banyak pair sekaligus? ubah timeframe saat berjalan? pindah chart?",
      "reboot VPS? update versi tanpa merusak posisi terbuka? akun cent / symbol bersuffix? mengapa tester ≠ live?",
      "Jawaban konsisten dengan Bab Persyaratan, Cara Kerja, Parameter, dan Pemecahan Masalah.",
    ],
    doNotAssume: [
      'Jangan menjawab dengan janji hasil; jangan menulis "ya, bekerja untuk semuanya".',
      'Jangan meninggalkan jawaban "TBD".',
    ],
    suggestedBlocks: ["faq", "text"],
    factOwner: "author",
  },
  changelog: {
    purpose: "Mencatat apa yang berubah per versi (Perba 12/2022 Pasal 8).",
    belongs: [
      "Satu entri per versi dengan jenis: Ditambahkan / Diubah / Diperbaiki / Perubahan besar.",
      "Untuk perubahan besar: dampaknya bagi pengguna dengan posisi terbuka.",
      "Versi EA sumber untuk setiap entri.",
    ],
    doNotAssume: [
      "Jangan menghilangkan perubahan besar secara diam-diam.",
      '"Tidak ada perubahan" padahal input berubah — jangan.',
    ],
    suggestedBlocks: ["text", "callout"],
    example: "Bab ini memakai editor catatan perubahan terstruktur di dalam kanvas — tambahkan satu entri per versi EA.",
    factOwner: "author",
  },
  disclaimer: {
    purpose: "Menyatakan batas tanggung jawab dengan jelas (Perba 12/2022 Pasal 5(5)d).",
    belongs: [
      "Kalimat wajib Pasal 5(5)d di dalam badan disclaimer (bukan catatan kaki): EA adalah alat bantu, tidak menjamin profit, tidak menghilangkan risiko PBK.",
      "Trading forex/CFD berisiko; modal dapat berkurang atau habis; hasil masa lalu bukan jaminan.",
      "Pengguna bertanggung jawab memilih broker, ukuran lot, dan keputusan untuk live.",
      "Referensi proses pernyataan disclosure + video rekaman bersama pialang (Pasal 9) bila dalam lingkup Bappebti.",
    ],
    doNotAssume: [
      'Jangan melunakkan/menghapus kalimat wajib; jangan memakai "risiko rendah", "aman", "modal terlindungi".',
      "Jangan menyembunyikan disclaimer di cetakan kecil.",
    ],
    suggestedBlocks: ["text", "callout"],
    factOwner: "compliance",
  },
  support: {
    purpose: "Memberi pengguna cara nyata untuk mendapatkan bantuan (Perba 12/2022 Pasal 5(4)f).",
    belongs: [
      "Kanal dukungan yang benar-benar beroperasi (email, telepon, WhatsApp) dari record dukungan EA Version.",
      "Jam/ketersediaan dan pernyataan 24/7 bila berlaku.",
      "Apa yang ditangani dukungan vs tidak: masalah teknis vs urusan transaksi/keuangan (ke pialang).",
      "Jalur eskalasi bila VPS/EA berhenti.",
    ],
    doNotAssume: [
      "Jangan mengarang kontak dukungan, jam 24/7, atau kanal yang tidak beroperasi — ini fakta organisasi.",
      "Jangan mengarahkan margin/pembayaran ke kontak developer.",
    ],
    suggestedBlocks: ["text", "callout"],
    factOwner: "organisation",
  },
  transparency: {
    purpose: "Mengungkap algoritma/strategi dan periode efektif tanpa menjanjikan hasil (Pasal 5(4)c, 5(6)).",
    belongs: [
      "Deskripsi bahasa awam tentang algoritma/sistem, konsisten dengan Bab Cara Kerja.",
      "Bahasa perintah/algoritma program (Bahasa Indonesia atau Inggris) — Pasal 5(4)d.",
      "Periode efektif penggunaan EA — Pasal 5(6) poin 5.",
      "Layanan purnajual atas masalah teknis — Pasal 5(6) poin 6.",
      "Bila EA bukan buatan sendiri: identitas developer dan bentuk kerja sama (Pasal 5(4)a, Pasal 6).",
    ],
    doNotAssume: [
      'Jangan memakai bahasa "holy grail proprietary" yang tidak mengungkap apa pun.',
      "Jangan memakai klaim kinerja, framing bagi hasil, atau MLM/referral untuk distribusi EA.",
    ],
    suggestedBlocks: ["text", "callout"],
    factOwner: "compliance",
  },
};

/** Guidance for a canonical chapter, or `null` for a custom chapter. */
export function chapterGuidance(key: string): ChapterGuidance | null {
  const canon = CANONICAL_SECTIONS.find((s) => s.key === key);
  const g = G[key];
  if (!canon || !g) return null;
  return { key, order: canon.order, title: canon.title, required: canon.required, ...g };
}

/** All 18 canonical chapters, ordered — for the Template reference and Panduan pages. */
export function allChapterGuidance(): ChapterGuidance[] {
  return CANONICAL_SECTIONS.map((s) => chapterGuidance(s.key)!).filter(Boolean);
}

export const FACT_OWNER_LABEL: Record<NonNullable<ChapterGuidance["factOwner"]>, string> = {
  author: "Dapat kamu isi",
  "source-of-truth": "Butuh data teknis / source-of-truth",
  organisation: "Butuh data organisasi / Admin",
  compliance: "Butuh data kepatuhan",
};
