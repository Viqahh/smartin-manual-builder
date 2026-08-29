-- Phase 5 · Versioned checklist template + persisted results (PRD-VAL-002, PRD-COMP-006,
-- PRD-VER-008, AC-P5-2/11).
--
-- Three tables:
--   checklist_templates  — system-owned (organization_id NULL), versioned, one active row.
--   checklist_items      — the items of a template version; stable check_key + rule metadata.
--   checklist_results    — exactly one row per (manual_version, check_key); state + evidence +
--                          evaluator + evaluated timestamp; optional reviewer N/A override.
--
-- Authorization: SELECT for any org member (results) / any authenticated user (system template
-- + items, like manual_templates). Results are SERVER-OWNED — there is NO client INSERT/UPDATE/
-- DELETE policy; the Phase 5 server actions write via the service-role client after enforcing
-- role + org + reason. This makes "developer forges PASS / score / N/A" impossible without an
-- RPC. The checklist engine NEVER records regulatory approval — states are exactly
-- PASS / WARNING / MISSING / NOT_APPLICABLE (COMPLIANCE_REQUIREMENTS.md §10).
--
-- Data API note: "expose new tables" = OFF, so explicit grants are required.

-- ---------------------------------------------------------------------------
-- checklist_templates
-- ---------------------------------------------------------------------------
create table checklist_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references organizations (id) on delete cascade,  -- NULL = system
  key              text not null,
  version          integer not null check (version >= 1),
  title            text not null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, key, version)
);
create trigger checklist_templates_touch before update on checklist_templates
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- checklist_items  (the items of one template version)
-- ---------------------------------------------------------------------------
create table checklist_items (
  id                     uuid primary key default gen_random_uuid(),
  checklist_template_id  uuid not null references checklist_templates (id) on delete cascade,
  check_key              text not null,
  label                  text not null,
  category               text not null,
  description            text not null default '',
  required               boolean not null default true,
  rule_key               text not null,       -- evaluator dispatch key (== check_key for v1)
  bappebti_only          boolean not null default false,  -- OQ-011 suppression set
  publish_blocking       boolean not null default false,  -- Phase 6 uses this; Phase 5 records it
  position               integer not null default 0,
  created_at             timestamptz not null default now(),
  unique (checklist_template_id, check_key)
);

