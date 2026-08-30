-- Phase 7 · Slice 1 — global public namespace + publication-safe index.
--
-- New file after 20260901002400 (00100–02400 are deployed/frozen and NOT modified).
--
-- Problem: `/manual/[eaSlug]/[version]` has no org segment, but `ea_products.slug` is only
-- UNIQUE (organization_id, slug) and `published_snapshots.public_slug` is only
-- UNIQUE (organization_id, public_slug, public_version). Two orgs could publish the same
-- `/manual/vmax-ea/1.0.0`. The public route must never have two possible targets.
--
-- Adds:
--   * published_snapshots  UNIQUE (id, organization_id)          -- composite-FK target
--   * public_manuals          one row per publication LINEAGE; `public_slug` is the GLOBAL id.
--                             The slug is claimed by a lineage on FIRST publish and FROZEN there
--                             (a later EA-product rename never moves the public URL).
--   * public_manual_versions  one row per published version; the route / switcher index.
--                             Only PUBLISHED | ARCHIVED — never a draft/review state.
--   * publish_manual_version / archive_manual_version  — REPLACED (new `create or replace`) so
--                             the index rows are written inside the SAME publication transaction.
--
-- Write boundary: the two index tables get SELECT-only grants (authenticated org members +
-- service_role for the public Next server read path). No INSERT/UPDATE/DELETE grant to anyone —
-- the ONLY writer is the SECURITY DEFINER publication RPC pair (owner `postgres`). A defence-in-
-- depth BEFORE UPDATE trigger on `public_manual_versions` allows only the PUBLISHED -> ARCHIVED
-- transition and keeps every other column immutable, even on the RPC path.

-- ---------------------------------------------------------------------------
-- 0. composite-FK target on published_snapshots
-- ---------------------------------------------------------------------------
alter table published_snapshots
  add constraint published_snapshots_id_org_uk unique (id, organization_id);

-- ---------------------------------------------------------------------------
-- 1. BACKFILL PREFLIGHT — refuse to migrate on ambiguous legacy history
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad_slug    integer;
  v_bad_lineage integer;
begin
  -- A) one public_slug mapped to more than one manual lineage
  select count(*) into v_bad_slug from (
    select ps.public_slug
    from published_snapshots ps
    join manual_versions mv on mv.id = ps.manual_version_id
    group by ps.public_slug
    having count(distinct mv.manual_id) > 1
  ) x;
  if v_bad_slug > 0 then
    raise exception 'phase7 backfill aborted: % public_slug value(s) map to more than one manual lineage — resolve the ambiguity before applying this migration', v_bad_slug;
  end if;

  -- B) one manual lineage published under more than one public_slug
  select count(*) into v_bad_lineage from (
    select mv.manual_id
    from published_snapshots ps
    join manual_versions mv on mv.id = ps.manual_version_id
    group by mv.manual_id
    having count(distinct ps.public_slug) > 1
  ) x;
  if v_bad_lineage > 0 then
    raise exception 'phase7 backfill aborted: % manual lineage(s) published under more than one public_slug — resolve the ambiguity before applying this migration', v_bad_lineage;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. public_manuals — routing identity only (NOT a content source)
