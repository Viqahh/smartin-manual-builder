-- Phase 2 · Canonical system manual template + its versioned sections (AC-P2-10/26).
--
-- This is STRUCTURAL data (not demo seed): every project gets the standard Smartin
-- EA Manual Book template. Manual creation resolves this active template, records
-- `manual_versions.template_id` + `template_version`, and instantiates sections from
-- `manual_template_sections` for that exact version. Mirrors lib/domain/canonical-sections.ts.

insert into manual_templates (id, organization_id, key, version, title, is_active)
values ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, null, 'smartin-ea-manual', 1,
        'Template Manual EA Standar Smartin', true)
on conflict (organization_id, key, version) do nothing;

insert into manual_template_sections (template_id, section_key, title, required, position)
values
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'cover',           'Sampul & Identitas Produk',   true,  0),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'overview',        'Ringkasan Produk',            true,  1),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'requirements',    'Persyaratan Sistem & Broker', true,  2),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'package',         'Isi Paket',                   false, 3),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'installation',    'Instalasi',                   true,  4),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'quick-start',     'Mulai Cepat',                 true,  5),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'how-it-works',    'Cara Kerja EA',               true,  6),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'parameters',      'Referensi Input / Parameter', true,  7),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'risk',            'Risiko & Manajemen Dana',     true,  8),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'presets',         'Preset, Pair & Timeframe',    true,  9),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'interface',       'Antarmuka EA',                false, 10),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'performance',     'Informasi Backtest',          true,  11),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'troubleshooting', 'Pemecahan Masalah',           true,  12),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'faq',             'Pertanyaan Umum',             false, 13),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'changelog',       'Catatan Perubahan',           true,  14),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'disclaimer',      'Pernyataan Risiko',           false, 15),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'support',         'Dukungan',                    false, 16),
  ('a1a1a1a1-1111-4111-8111-000000000001'::uuid, 'transparency',    'Transparansi Strategi',       false, 17)
on conflict (template_id, section_key) do nothing;
