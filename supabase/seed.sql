-- Phase 2 · Demo seed data. Clearly labelled SAMPLE / DEMO (spec §28).
-- No performance, win-rate, drawdown, guaranteed-return, or regulatory-approval claims.
--
-- Runs after migrations on `supabase db reset` (local). For a hosted project, create the
-- auth users via the Auth API / dashboard first, then run the non-auth portion — see docs/PHASE_2.md.

-- ---------------------------------------------------------------------------
-- Demo auth users (LOCAL ONLY). Password for all: "demo-password-123"
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'developer@smartin.demo',  crypt('demo-password-123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Andi Setiawan (DEMO)"}', now(), now()),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@smartin.demo',      crypt('demo-password-123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Sri Admin (DEMO)"}', now(), now()),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reviewer@smartin.demo',   crypt('demo-password-123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Rina Reviewer (DEMO)"}', now(), now()),
  ('44444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@smartin.demo',   crypt('demo-password-123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Budi Outsider (DEMO)"}', now(), now()),
  ('55555555-5555-4555-8555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'compliance@smartin.demo', crypt('demo-password-123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Citra Compliance (DEMO)"}', now(), now())
on conflict (id) do nothing;

-- profiles are normally created by the on_auth_user_created trigger; ensure they exist for idempotent re-seeds
insert into public.profiles (id, email, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'developer@smartin.demo',  'Andi Setiawan (DEMO)'),
  ('22222222-2222-4222-8222-222222222222', 'admin@smartin.demo',      'Sri Admin (DEMO)'),
  ('33333333-3333-4333-8333-333333333333', 'reviewer@smartin.demo',   'Rina Reviewer (DEMO)'),
  ('44444444-4444-4444-8444-444444444444', 'outsider@smartin.demo',   'Budi Outsider (DEMO)'),
  ('55555555-5555-4555-8555-555555555555', 'compliance@smartin.demo', 'Citra Compliance (DEMO)')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Two organisations for cross-org isolation checks (spec §27)
-- ---------------------------------------------------------------------------
insert into organizations (id, name, slug) values
  ('a0000000-0000-4000-8000-00000000000a', 'PT Smartin Advisor Sistem (DEMO)', 'smartin-demo'),
  ('b0000000-0000-4000-8000-00000000000b', 'Organisasi Lain (DEMO)',           'org-lain-demo')
on conflict (id) do nothing;

-- One row per (org, user, role) — multi-role model (PRD §6).
-- `developer@` holds BOTH DEVELOPER and TECHNICAL_REVIEWER in org A: a live multi-role fixture
-- proving roles aggregate, authoring capability is retained, and ADMIN capability is NOT gained.
insert into memberships (organization_id, user_id, role) values
  ('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'DEVELOPER'),
  ('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'TECHNICAL_REVIEWER'),
  ('a0000000-0000-4000-8000-00000000000a', '22222222-2222-4222-8222-222222222222', 'ADMIN'),
  ('a0000000-0000-4000-8000-00000000000a', '33333333-3333-4333-8333-333333333333', 'TECHNICAL_REVIEWER'),
  ('a0000000-0000-4000-8000-00000000000a', '55555555-5555-4555-8555-555555555555', 'COMPLIANCE_REVIEWER'),
  ('b0000000-0000-4000-8000-00000000000b', '44444444-4444-4444-8444-444444444444', 'ADMIN')
on conflict (organization_id, user_id, role) do nothing;

-- The canonical system manual template + its 18 sections are installed by
-- 20260901000350_system_template.sql (structural, not demo seed).

-- ---------------------------------------------------------------------------
-- VMax EA — SAMPLE / DEMO
-- ---------------------------------------------------------------------------
insert into ea_products (id, organization_id, owner_id, name, slug, description)
values (
  'd0000000-0000-4000-8000-00000000000d',
  'a0000000-0000-4000-8000-00000000000a',
  '11111111-1111-4111-8111-111111111111',
  'VMax EA (DEMO)',
  'vmax-ea',
  'SAMPLE / DEMO — Expert Advisor contoh untuk menunjukkan struktur dokumentasi.'
) on conflict do nothing;

insert into ea_versions (id, organization_id, ea_product_id, version, platform, release_date, requirements, support)
values (
  'e0000000-0000-4000-8000-00000000000e',
  'a0000000-0000-4000-8000-00000000000a',
  'd0000000-0000-4000-8000-00000000000d',
  '1.0.0', 'MT5', '2026-08-28',
  '{"accountType":"Standard / ECN","testingDeposit":"USD 1.000 (demo)","brokerRequirements":"Mendukung MetaTrader 5 dan simbol XAUUSD.","vps":"Disarankan","dll":false,"webRequest":false,"customIndicators":[],"note":"SAMPLE / DEMO"}'::jsonb,
  '{"email":"support@smartin.demo","phone":"+62 21 555 0199","whatsapp":"+62 812 3456 7890","hours":"Senin-Jumat, 09.00-17.00 WIB"}'::jsonb
) on conflict do nothing;

-- Explicit supported configurations (no inference — GI-10)
insert into ea_version_setups (organization_id, ea_version_id, symbol, timeframe, preset_ref, tested_minimum_lot, notes, is_supported, position)
values
  ('a0000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-00000000000e', 'XAUUSD', 'M15', 'XAUUSD_M15.set', 0.01, 'DEMO — data uji developer, bukan minimum broker.', true, 0),
  ('a0000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-00000000000e', 'XAUUSD', 'H1',  'XAUUSD_H1.set',  0.01, 'DEMO — data uji developer.', true, 1)
on conflict (ea_version_id, symbol, timeframe) do nothing;

-- Parameter groups + parameters (owned by the EA version — GI-11)
insert into parameter_groups (id, organization_id, ea_version_id, name, position)
values ('f0000000-0000-4000-8000-00000000000f', 'a0000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-00000000000e', 'Trading', 0)
on conflict do nothing;

insert into ea_parameters (organization_id, parameter_group_id, display_name, technical_name, param_type, default_value, safe_range, description, order_effect, mutability, required, position)
values
  ('a0000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-00000000000f', 'Fixed Lot',      'FixedLot',    'double',  '0.01', '0.01-1.00 lot',  'DEMO — ukuran transaksi tetap.',           'Menentukan volume tiap order.',               'before_start', true,  0),
  ('a0000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-00000000000f', 'Maximum Orders', 'MaxOrder',    'int',     '5',    '1-10 order',     'DEMO — batas posisi aktif bersamaan.',      'Membatasi jumlah order terbuka.',             'before_start', false, 1),
  ('a0000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-00000000000f', 'Magic Number',   'MagicNumber', 'int',     '40021','Unik per chart', 'DEMO — pengelompokan order EA.',            'Membedakan order EA ini dari EA lain.',        'before_start', true,  2)
on conflict (parameter_group_id, technical_name) do nothing;

-- Manual + first Manual Version + canonical sections (from the system template, version 1).
insert into manuals (id, organization_id, ea_product_id, template_id, locale)
values ('10000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000d',
        'a1a1a1a1-1111-4111-8111-000000000001', 'id')
on conflict do nothing;

insert into manual_versions (id, organization_id, manual_id, ea_version_id, version, status, template_id, template_version)
values ('20000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-00000000000e', '1.0.0', 'DRAFT',
        'a1a1a1a1-1111-4111-8111-000000000001', 1)
on conflict do nothing;

select app.instantiate_sections_from_template(
  '20000000-0000-4000-8000-000000000020', 'a1a1a1a1-1111-4111-8111-000000000001'
);