-- ---------------------------------------------------------------------------
-- checklist_results  (one per manual_version + check_key)
-- ---------------------------------------------------------------------------
create table checklist_results (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references organizations (id) on delete cascade,
  manual_version_id           uuid not null,
  checklist_template_id       uuid not null references checklist_templates (id),
  checklist_template_version  integer not null,
  check_key                   text not null,
  category                    text not null,
  required                    boolean not null default true,
  state                       text not null check (state in ('PASS','WARNING','MISSING','NOT_APPLICABLE')),
  evidence                    jsonb not null default '{}'::jsonb,
  evaluator                   text not null default 'system' check (evaluator in ('system','reviewer')),
  evaluated_at                timestamptz not null default now(),
  -- reviewer manual N/A override provenance (NULL for an automated result)
  override_actor_id           uuid references profiles (id) on delete set null,
  override_reason             text,
  override_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  foreign key (manual_version_id, organization_id)
    references manual_versions (id, organization_id) on delete cascade,
  foreign key (checklist_template_id, check_key)
    references checklist_items (checklist_template_id, check_key),
  -- AC-P5-2: exactly one result per item per manual version
  unique (manual_version_id, check_key)
);
create index checklist_results_mv_idx on checklist_results (manual_version_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table checklist_templates enable row level security;
alter table checklist_items     enable row level security;
alter table checklist_results   enable row level security;

-- Templates + items: readable by every authenticated user (system rows, org NULL) or by org
-- members (future org templates). NO client write — installed by migration / service role.
create policy checklist_templates_select on checklist_templates
  for select to authenticated
  using (organization_id is null or organization_id in (select app.member_org_ids()));

create policy checklist_items_select on checklist_items
  for select to authenticated
  using (
    exists (
      select 1 from checklist_templates ct
      where ct.id = checklist_items.checklist_template_id
        and (ct.organization_id is null or ct.organization_id in (select app.member_org_ids()))
    )
  );

-- Results: any org member reads; NO client write policy (server-owned via service role).
create policy checklist_results_select_members on checklist_results
  for select to authenticated
  using (organization_id in (select app.member_org_ids()));

-- ---------------------------------------------------------------------------
-- Data API grants (RLS still decides the effective operation)
-- ---------------------------------------------------------------------------
grant select on table public.checklist_templates to authenticated;
grant select on table public.checklist_items     to authenticated;
grant select on table public.checklist_results   to authenticated;

grant select, insert, update, delete on table public.checklist_templates to service_role;
grant select, insert, update, delete on table public.checklist_items     to service_role;
grant select, insert, update, delete on table public.checklist_results   to service_role;

-- ---------------------------------------------------------------------------
-- Seed: Smartin Documentation Checklist v1  (idempotent)
-- ---------------------------------------------------------------------------
insert into checklist_templates (id, organization_id, key, version, title, is_active)
values ('c5000000-0000-4000-8000-000000000001'::uuid, null,
        'smartin-documentation-checklist', 1, 'Smartin Documentation Checklist v1', true)
on conflict (organization_id, key, version) do nothing;

insert into checklist_items
  (checklist_template_id, check_key, label, category, description, required, rule_key, bappebti_only, publish_blocking, position)
values
  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-REQUIRED-CHAPTER',
   'Bab wajib tersedia dan berisi', 'structure',
   'Setiap bab wajib (instalasi, cara kerja, parameter, risiko, backtest, catatan perubahan; plus dukungan & disclaimer untuk lingkup Bappebti) ada dan memiliki isi.',
   true, 'CHK-REQUIRED-CHAPTER', false, true, 0),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-PARAM-COMPLETE',
   'Semua input EA terdokumentasi', 'parameters',
   'Setiap parameter EA versi ini muncul melalui tabel parameter (parameterTable) yang mereferensikan grup milik EA Version.',
   true, 'CHK-PARAM-COMPLETE', false, true, 1),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-PARAM-DEFAULT-MATCH',
   'Nilai default sesuai definisi EA', 'parameters',
   'Nilai default yang ditulis di manual sama dengan definisi EA Version. Tabel parameter by-reference selalu menampilkan default EA; klaim default manual yang berbeda ditandai.',
   true, 'CHK-PARAM-DEFAULT-MATCH', false, false, 2),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-DISCLAIMER-5-5-D',
   'Kalimat disclaimer Pasal 5(5)d', 'risk',
   'Bab Pernyataan Risiko memuat makna: EA adalah alat bantu otomatis, tidak menjamin profit, dan tidak menghilangkan risiko PBK.',
   true, 'CHK-DISCLAIMER-5-5-D', true, true, 3),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-KONTAK',
   'Kontak dukungan & pernyataan 24/7', 'support',
   'Ada minimal satu kanal kontak nyata (cocok dengan data EA Version) dan pernyataan ketersediaan 24/7 pada bab Dukungan.',
   true, 'CHK-KONTAK', true, true, 4),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-UNITS-DEFINED',
   'Satuan poin/pip didefinisikan', 'parameters',
   'Bila manual memakai istilah "point"/"pip"/"poin", harus ada definisi (mis. mengacu _Point atau menjelaskan 1 pip = ... poin).',
   true, 'CHK-UNITS-DEFINED', false, false, 5),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-VERSI-MATCH',
   'Versi EA & versi manual konsisten', 'identity',
   'Manual Version mereferensikan tepat satu EA Version yang ada; tidak ada penyebutan versi EA lain yang bertentangan di dalam teks.',
   true, 'CHK-VERSI-MATCH', false, true, 6),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-PERFORMANCE-KONDISI',
   'Angka kinerja disertai kondisi uji', 'performance',
   'Bila bab Informasi Backtest menampilkan angka kinerja (win rate, drawdown, return, net profit), harus disertai kondisi uji (broker, spread, model, rentang tanggal, deposit).',
   true, 'CHK-PERFORMANCE-KONDISI', false, false, 7),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-DANGER-MODE-WARN',
   'Peringatan mode berisiko tinggi', 'risk',
   'Bila EA Version menyatakan mode berisiko (martingale / grid tak terbatas / recovery), bab Risiko diawali callout peringatan.',
   true, 'CHK-DANGER-MODE-WARN', false, true, 8),

  ('c5000000-0000-4000-8000-000000000001'::uuid, 'CHK-NO-PROHIBITED-CLAIMS',
   'Tidak ada klaim terlarang', 'claims',
   'Pemindaian klaim deterministik (Phase 4) tidak menemukan frasa terlarang §4. Temuan bersifat advisori; kategori pemblokir publikasi ditandai.',
   true, 'CHK-NO-PROHIBITED-CLAIMS', false, true, 9)
on conflict (checklist_template_id, check_key) do nothing;
