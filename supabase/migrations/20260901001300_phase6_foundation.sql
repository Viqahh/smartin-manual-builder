-- Phase 6 · Slice 1 — foundation schema for reviews, versioning & immutable publication.
--
-- Adds ONLY the schema + invariants + durable provenance needed to prove the model.
-- Business transitions / RPCs / immutability triggers / publish transaction land in later
-- Phase 6 slices. Nothing here is a deployed-migration rewrite: this is a new file after
-- 20260901001200_phase5_checklist_v1_full.sql.
--
-- New:
--   manual_versions            + technical_reviewer_id / compliance_reviewer_id / review_round
--                              / submitted_content_hash
--   manual_version_contributors  durable "ever authored/edited" provenance (AC-P6-6 groundwork)
--   reviews                    one decision per (version, round, review_type); decision rows immutable
--   review_comments            anchored (manual / section / block), resolve/reopen, cross-round
--   changelog_entries          structured Added/Changed/Fixed/Breaking (PRD-VER-006/007)
--   published_snapshots        one immutable snapshot per manual version (AC-P6-9 groundwork)
--
-- Data API note: "expose new tables" = OFF, so explicit grants are required.
-- RLS: SELECT for org members only. NO client write policy on any new table this slice — writes
-- arrive via the SECURITY DEFINER RPCs of slices 2-6, and the contributor trigger.

-- ---------------------------------------------------------------------------
-- 0. composite-FK targets needed by review_comments anchors
-- ---------------------------------------------------------------------------
alter table manual_blocks add constraint manual_blocks_id_org_uk unique (id, organization_id);

-- ---------------------------------------------------------------------------
-- 1. manual_versions — reviewer assignment + round + submitted content hash
-- ---------------------------------------------------------------------------
alter table manual_versions
  add column technical_reviewer_id  uuid references profiles (id) on delete set null,
  add column compliance_reviewer_id uuid references profiles (id) on delete set null,
  add column review_round           integer not null default 0 check (review_round >= 0),
  add column submitted_content_hash text;

-- ---------------------------------------------------------------------------
-- 2. manual_version_contributors — durable authorship provenance
--    One row per (manual_version, user). Written ONLY by the trigger below and by
--    later-slice SECURITY DEFINER RPCs (clone attributes the accepting editor).
-- ---------------------------------------------------------------------------
create table manual_version_contributors (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations (id) on delete cascade,
  manual_version_id     uuid not null,
  user_id               uuid not null references profiles (id) on delete cascade,
  first_contributed_at  timestamptz not null default now(),
  last_contributed_at   timestamptz not null default now(),
  contribution_count    integer not null default 1 check (contribution_count >= 1),
  unique (manual_version_id, user_id),
  foreign key (manual_version_id, organization_id)
    references manual_versions (id, organization_id) on delete cascade
);
create index mvc_version_idx on manual_version_contributors (manual_version_id);
create index mvc_user_idx    on manual_version_contributors (user_id);

-- Records the acting user as a contributor whenever a section/block row is written.
-- Covers: block create/update/soft-delete/restore/reorder, section add/rename/delete/reorder,
-- and the template section instantiation done as the creating user. An accepted AI proposal
-- writes the block as the accepting editor, so it is attributed correctly. A migration / seed /
-- service write has auth.uid() = NULL and is skipped (no fabricated history).
create or replace function app.record_manual_contributor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_version uuid;
  v_org     uuid;
begin
  if v_user is null then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'manual_sections' then
    v_version := coalesce(new.manual_version_id, old.manual_version_id);
    v_org     := coalesce(new.organization_id, old.organization_id);
  else -- manual_blocks
    select ms.manual_version_id, ms.organization_id
      into v_version, v_org
      from manual_sections ms
     where ms.id = coalesce(new.manual_section_id, old.manual_section_id);
  end if;

  if v_version is null or v_org is null then
    return coalesce(new, old);
  end if;

  insert into manual_version_contributors (organization_id, manual_version_id, user_id)
  values (v_org, v_version, v_user)
  on conflict (manual_version_id, user_id) do update
    set last_contributed_at = now(),
        contribution_count   = manual_version_contributors.contribution_count + 1;

  return coalesce(new, old);
end;
$$;
revoke execute on function app.record_manual_contributor() from public;

create trigger manual_sections_contributor
  after insert or update or delete on manual_sections
  for each row execute function app.record_manual_contributor();
create trigger manual_blocks_contributor
  after insert or update or delete on manual_blocks
  for each row execute function app.record_manual_contributor();

