-- Phase 2 · Manual content: templates, Manual -> ManualVersion -> ManualSection -> ManualBlock,
-- plus image_assets. A ManualVersion references exactly one EAVersion (DATA_MODEL, PRD-CNT-010).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type manual_status as enum (
  'DRAFT', 'TECHNICAL_REVIEW', 'COMPLIANCE_REVIEW', 'CHANGES_REQUESTED',
  'APPROVED', 'PUBLISHED', 'ARCHIVED'
);

create type manual_block_type as enum ('text', 'steps', 'image', 'callout', 'parameterTable', 'faq');

create type image_scan_status as enum ('pending', 'clean', 'failed', 'skipped');

create type section_completion_state as enum ('incomplete', 'in_progress', 'complete', 'issue');

-- ---------------------------------------------------------------------------
-- Versioned manual templates (AC-P2-26). NULL organization_id = system template.
-- ---------------------------------------------------------------------------
create table manual_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations (id) on delete cascade,
  key             text not null,
  version         integer not null default 1 check (version >= 1),
  title           text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, key, version)
);

create table manual_template_sections (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references manual_templates (id) on delete cascade,
  section_key  text not null,
  title        text not null,
  required     boolean not null default false,
  position     integer not null check (position >= 0),
  unique (template_id, section_key),
  unique (template_id, position)
);

-- ---------------------------------------------------------------------------
-- image_assets   (private storage; metadata mirrored here)
-- ---------------------------------------------------------------------------
create table image_assets (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  owner_id        uuid references profiles (id) on delete set null,
  storage_key     text not null unique,
  mime_type       text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  byte_size       bigint not null check (byte_size > 0 and byte_size <= 10485760),
  width           integer,
  height          integer,
  caption         text,
  alt_text        text,
  annotations     jsonb not null default '{}'::jsonb,
  scan_status     image_scan_status not null default 'pending',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index image_assets_org_idx on image_assets (organization_id);
create trigger image_assets_touch before update on image_assets
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- manuals
-- ---------------------------------------------------------------------------
create table manuals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  ea_product_id   uuid not null references ea_products (id) on delete cascade,
  template_id     uuid references manual_templates (id) on delete set null,
  locale          text not null default 'id',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index manuals_org_idx on manuals (organization_id);
create index manuals_product_idx on manuals (ea_product_id);
create trigger manuals_touch before update on manuals
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- manual_versions   (exactly one EA version; version unique per manual)
-- ---------------------------------------------------------------------------
create table manual_versions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  manual_id        uuid not null references manuals (id) on delete cascade,
  ea_version_id    uuid not null references ea_versions (id) on delete restrict,
  version          text not null check (version ~ '^\d+\.\d+\.\d+$'),
  status           manual_status not null default 'DRAFT',
  template_version integer,
  completion       jsonb not null default '{}'::jsonb,
  row_version      bigint not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  published_at     timestamptz,
  reviewed_at      timestamptz,
  unique (manual_id, version)
);
create index manual_versions_status_idx on manual_versions (organization_id, status, updated_at desc);
create index manual_versions_manual_idx on manual_versions (manual_id);
create trigger manual_versions_bump before update on manual_versions
  for each row execute function app.bump_row_version();

-- ---------------------------------------------------------------------------
-- manual_sections
-- ---------------------------------------------------------------------------
create table manual_sections (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  manual_version_id uuid not null references manual_versions (id) on delete cascade,
  section_key       text not null,
  title             text not null,
  required          boolean not null default false,
  is_custom         boolean not null default false,
  position          integer not null check (position >= 0),
  completion_state  section_completion_state not null default 'incomplete',
  row_version       bigint not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (manual_version_id, section_key),
  unique (manual_version_id, position) deferrable initially deferred
);
create index manual_sections_version_pos_idx on manual_sections (manual_version_id, position);
create trigger manual_sections_bump before update on manual_sections
  for each row execute function app.bump_row_version();

-- ---------------------------------------------------------------------------
-- manual_blocks   (payload validated with Zod at the write boundary; soft delete)
-- ---------------------------------------------------------------------------
create table manual_blocks (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations (id) on delete cascade,
  manual_section_id   uuid not null references manual_sections (id) on delete cascade,
  block_type          manual_block_type not null,
  payload             jsonb not null,
  position            integer not null check (position >= 0),
  image_asset_id      uuid references image_assets (id) on delete set null,
  parameter_group_ids uuid[] not null default '{}',
  deleted_at          timestamptz,
  row_version         bigint not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- position unique among LIVE blocks only (soft-deleted rows are excluded).
create unique index manual_blocks_live_pos_idx
  on manual_blocks (manual_section_id, position) where deleted_at is null;
create index manual_blocks_section_idx on manual_blocks (manual_section_id) where deleted_at is null;
create trigger manual_blocks_bump before update on manual_blocks
  for each row execute function app.bump_row_version();
