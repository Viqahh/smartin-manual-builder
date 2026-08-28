-- Phase 2 · Core: organisations, profiles, memberships, audit, shared helpers.
-- Source of truth: docs/DATA_MODEL.md, docs/ARCHITECTURE.md.

create extension if not exists "pgcrypto";

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Monotonic row version for optimistic concurrency / autosave conflict detection
-- (docs/domain/autosave.ts, PRD-MAN-012, AC-P2-20).
create or replace function app.bump_row_version()
returns trigger
language plpgsql
as $$
begin
  new.row_version := coalesce(old.row_version, 0) + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type membership_role as enum (
  'DEVELOPER', 'TECHNICAL_REVIEWER', 'COMPLIANCE_REVIEWER', 'ADMIN'
);

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 160),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger organizations_touch before update on organizations
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- profiles  (mirror of auth.users; no global application role stored here)
-- ---------------------------------------------------------------------------
create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger profiles_touch before update on profiles
  for each row execute function app.touch_updated_at();

create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- memberships  (organisation-scoped roles; a user MAY hold more than one role
-- in one organisation — PRD §6. Normalised: one row per (org, user, role).)
-- ---------------------------------------------------------------------------
create table memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id         uuid not null references profiles (id) on delete cascade,
  role            membership_role not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id, role)
);
create index memberships_user_idx on memberships (user_id) where is_active;
create index memberships_org_idx on memberships (organization_id) where is_active;
create trigger memberships_touch before update on memberships
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Membership helpers used by RLS (SECURITY DEFINER so policies stay simple)
-- ---------------------------------------------------------------------------
create or replace function app.member_org_ids(p_user uuid default auth.uid())
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from memberships
  where user_id = p_user and is_active
$$;

create or replace function app.has_org_access(p_org uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where organization_id = p_org and user_id = p_user and is_active
  )
$$;

-- Every role the user holds in an organisation (a user may hold several — PRD §6).
create or replace function app.member_roles(p_org uuid, p_user uuid default auth.uid())
returns setof membership_role
language sql
stable
security definer
set search_path = public
as $$
  select role from memberships
  where organization_id = p_org and user_id = p_user and is_active
$$;

create or replace function app.has_role(p_org uuid, p_role membership_role, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where organization_id = p_org and user_id = p_user and role = p_role and is_active
  )
$$;

-- Authoring capability = DEVELOPER or ADMIN (mirrors lib/permissions ROLE_ACTIONS;
-- TECHNICAL_REVIEWER / COMPLIANCE_REVIEWER are read-only for EA/manual content in Phase 2).
create or replace function app.can_author(p_org uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.has_role(p_org, 'DEVELOPER', p_user) or app.has_role(p_org, 'ADMIN', p_user)
$$;

create or replace function app.is_admin(p_org uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.has_role(p_org, 'ADMIN', p_user)
$$;

-- ---------------------------------------------------------------------------
-- Trusted-caller detection for SECURITY DEFINER functions.
--
-- A NULL auth.uid() is NOT proof of a trusted caller — an *anonymous* API
-- request also has auth.uid() = NULL. Trust is asserted only when the request's
-- JWT role claim is `service_role`, or the session role is the DB owner
-- (migrations / `supabase db reset` seed). Everything else — including the
-- `anon` role — is untrusted.
-- ---------------------------------------------------------------------------
create or replace function app.is_service_request()
returns boolean
language sql
stable
as $$
  select
    coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' = 'service_role',
      false
    )
    or session_user in ('postgres', 'supabase_admin');
$$;

-- Single authorisation gate for mutating SECURITY DEFINER RPCs / helpers.
-- Denies anonymous callers outright; requires an authenticated member with
-- authoring capability (DEVELOPER or ADMIN) otherwise.
create or replace function app.assert_author(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if app.is_service_request() then
    return;
  end if;
  if auth.uid() is null then
    raise exception 'forbidden: authentication required' using errcode = 'insufficient_privilege';
  end if;
  if not app.has_org_access(p_org) then
    raise exception 'forbidden: not a member of organisation' using errcode = 'insufficient_privilege';
  end if;
  if not app.can_author(p_org) then
    raise exception 'forbidden: authoring requires DEVELOPER or ADMIN' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Untrusted callers must never invoke the gate helper directly.
revoke execute on function app.is_service_request() from public;
revoke execute on function app.assert_author(uuid) from public;

-- ---------------------------------------------------------------------------
-- audit_events  (append only — no UPDATE/DELETE policy is ever added)
-- ---------------------------------------------------------------------------
create table audit_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  actor_id        uuid references profiles (id) on delete set null,
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index audit_events_org_time_idx on audit_events (organization_id, created_at desc);
