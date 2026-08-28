-- Phase 2 · EA build facts: EAProduct -> EAVersion -> {EAVersionSetup, EAParameterGroup -> EAParameter}
-- Ownership: parameters and setups belong to EA VERSION, never to a manual (DATA_MODEL, PRD-CNT-010, GI-11).
--
-- Same-organisation relational integrity is enforced by the DATABASE, not by RLS visibility or
-- server actions: every parent carries `unique (id, organization_id)` and every child FK is
-- COMPOSITE `(<parent>_id, organization_id) -> (id, organization_id)`. A row can therefore never
-- point at a parent in a different organisation even if a caller supplies a crafted parent UUID.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type ea_platform as enum ('MT4', 'MT5');

create type mt_timeframe as enum ('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1');

create type ea_param_type as enum ('bool', 'int', 'double', 'string', 'enum', 'color');

create type ea_param_mutability as enum ('before_start', 'may_change_live', 'needs_reattach');

-- ---------------------------------------------------------------------------
-- ea_products
-- ---------------------------------------------------------------------------
create table ea_products (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  owner_id        uuid references profiles (id) on delete set null,
  name            text not null check (length(btrim(name)) between 2 and 160),
  slug            text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description     text not null default '',
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, slug),
  unique (id, organization_id)          -- composite-FK target
);
create index ea_products_org_idx on ea_products (organization_id) where archived_at is null;
create trigger ea_products_touch before update on ea_products
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- ea_versions   (version unique per product + platform)
-- ---------------------------------------------------------------------------
create table ea_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  ea_product_id   uuid not null,
  version         text not null check (version ~ '^\d+\.\d+\.\d+$'),
  platform        ea_platform not null,
  release_date    date,
  -- account type, testing deposit, broker reqs, VPS/DLL/WebRequest, indicator deps,
  -- optional broker/account volume constraints. NO free-text symbols/timeframes/min-lot here.
  requirements    jsonb not null default '{}'::jsonb,
  support         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (ea_product_id, platform, version),
  unique (id, organization_id),
  foreign key (ea_product_id, organization_id)
    references ea_products (id, organization_id) on delete cascade
);
create index ea_versions_product_idx on ea_versions (ea_product_id);
create trigger ea_versions_touch before update on ea_versions
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- ea_version_setups   (explicit symbol x timeframe rows; no inference — GI-10)
-- ---------------------------------------------------------------------------
create table ea_version_setups (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  ea_version_id      uuid not null,
  symbol             text not null check (symbol ~ '^[A-Za-z0-9]{2,}([._][A-Za-z0-9]+)?$'),
  timeframe          mt_timeframe not null,
  preset_ref         text,
  tested_minimum_lot numeric(12,4) check (tested_minimum_lot is null or tested_minimum_lot >= 0),
  notes              text,
  is_supported       boolean not null default true,
  position           integer not null default 0 check (position >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (ea_version_id, symbol, timeframe),
  foreign key (ea_version_id, organization_id)
    references ea_versions (id, organization_id) on delete cascade
);
create index ea_version_setups_version_pos_idx on ea_version_setups (ea_version_id, position);
create trigger ea_version_setups_touch before update on ea_version_setups
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- parameter_groups   (owned by EA VERSION)
-- ---------------------------------------------------------------------------
create table parameter_groups (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  ea_version_id   uuid not null,
  name            text not null check (length(btrim(name)) between 1 and 120),
  position        integer not null default 0 check (position >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (ea_version_id, name),
  unique (id, organization_id),
  foreign key (ea_version_id, organization_id)
    references ea_versions (id, organization_id) on delete cascade
);
create index parameter_groups_version_pos_idx on parameter_groups (ea_version_id, position);
create trigger parameter_groups_touch before update on parameter_groups
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- ea_parameters   (owned by EA VERSION via parameter_groups)
-- ---------------------------------------------------------------------------
create table ea_parameters (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  parameter_group_id uuid not null,
  display_name       text not null check (length(btrim(display_name)) between 1 and 160),
  technical_name     text not null check (technical_name ~ '^[A-Za-z_][A-Za-z0-9_]*$'),
  param_type         ea_param_type not null,
  default_value      text,
  unit               text,
  min_value          text,
  max_value          text,
  enum_options       text[] not null default '{}',
  safe_range         text,
  description        text,
  order_effect       text,
  mutability         ea_param_mutability not null default 'before_start',
  notes              text,
  required           boolean not null default false,
  position           integer not null default 0 check (position >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (parameter_group_id, technical_name),
  foreign key (parameter_group_id, organization_id)
    references parameter_groups (id, organization_id) on delete cascade
);
create index ea_parameters_group_pos_idx on ea_parameters (parameter_group_id, position);
create trigger ea_parameters_touch before update on ea_parameters
  for each row execute function app.touch_updated_at();
