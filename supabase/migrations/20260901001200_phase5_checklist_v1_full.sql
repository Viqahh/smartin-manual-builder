-- Phase 5 · Checklist completeness correction (PRD-OQ-004 final decision).
--
-- 20260901001100 seeded a temporary 10-item subset of the checklist. The product-owner decision
-- is that checklist template v1 SHALL carry ALL 31 items from docs/COMPLIANCE_REQUIREMENTS.md §12,
-- with the documented check ids. This migration upgrades the ACTIVE v1 catalog in place:
--
--   * removes CHK-REQUIRED-CHAPTER (an umbrella key that is not one of the 31 — chapter presence
--     is now enforced per-chapter by CHK-INSTALASI / CHK-CARA-KERJA / CHK-SETTING / … ),
--   * upserts the full 31-item set (positions 0..30) with `on conflict do update`, so the 9
--     retained items are re-pointed to the final order/metadata and the migration is fully
--     idempotent / safe to re-run.
--
-- 20260901001100 is already deployed — it is NOT edited. Template identity + version stay
-- (key = smartin-documentation-checklist, version = 1). No historical result rewrite: DEV/prod
-- currently hold zero checklist_results for this template.

-- ---------------------------------------------------------------------------
-- 1. drop the umbrella item (and any stray result rows referencing it)
-- ---------------------------------------------------------------------------
delete from checklist_results
where checklist_template_id = 'c5000000-0000-4000-8000-000000000001'::uuid
  and check_key = 'CHK-REQUIRED-CHAPTER';

delete from checklist_items
where checklist_template_id = 'c5000000-0000-4000-8000-000000000001'::uuid
  and check_key = 'CHK-REQUIRED-CHAPTER';

-- ---------------------------------------------------------------------------
-- 2. the final 31-item catalog for v1 (idempotent upsert)
--    rule_key == check_key for every v1 item (evaluator dispatch key).
-- ---------------------------------------------------------------------------
insert into checklist_items
  (checklist_template_id, check_key, label, category, description, required, rule_key, bappebti_only, publish_blocking, position)