-- Backfill from RELIABLE recorded actor data only (audit_events). Anything the pre-Phase-6
-- schema never captured is not fabricated — see docs/PHASE_6.md "historical limitation".
insert into manual_version_contributors (organization_id, manual_version_id, user_id, first_contributed_at, last_contributed_at, contribution_count)
select v_org, v_version, v_user, min(v_at), max(v_at), count(*)
from (
  -- manual creation -> the earliest version(s) of that manual
  select ae.organization_id as v_org, mv.id as v_version, ae.actor_id as v_user, ae.created_at as v_at
  from audit_events ae
  join manual_versions mv
    on mv.manual_id = ae.entity_id and mv.organization_id = ae.organization_id
  where ae.entity_type = 'manual' and ae.action = 'manual:create' and ae.actor_id is not null
  union all
  -- block edits -> that block's section's version
  select ae.organization_id, ms.manual_version_id, ae.actor_id, ae.created_at
  from audit_events ae
  join manual_blocks mb   on mb.id = ae.entity_id and mb.organization_id = ae.organization_id
  join manual_sections ms on ms.id = mb.manual_section_id
  where ae.entity_type = 'manual_block' and ae.actor_id is not null
  union all
  -- section edits -> that section's version
  select ae.organization_id, ms.manual_version_id, ae.actor_id, ae.created_at
  from audit_events ae
  join manual_sections ms on ms.id = ae.entity_id and ms.organization_id = ae.organization_id
  where ae.entity_type = 'manual_section' and ae.actor_id is not null
) src
group by v_org, v_version, v_user
on conflict (manual_version_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. reviews — one decision per (version, round, review_type). Immutable once written.
-- ---------------------------------------------------------------------------
create table reviews (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations (id) on delete cascade,
  manual_version_id     uuid not null,
  round_number          integer not null check (round_number >= 1),
  review_type           text not null check (review_type in ('TECHNICAL', 'COMPLIANCE')),
  reviewer_id           uuid not null references profiles (id) on delete restrict,
  decision              text not null check (decision in ('APPROVE', 'REQUEST_CHANGES')),
  summary               text not null default '',
  reviewed_content_hash text not null,
  decided_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  -- REQUEST_CHANGES needs a non-empty summary; APPROVE may omit it (§17/§18/§44)
  check (decision = 'APPROVE' or length(btrim(summary)) > 0),
  -- AC-P6-7: at most one technical + one compliance decision per round
  unique (manual_version_id, round_number, review_type),
  foreign key (manual_version_id, organization_id)
    references manual_versions (id, organization_id) on delete cascade
);
create index reviews_version_idx on reviews (manual_version_id, round_number);

-- §39 — a decision row is historical evidence. Block every UPDATE, and block DELETE for
-- ordinary callers. A DELETE is permitted only for a trusted service request / DB owner so
-- that a legitimate `manual_versions` cascade (and infra/test cleanup) still works — app
-- callers are already blocked by RLS (reviews has no client write policy) and by this trigger.
-- ponytail: keep the DELETE carve-out minimal; slice 6 revisits it with the publish/archive
-- immutability triggers once the full lifecycle is in place.
create or replace function app.reject_review_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and app.is_service_request() then
    return old;
  end if;
  raise exception 'review decisions are immutable (append a new round instead)'
    using errcode = 'restrict_violation';
end;
$$;
revoke execute on function app.reject_review_mutation() from public;
create trigger reviews_no_update before update on reviews
  for each row execute function app.reject_review_mutation();
create trigger reviews_no_delete before delete on reviews
  for each row execute function app.reject_review_mutation();

-- ---------------------------------------------------------------------------
-- 4. review_comments — anchored to manual / section / block; resolve + reopen
-- ---------------------------------------------------------------------------
create table review_comments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  manual_version_id uuid not null,
  round_number      integer not null check (round_number >= 1),
  review_type       text not null check (review_type in ('TECHNICAL', 'COMPLIANCE')),
  author_id         uuid not null references profiles (id) on delete restrict,
  section_id        uuid,
  block_id          uuid,
  body              text not null check (length(btrim(body)) between 1 and 5000),
  resolved          boolean not null default false,
  resolved_by       uuid references profiles (id) on delete set null,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- at most one anchor
  check (not (section_id is not null and block_id is not null)),
  foreign key (manual_version_id, organization_id)
    references manual_versions (id, organization_id) on delete cascade,
  -- cross-org anchor impossible at the constraint level
  foreign key (section_id, organization_id)
    references manual_sections (id, organization_id) on delete cascade,
  foreign key (block_id, organization_id)
    references manual_blocks (id, organization_id) on delete cascade
);
create index review_comments_version_idx  on review_comments (manual_version_id, round_number);
create index review_comments_section_idx  on review_comments (section_id) where section_id is not null;
create index review_comments_block_idx    on review_comments (block_id) where block_id is not null;
create trigger review_comments_touch before update on review_comments
  for each row execute function app.touch_updated_at();