-- ---------------------------------------------------------------------------
create table public_manuals (
  id                 uuid primary key default gen_random_uuid(),
  public_slug        text not null unique
                       check (public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  organization_id    uuid not null references organizations (id) on delete cascade,
  manual_id          uuid not null,
  first_published_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, manual_id),
  -- ON DELETE CASCADE (not RESTRICT): deleting a manual lineage removes its public claim — there
  -- is nothing left to route to, and it lets trusted cleanup work. `manuals` rows are only ever
  -- deleted by service / cascade cleanup (no user-facing "delete manual").
  foreign key (manual_id, organization_id)
    references manuals (id, organization_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- 3. public_manual_versions — the route / switcher index
-- ---------------------------------------------------------------------------
create table public_manual_versions (
  id                    uuid primary key default gen_random_uuid(),
  public_manual_id      uuid not null,
  organization_id       uuid not null,
  public_version        text not null,
  published_snapshot_id uuid not null unique,
  publication_state     text not null check (publication_state in ('PUBLISHED', 'ARCHIVED')),
  published_at          timestamptz not null,
  archived_at           timestamptz,
  unique (id, organization_id),
  unique (public_manual_id, public_version),
  check (publication_state = 'PUBLISHED' or archived_at is not null),
  -- same-org integrity enforced at the DB, not just by the RPC
  foreign key (public_manual_id, organization_id)
    references public_manuals (id, organization_id) on delete cascade,
  foreign key (published_snapshot_id, organization_id)
    references published_snapshots (id, organization_id) on delete cascade
);
create index public_manual_versions_pm_idx
  on public_manual_versions (public_manual_id, publication_state, published_at desc);

-- ---------------------------------------------------------------------------
-- 4. BACKFILL from legacy publication history (no-op on a clean DB)
--    Migration-time join to working tables is allowed; the PUBLIC route never does this.
-- ---------------------------------------------------------------------------
insert into public_manuals (public_slug, organization_id, manual_id, first_published_at)
select ps.public_slug, mv.organization_id, mv.manual_id, min(ps.published_at)
from published_snapshots ps
join manual_versions mv on mv.id = ps.manual_version_id
group by ps.public_slug, mv.organization_id, mv.manual_id;

insert into public_manual_versions
  (public_manual_id, organization_id, public_version, published_snapshot_id, publication_state, published_at, archived_at)
select pm.id, ps.organization_id, ps.public_version, ps.id,
       case when mv.status = 'ARCHIVED' then 'ARCHIVED' else 'PUBLISHED' end,
       ps.published_at,
       case when mv.status = 'ARCHIVED' then coalesce(mv.archived_at, ps.published_at) else null end
from published_snapshots ps
join manual_versions mv on mv.id = ps.manual_version_id
join public_manuals   pm on pm.public_slug = ps.public_slug and pm.organization_id = ps.organization_id;

-- ---------------------------------------------------------------------------
-- 5. RLS + grants — SELECT only; NO client/service write grant
-- ---------------------------------------------------------------------------
alter table public_manuals         enable row level security;
alter table public_manual_versions enable row level security;

create policy public_manuals_select_members on public_manuals
  for select to authenticated using (organization_id in (select app.member_org_ids()));
create policy public_manual_versions_select_members on public_manual_versions
  for select to authenticated using (organization_id in (select app.member_org_ids()));

grant select on public_manuals, public_manual_versions to authenticated;
grant select on public_manuals, public_manual_versions to service_role;
-- deliberately NO insert/update/delete grant: the only writer is publish/archive_manual_version
-- (SECURITY DEFINER, owner postgres). A direct PostgREST write by anon / authenticated /
-- service_role is denied by the missing grant.

-- ---------------------------------------------------------------------------
-- 6. defence-in-depth: public_manual_versions transition guard (spec §14)
--    Runs for EVERY caller incl. the RPC (postgres) — only PUBLISHED -> ARCHIVED, nothing else.
-- ---------------------------------------------------------------------------
create or replace function app.guard_public_manual_version_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.public_manual_id      is distinct from old.public_manual_id
     or new.organization_id    is distinct from old.organization_id
     or new.public_version     is distinct from old.public_version
     or new.published_snapshot_id is distinct from old.published_snapshot_id
     or new.published_at       is distinct from old.published_at then
    raise exception 'public_manual_versions: public_manual_id / organization_id / public_version / published_snapshot_id / published_at are immutable'
      using errcode = 'restrict_violation';
  end if;
  if not (old.publication_state = 'PUBLISHED' and new.publication_state = 'ARCHIVED') then
    raise exception 'public_manual_versions: the only allowed state change is PUBLISHED -> ARCHIVED'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function app.guard_public_manual_version_update() from public;
create trigger public_manual_versions_transition_guard
  before update on public_manual_versions
  for each row execute function app.guard_public_manual_version_update();

-- ---------------------------------------------------------------------------
-- 7. publish_manual_version — REPLACED: claim/reuse the frozen public slug + write the index
--    row inside the SAME transaction. Body is byte-identical to 20260901002100 EXCEPT:
--      * also selects manual_id
--      * a concurrency-safe global slug claim/reuse just before the status transition
--      * published_snapshots / audit / return use v_effective_public_slug (never a stale caller slug)
--      * inserts one public_manual_versions row
-- ---------------------------------------------------------------------------
create or replace function public.publish_manual_version(
  p_manual_version_id     uuid,
  p_actor_id              uuid,
  p_expected_content_hash text,
  p_render_json           jsonb,
  p_snapshot_hash         text,
  p_public_slug           text,
  p_public_version        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org         uuid;
  v_manual_id   uuid;
  v_status      manual_status;
  v_round       integer;
  v_submitted   text;
  v_tech_hash   text;
  v_comp_hash   text;
  v_tid         uuid;
  v_ver         integer;
  v_tid_n       integer;
  v_ver_n       integer;
  v_res_n       integer;
  v_item_n      integer;
  v_missing     text[];
  v_warnblock   text[];
  v_blockers    text[];
  v_snapshot_id uuid;
  v_rows        integer;
  v_effective_public_slug text;
  v_public_manual_id      uuid;
  v_claim_org    uuid;
  v_claim_manual uuid;
begin
  select organization_id, manual_id, status, review_round, submitted_content_hash
    into v_org, v_manual_id, v_status, v_round, v_submitted
  from manual_versions
  where id = p_manual_version_id
  for update;
  if v_org is null then
    raise exception 'manual version not found' using errcode = 'no_data_found';
  end if;

  if p_actor_id is null or not app.is_admin(v_org, p_actor_id) then
    raise exception 'forbidden: only an ADMIN may publish a manual version'
      using errcode = 'insufficient_privilege';
  end if;

  if v_status <> 'APPROVED' then
    raise exception 'workflow: only an APPROVED manual version can be published (current %)', v_status
      using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(v_round, 0) < 1 then
    raise exception 'workflow: a published version must have a completed review round'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_expected_content_hash is null or p_expected_content_hash is distinct from v_submitted then
    raise exception 'stale content: the manual changed since it was approved — re-review is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select reviewed_content_hash into v_tech_hash
  from reviews
  where manual_version_id = p_manual_version_id and round_number = v_round
    and review_type = 'TECHNICAL' and decision = 'APPROVE';
  if v_tech_hash is null then
    raise exception 'workflow: no current-round technical approval'
      using errcode = 'invalid_parameter_value';
  end if;

  select reviewed_content_hash into v_comp_hash
  from reviews
  where manual_version_id = p_manual_version_id and round_number = v_round
    and review_type = 'COMPLIANCE' and decision = 'APPROVE';
  if v_comp_hash is null then
    raise exception 'workflow: no current-round compliance approval'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_tech_hash is distinct from v_submitted or v_comp_hash is distinct from v_submitted then
    raise exception 'stale content: an approval hash no longer matches the approved content'
      using errcode = 'invalid_parameter_value';
  end if;

  select count(distinct checklist_template_id), count(distinct checklist_template_version), count(*)
    into v_tid_n, v_ver_n, v_res_n
  from checklist_results
  where manual_version_id = p_manual_version_id;

  if v_res_n = 0 then
    raise exception 'validation: the manual has no checklist evaluation yet'
      using errcode = 'check_violation';
  end if;
  if v_tid_n <> 1 or v_ver_n <> 1 then
    raise exception 'validation: the checklist result set mixes template versions'
      using errcode = 'check_violation';
  end if;

  select checklist_template_id, checklist_template_version into v_tid, v_ver
  from checklist_results
  where manual_version_id = p_manual_version_id
  limit 1;

  select count(*) into v_item_n from checklist_items where checklist_template_id = v_tid;
  if v_res_n <> v_item_n then
    raise exception 'validation: the checklist result set does not cover every checklist item (% of %)', v_res_n, v_item_n
      using errcode = 'check_violation';
  end if;

  select array_agg(check_key order by check_key) into v_missing
  from checklist_results
  where manual_version_id = p_manual_version_id and required and state = 'MISSING';

  select array_agg(cr.check_key order by cr.check_key) into v_warnblock
  from checklist_results cr
  join checklist_items ci
    on ci.checklist_template_id = cr.checklist_template_id and ci.check_key = cr.check_key
  where cr.manual_version_id = p_manual_version_id
    and ci.publish_blocking and cr.state = 'WARNING';

  v_blockers := coalesce(v_missing, '{}') || coalesce(v_warnblock, '{}');
  if array_length(v_blockers, 1) is not null then
    raise exception 'validation: publication is blocked by unresolved checklist items'
      using errcode = 'check_violation',
            detail = array_to_string(v_blockers, ',');
  end if;

  -- ---- Phase 7: global public-slug claim / reuse (lineage-frozen, concurrency-safe) ----------
  -- Serialise first-publication claims within one lineage.
  perform 1 from manuals where id = v_manual_id for update;

  select id, public_slug into v_public_manual_id, v_effective_public_slug
  from public_manuals
  where organization_id = v_org and manual_id = v_manual_id;

  if v_public_manual_id is null then
    -- first publication of this lineage: claim p_public_slug for the WHOLE public namespace.
    if p_public_slug is null or p_public_slug = '' then
      raise exception 'validation: a public slug is required for the first publication'
        using errcode = 'invalid_parameter_value';
    end if;

    insert into public_manuals (public_slug, organization_id, manual_id)
    values (p_public_slug, v_org, v_manual_id)
    on conflict (public_slug) do nothing;

    -- Lock the winning row (waits out any concurrent unique-conflict), then VERIFY ownership.
    -- Never proceed merely because ON CONFLICT DO NOTHING raised no error.
    select id, organization_id, manual_id
      into v_public_manual_id, v_claim_org, v_claim_manual
    from public_manuals
    where public_slug = p_public_slug
    for update;

    if v_claim_org is distinct from v_org or v_claim_manual is distinct from v_manual_id then
      raise exception 'conflict: public slug "%" is already claimed by another manual', p_public_slug
        using errcode = 'unique_violation';
    end if;
    v_effective_public_slug := p_public_slug;
  end if;

  -- ---- ONE transaction: status, snapshot, public index, audit ----
  update manual_versions
    set status = 'PUBLISHED', published_at = now()
  where id = p_manual_version_id and status = 'APPROVED' and review_round = v_round;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'workflow: the manual version already left APPROVED'
      using errcode = 'invalid_parameter_value';
  end if;

  begin
    insert into published_snapshots
      (organization_id, manual_version_id, render_json, content_hash, public_slug, public_version)
    values
      (v_org, p_manual_version_id, p_render_json, p_snapshot_hash, v_effective_public_slug, p_public_version)
    returning id into v_snapshot_id;
  exception when unique_violation then
    raise exception 'conflict: this manual version is already published, or the public slug + version is taken'
      using errcode = 'unique_violation';
  end;

  begin
    insert into public_manual_versions
      (public_manual_id, organization_id, public_version, published_snapshot_id, publication_state, published_at)
    values
      (v_public_manual_id, v_org, p_public_version, v_snapshot_id, 'PUBLISHED', now());
  exception when unique_violation then
    raise exception 'conflict: this public version already exists for the manual'
      using errcode = 'unique_violation';
  end;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, p_actor_id, 'manual_version:publish', 'manual_version', p_manual_version_id,
    jsonb_build_object(
      'round',              v_round,
      'fromStatus',         'APPROVED',
      'toStatus',           'PUBLISHED',
      'publicSlug',         v_effective_public_slug,
      'publicVersion',      p_public_version,
      'snapshotId',         v_snapshot_id,
      'contentHash',        p_snapshot_hash,
      'reviewedContentHash', v_submitted,
      'blockingCheckIds',   '[]'::jsonb));

  return jsonb_build_object(
    'status',        'PUBLISHED',
    'snapshotId',    v_snapshot_id,
    'contentHash',   p_snapshot_hash,
    'publicSlug',    v_effective_public_slug,
    'publicVersion', p_public_version);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. archive_manual_version — REPLACED: also flip the public index row, same transaction.
--    Body byte-identical to 20260901002100 EXCEPT the public_manual_versions update + the
--    "exactly one index row" integrity check.
-- ---------------------------------------------------------------------------
create or replace function public.archive_manual_version(
  p_manual_version_id uuid,
  p_actor_id          uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_status manual_status;
  v_snap   uuid;
  v_rows   integer;
begin
  select organization_id, status into v_org, v_status
  from manual_versions
  where id = p_manual_version_id
  for update;
  if v_org is null then
    raise exception 'manual version not found' using errcode = 'no_data_found';
  end if;

  if p_actor_id is null or not app.is_admin(v_org, p_actor_id) then
    raise exception 'forbidden: only an ADMIN may archive a manual version'
      using errcode = 'insufficient_privilege';
  end if;

  if v_status <> 'PUBLISHED' then
    raise exception 'workflow: only a PUBLISHED manual version can be archived (current %)', v_status
      using errcode = 'invalid_parameter_value';
  end if;

  select id into v_snap from published_snapshots where manual_version_id = p_manual_version_id;
  if v_snap is null then
    raise exception 'workflow: a published version must have a snapshot before it can be archived'
      using errcode = 'invalid_parameter_value';
  end if;

  update manual_versions
    set status = 'ARCHIVED', archived_at = now()
  where id = p_manual_version_id and status = 'PUBLISHED';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'workflow: the manual version already left PUBLISHED'
      using errcode = 'invalid_parameter_value';
  end if;

  update public_manual_versions
    set publication_state = 'ARCHIVED', archived_at = now()
  where published_snapshot_id = v_snap;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'integrity: expected exactly one public_manual_versions row for snapshot %, updated %', v_snap, v_rows
      using errcode = 'internal_error';
  end if;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, p_actor_id, 'manual_version:archive', 'manual_version', p_manual_version_id,
    jsonb_build_object(
      'fromStatus',        'PUBLISHED',
      'toStatus',          'ARCHIVED',
      'publishedSnapshotId', v_snap));

  return jsonb_build_object('status', 'ARCHIVED', 'publishedSnapshotId', v_snap);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. EXECUTE hardening (unchanged — SERVICE-ROLE ONLY)
-- ---------------------------------------------------------------------------
revoke execute on function public.publish_manual_version(uuid, uuid, text, jsonb, text, text, text) from public, anon, authenticated;
revoke execute on function public.archive_manual_version(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.publish_manual_version(uuid, uuid, text, jsonb, text, text, text) to service_role;
grant  execute on function public.archive_manual_version(uuid, uuid) to service_role;