values
  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-VERSI-DUA',
   'Versi EA & versi manual ditampilkan terpisah', 'identity',
   'Bab Sampul menampilkan versi EA dan versi Manual sebagai dua nilai yang berbeda, plus pernyataan "berlaku untuk versi X.Y.Z".',
   true, 'CHK-VERSI-DUA', false, true, 0),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-VERSI-MATCH',
   'Versi EA & versi manual konsisten', 'identity',
   'Manual Version mereferensikan tepat satu EA Version yang ada; tidak ada penyebutan versi EA lain yang bertentangan di dalam teks.',
   true, 'CHK-VERSI-MATCH', false, true, 1),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-DEV-LEGAL',
   'Identitas pengembang & organisasi', 'identity',
   'Bab Sampul/Transparansi menyebut organisasi (PT Smartin Advisor Sistem) dan — bila EA bukan buatan sendiri — identitas pengembang pihak ketiga serta catatan kerja sama (Pasal 5(4)a, Pasal 6).',
   true, 'CHK-DEV-LEGAL', false, true, 2),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-INSTALASI',
   'Langkah instalasi lengkap', 'installation',
   'Bab Instalasi memuat blok langkah dengan minimal 5 langkah berurutan (File > Open Data Folder, MQL5/Experts, Refresh Navigator, restart) beserta jalur menu.',
   true, 'CHK-INSTALASI', false, true, 3),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-INSTALL-AUTOTRADING',
   'Instruksi Algo Trading / Allow Algo Trading', 'installation',
   'Bab Instalasi menjelaskan tombol Algo Trading global dan centang Allow Algo Trading pada tab Common, serta arti ikon smiley.',
   true, 'CHK-INSTALL-AUTOTRADING', false, false, 4),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-DEPENDENCIES-LISTED',
   'Ketergantungan file didaftarkan', 'installation',
   'Bila EA Version menyatakan custom indicator / DLL / WebRequest, bab Instalasi atau Isi Paket mendaftarkannya dan menjelaskan akibat bila file hilang.',
   true, 'CHK-DEPENDENCIES-LISTED', false, false, 5),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-PACKAGE-FILES',
   'Isi paket dijelaskan', 'installation',
   'Bila ada file selain EA (indicator, preset, lisensi, dokumen), bab Isi Paket mendaftarkannya. Item ini tidak wajib.',
   false, 'CHK-PACKAGE-FILES', false, false, 6),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-CARA-KERJA',
   'Cara kerja EA dijelaskan', 'how-it-works',
   'Bab Cara Kerja EA menjelaskan kondisi masuk, kondisi tidak masuk, manajemen posisi, dan kondisi keluar dengan bahasa yang substansial (Pasal 4(3) huruf n / 5(4) huruf b).',
   true, 'CHK-CARA-KERJA', false, true, 7),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-SPECIAL-CONDITIONS',
   'Perilaku kondisi khusus', 'how-it-works',
   'Bab Cara Kerja menjawab kondisi khusus: spread lebar, reconnect / gap akhir pekan, OnInit gagal, dua chart simbol sama, posisi ditutup manual.',
   true, 'CHK-SPECIAL-CONDITIONS', false, false, 8),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-SETTING',
   'Cara setting terdokumentasi', 'how-it-works',
   'Bab Referensi Input / Parameter berisi dokumentasi setelan yang mereferensikan definisi parameter milik EA Version (blok parameterTable) atau uraian setelan yang substansial (Pasal 4(3) huruf n).',
   true, 'CHK-SETTING', false, true, 9),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-PARAM-COMPLETE',
   'Semua input EA terdokumentasi', 'how-it-works',
   'Setiap grup parameter EA versi ini muncul melalui tabel parameter (parameterTable) yang mereferensikan grup milik EA Version.',
   true, 'CHK-PARAM-COMPLETE', false, true, 10),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-PARAM-DEFAULT-MATCH',
   'Nilai default sesuai definisi EA', 'how-it-works',
   'Nilai default yang ditulis di prosa manual tidak bertentangan dengan definisi EA Version. Tabel parameter by-reference selalu menampilkan default EA.',
   true, 'CHK-PARAM-DEFAULT-MATCH', false, false, 11),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-UNITS-DEFINED',
   'Satuan poin/pip didefinisikan', 'how-it-works',
   'Bila manual memakai istilah point/pip/poin, harus ada definisi (mis. mengacu _Point atau menjelaskan 1 pip = ... poin).',
   true, 'CHK-UNITS-DEFINED', false, false, 12),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-QUICKSTART-DEMO',
   'Panduan mulai cepat berbasis demo', 'how-it-works',
   'Bab Mulai Cepat menegaskan penggunaan akun demo lebih dulu (bukan akun riil) dan menyebut simbol/timeframe resmi.',
   true, 'CHK-QUICKSTART-DEMO', false, false, 13),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-SAFE-STOP',
   'Cara menghentikan EA dengan aman', 'how-it-works',
   'Bab Mulai Cepat / Cara Kerja menjelaskan cara menghentikan EA dengan aman (jangan sekadar menutup chart bila ada posisi terbuka).',
   true, 'CHK-SAFE-STOP', false, false, 14),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-DISCLAIMER-5-5-D',
   'Kalimat disclaimer Pasal 5(5)d', 'risk',
   'Bab Pernyataan Risiko memuat makna: EA adalah sistem otomatis yang hanya alat bantu, tidak menjamin profit, dan tidak menghilangkan risiko PBK.',
   true, 'CHK-DISCLAIMER-5-5-D', true, true, 15),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-RISK-GENERAL',
   'Pernyataan risiko umum trading', 'risk',
   'Bab Risiko / Pernyataan Risiko menyatakan bahwa trading forex/CFD berisiko dan modal dapat berkurang atau hilang.',
   true, 'CHK-RISK-GENERAL', false, true, 16),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-PAST-NOT-FUTURE',
   'Kinerja masa lalu bukan jaminan', 'risk',
   'Manual menyatakan hasil tester / masa lalu tidak menjamin hasil di masa depan (bab Informasi Backtest atau Pernyataan Risiko).',
   true, 'CHK-PAST-NOT-FUTURE', false, true, 17),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-DANGER-MODE-WARN',
   'Peringatan mode berisiko tinggi', 'risk',
   'Bila EA Version menyatakan mode berisiko (martingale / grid tak terbatas / recovery), bab Risiko diawali callout peringatan.',
   true, 'CHK-DANGER-MODE-WARN', false, true, 18),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-NO-PROHIBITED-CLAIMS',
   'Tidak ada klaim terlarang', 'risk',
   'Pemindaian klaim deterministik (Phase 4) tidak menemukan frasa terlarang §4. Temuan bersifat advisori; kategori pemblokir publikasi ditandai.',
   true, 'CHK-NO-PROHIBITED-CLAIMS', false, true, 19),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-KONTAK',
   'Kontak dukungan & pernyataan 24/7', 'support',
   'Ada minimal satu kanal kontak nyata (cocok dengan data EA Version) dan pernyataan ketersediaan 24/7 pada bab Dukungan (kewajiban 24/7 = lingkup Bappebti).',
   true, 'CHK-KONTAK', true, true, 20),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-KONTAK-SPLIT',
   'Pembagian tanggung jawab teknis vs transaksi', 'support',
   'Bab Dukungan menyatakan pembagian: masalah teknis ke Smartin; masalah transaksi/finansial ke pialang berjangka.',
   true, 'CHK-KONTAK-SPLIT', false, false, 21),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-TRANSPARANSI',
   'Deskripsi algoritma / strategi', 'support',
   'Bab Transparansi Strategi memuat uraian bahasa sederhana tentang algoritma / sistem trading, konsisten dengan bab Cara Kerja (Pasal 5(4)c).',
   true, 'CHK-TRANSPARANSI', true, false, 22),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-BAHASA-ALGO',
   'Pernyataan bahasa algoritma', 'support',
   'Bab Transparansi menyatakan bahwa algoritma / instruksi program ditulis dalam Bahasa Indonesia atau Bahasa Inggris (Pasal 5(4)d).',
   true, 'CHK-BAHASA-ALGO', true, false, 23),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-PERIODE-EFEKTIF',
   'Periode efektif penggunaan EA', 'support',
   'Bab Transparansi menyatakan periode efektif penggunaan EA (Pasal 5(6) poin 5).',
   true, 'CHK-PERIODE-EFEKTIF', true, false, 24),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-PERFORMANCE-KONDISI',
   'Angka kinerja disertai kondisi uji', 'performance',
   'Bila bab Informasi Backtest menampilkan angka kinerja (win rate, drawdown, return, net profit), harus disertai kondisi uji (broker, spread, model, rentang tanggal, deposit).',
   true, 'CHK-PERFORMANCE-KONDISI', false, false, 25),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-CHANGELOG-VERSI',
   'Entri changelog untuk versi EA saat ini', 'identity',
   'Bab Catatan Perubahan memuat entri untuk versi EA yang ditautkan; entri breaking menyatakan dampak pada posisi terbuka (Pasal 8).',
   true, 'CHK-CHANGELOG-VERSI', false, false, 26),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-DISCLOSURE-REF',
   'Rujukan disclosure statement Pasal 9', 'bappebti',
   'Manual merujuk proses disclosure statement + rekaman video dengan pialang sebelum EA dijalankan di akun berjangka Indonesia (Pasal 9). Alat tidak membuat formulirnya.',
   true, 'CHK-DISCLOSURE-REF', true, true, 27),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-ONBOARDING-MARGIN',
   'Ekspektasi margin onboarding', 'bappebti',
   'Manual menyebut ekspektasi kemampuan margin minimum (paling sedikit Rp50.000.000) dan pemahaman risiko PBK/EA untuk lingkup Bappebti (Pasal 5(7)).',
   true, 'CHK-ONBOARDING-MARGIN', true, false, 28),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-FITUR-DIJELASKAN',
   'Fitur terverifikasi dijelaskan', 'how-it-works',
   'Bila EA Version menyatakan daftar fitur terverifikasi, setiap fitur memiliki instruksi penggunaan di manual; manual tidak mendokumentasikan fitur yang tidak dimiliki build terverifikasi.',
   true, 'CHK-FITUR-DIJELASKAN', false, false, 29),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-INTERFACE',
   'Antarmuka EA terdokumentasi', 'how-it-works',
   'Bila EA Version menyatakan ada GUI/panel, bab Antarmuka EA memuat minimal satu gambar panel beranotasi dan daftar kontrol. Bila tidak ada GUI: NOT_APPLICABLE.',
   true, 'CHK-INTERFACE', false, false, 30)
on conflict (checklist_template_id, check_key) do update set
  label            = excluded.label,
  category         = excluded.category,
  description      = excluded.description,
  required         = excluded.required,
  rule_key         = excluded.rule_key,
  bappebti_only    = excluded.bappebti_only,
  publish_blocking = excluded.publish_blocking,
  position         = excluded.position;

-- keep the template's updated_at honest
update checklist_templates
set updated_at = now()
where id = 'c5000000-0000-4000-8000-000000000001'::uuid;