-- anchor must belong to the SAME manual version (foreign section/block UUID rejected)
create or replace function app.assert_review_comment_anchor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anchor_version uuid;
begin
  if new.section_id is not null then
    select manual_version_id into v_anchor_version from manual_sections where id = new.section_id;
    if v_anchor_version is distinct from new.manual_version_id then
      raise exception 'review comment section anchor is not part of this manual version'
        using errcode = 'foreign_key_violation';
    end if;
  end if;
  if new.block_id is not null then
    select ms.manual_version_id into v_anchor_version
    from manual_blocks mb join manual_sections ms on ms.id = mb.manual_section_id
    where mb.id = new.block_id;
    if v_anchor_version is distinct from new.manual_version_id then
      raise exception 'review comment block anchor is not part of this manual version'
        using errcode = 'foreign_key_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function app.assert_review_comment_anchor() from public;
create trigger review_comments_anchor_check before insert or update on review_comments
  for each row execute function app.assert_review_comment_anchor();

-- ---------------------------------------------------------------------------
-- 5. changelog_entries — structured Added/Changed/Fixed/Breaking (PRD-VER-006/007)
--    EA facts stay in the EA Version; source_ea_version_id is a reference only.
-- ---------------------------------------------------------------------------
create table changelog_entries (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations (id) on delete cascade,
  manual_version_id    uuid not null,
  position             integer not null check (position >= 0),
  entry_type           text not null check (entry_type in ('ADDED', 'CHANGED', 'FIXED', 'BREAKING')),
  body                 text not null check (length(btrim(body)) between 1 and 4000),
  source_ea_version_id uuid,
  is_feature_change    boolean not null default false,
  open_position_impact text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (manual_version_id, position) deferrable initially deferred,
  foreign key (manual_version_id, organization_id)
    references manual_versions (id, organization_id) on delete cascade,
  foreign key (source_ea_version_id, organization_id)
    references ea_versions (id, organization_id) on delete set null (source_ea_version_id)
);
create index changelog_version_idx on changelog_entries (manual_version_id, position);
create trigger changelog_entries_touch before update on changelog_entries
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. published_snapshots — one immutable snapshot per manual version (AC-P6-9)
--    Immutability trigger + publish transaction: Phase 6 slice 6.
-- ---------------------------------------------------------------------------
create table published_snapshots (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  manual_version_id uuid not null unique,
  render_json       jsonb not null,
  content_hash      text not null,
  public_slug       text not null,
  public_version    text not null,
  published_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (organization_id, public_slug, public_version),
  foreign key (manual_version_id, organization_id)
    references manual_versions (id, organization_id) on delete restrict
);
create index snapshots_slug_idx on published_snapshots (public_slug, public_version);

-- ---------------------------------------------------------------------------
-- RLS — SELECT for org members; NO client write policy this slice
-- ---------------------------------------------------------------------------
alter table manual_version_contributors enable row level security;
alter table reviews                     enable row level security;
alter table review_comments             enable row level security;
alter table changelog_entries           enable row level security;
alter table published_snapshots         enable row level security;

create policy mvc_select_members on manual_version_contributors
  for select to authenticated using (organization_id in (select app.member_org_ids()));

create policy reviews_select_members on reviews
  for select to authenticated using (organization_id in (select app.member_org_ids()));

create policy review_comments_select_members on review_comments
  for select to authenticated using (organization_id in (select app.member_org_ids()));

create policy changelog_select_members on changelog_entries
  for select to authenticated using (organization_id in (select app.member_org_ids()));

create policy snapshots_select_members on published_snapshots
  for select to authenticated using (organization_id in (select app.member_org_ids()));

-- ---------------------------------------------------------------------------
-- Data API grants (RLS still decides the effective operation)
-- ---------------------------------------------------------------------------
grant select on table public.manual_version_contributors to authenticated;
grant select on table public.reviews                     to authenticated;
grant select on table public.review_comments             to authenticated;
grant select on table public.changelog_entries           to authenticated;
grant select on table public.published_snapshots         to authenticated;

grant select, insert, update, delete on table public.manual_version_contributors to service_role;
grant select, insert, update, delete on table public.reviews                     to service_role;
grant select, insert, update, delete on table public.review_comments             to service_role;
grant select, insert, update, delete on table public.changelog_entries           to service_role;
grant select, insert, update, delete on table public.published_snapshots         to service_role;
