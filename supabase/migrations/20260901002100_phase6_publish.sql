-- Phase 6 · Slice 6 — publication transaction: immutable snapshot + publish gate + archive.
--
-- New file after 20260901002000 (deployed migrations 01300–02000 are NOT modified).
--
-- Adds:
--   * manual_versions.archived_at
--   * app.guard_manual_version_update()  — REPLACED: also freezes a PUBLISHED / ARCHIVED version
--     against every ordinary-caller UPDATE (only the archive RPC, running as `postgres`, may move
--     PUBLISHED -> ARCHIVED); `archived_at` joins the workflow-column set.
--   * app.reject_frozen_manual_version_delete()  — a PUBLISHED / ARCHIVED row cannot be deleted
--     by an ordinary caller (service / cascade cleanup still works).
--   * app.reject_published_snapshot_mutation()   — published_snapshots rows are INSERT-once;
--     ordinary callers get no UPDATE / DELETE (defence-in-depth over the "no client write" grant).
--   * public.publish_manual_version(...)  — SERVICE-ROLE ONLY. The browser can never reach it;
--     only the trusted server action (which authenticates the ADMIN session, loads authoritative
--     content, and computes the review fingerprint + snapshot + snapshot hash server-side) calls
--     it, passing the authenticated actor id. The RPC re-verifies ADMIN, status, round, both
--     current-round approval hashes, the PERSISTED Phase 5 publish gate, and checklist result-set
--     coherence, then in ONE transaction: status -> PUBLISHED, published_at, one immutable
--     published_snapshots row, one audit row. Any failure rolls everything back.
--   * public.archive_manual_version(...) — SERVICE-ROLE ONLY. PUBLISHED -> ARCHIVED + archived_at
--     + one audit row. Never touches the snapshot / hashes / review history.
--
-- Trust boundary (spec §12): both RPCs are revoked from public / anon / authenticated and granted
-- ONLY to service_role. There is no browser-reachable privileged publish path and no
-- caller-supplied-hash path an authenticated user could invoke directly.

-- ---------------------------------------------------------------------------
-- 1. archived_at
-- ---------------------------------------------------------------------------
alter table manual_versions add column archived_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. manual_versions guard — workflow/assignment columns + reviewer integrity
--    + PUBLISHED / ARCHIVED content freeze (spec §24 / §25 / §26)
-- ---------------------------------------------------------------------------
create or replace function app.guard_manual_version_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_trusted boolean := current_user in ('postgres', 'supabase_admin', 'service_role');
  v_workflow_changed boolean := (
    new.status                    is distinct from old.status
    or new.review_round           is distinct from old.review_round
    or new.submitted_content_hash is distinct from old.submitted_content_hash
    or new.technical_reviewer_id  is distinct from old.technical_reviewer_id
    or new.compliance_reviewer_id is distinct from old.compliance_reviewer_id
    or new.published_at           is distinct from old.published_at
    or new.archived_at            is distinct from old.archived_at
  );
begin
  -- A PUBLISHED / ARCHIVED version is frozen for every ordinary caller. The only legitimate
  -- change is PUBLISHED -> ARCHIVED, done by archive_manual_version() which runs as `postgres`
  -- (v_trusted) — so ordinary callers are rejected here regardless of which column they touched.
  if old.status in ('PUBLISHED', 'ARCHIVED') and not v_trusted then
    raise exception 'manual version % is % and cannot be modified (create a new Manual Version instead)',
      old.id, old.status
      using errcode = 'insufficient_privilege';
  end if;

  if v_workflow_changed and not v_trusted then
    raise exception 'workflow and reviewer-assignment columns change only through review commands'
      using errcode = 'insufficient_privilege';
  end if;

  if new.technical_reviewer_id is distinct from old.technical_reviewer_id
     and new.technical_reviewer_id is not null then
    if not exists (
      select 1 from memberships
      where organization_id = new.organization_id and user_id = new.technical_reviewer_id
        and role = 'TECHNICAL_REVIEWER' and is_active
    ) then
      raise exception 'assigned technical reviewer must be an active TECHNICAL_REVIEWER in this organisation'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.compliance_reviewer_id is distinct from old.compliance_reviewer_id
     and new.compliance_reviewer_id is not null then
    if not exists (
      select 1 from memberships
      where organization_id = new.organization_id and user_id = new.compliance_reviewer_id
        and role = 'COMPLIANCE_REVIEWER' and is_active
    ) then
      raise exception 'assigned compliance reviewer must be an active COMPLIANCE_REVIEWER in this organisation'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;
revoke execute on function app.guard_manual_version_update() from public;
-- trigger `manual_versions_workflow_guard` already bound in 20260901001400.

-- ---------------------------------------------------------------------------
-- 3. a PUBLISHED / ARCHIVED manual version cannot be deleted by an ordinary caller
-- ---------------------------------------------------------------------------
create or replace function app.reject_frozen_manual_version_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('PUBLISHED', 'ARCHIVED')
     and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'a % manual version cannot be deleted', old.status
      using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;
revoke execute on function app.reject_frozen_manual_version_delete() from public;
create trigger manual_versions_frozen_delete_guard before delete on manual_versions
  for each row execute function app.reject_frozen_manual_version_delete();

-- ---------------------------------------------------------------------------
-- 4. published_snapshots — INSERT once; no ordinary UPDATE / DELETE (spec §27)
--    (published_snapshots already has NO client write grant; this is defence-in-depth and gives
--     a clear message. Trusted cleanup: `postgres` / `supabase_admin` / `service_role` only.)
-- ---------------------------------------------------------------------------
create or replace function app.reject_published_snapshot_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return coalesce(new, old);
  end if;
  raise exception 'a published snapshot is immutable'
    using errcode = 'restrict_violation';
end;
$$;
revoke execute on function app.reject_published_snapshot_mutation() from public;
create trigger published_snapshots_no_update before update on published_snapshots
  for each row execute function app.reject_published_snapshot_mutation();
create trigger published_snapshots_no_delete before delete on published_snapshots
  for each row execute function app.reject_published_snapshot_mutation();

-- ---------------------------------------------------------------------------
-- 5. publish_manual_version  (SERVICE-ROLE ONLY; APPROVED -> PUBLISHED)
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
begin
  select organization_id, status, review_round, submitted_content_hash
    into v_org, v_status, v_round, v_submitted
  from manual_versions
  where id = p_manual_version_id
  for update;
  if v_org is null then
    raise exception 'manual version not found' using errcode = 'no_data_found';
  end if;

  -- ---- authority: ADMIN only (spec §3). p_actor_id comes from the authenticated server session.
  if p_actor_id is null or not app.is_admin(v_org, p_actor_id) then
    raise exception 'forbidden: only an ADMIN may publish a manual version'
      using errcode = 'insufficient_privilege';
  end if;

  -- ---- workflow state
  if v_status <> 'APPROVED' then
    raise exception 'workflow: only an APPROVED manual version can be published (current %)', v_status
      using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(v_round, 0) < 1 then
    raise exception 'workflow: a published version must have a completed review round'
      using errcode = 'invalid_parameter_value';
  end if;

  -- ---- reviewed-content integrity: the server-computed current fingerprint MUST equal the
  --      submitted hash AND both current-round approval hashes. No silent refresh (spec §11).
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

  -- ---- checklist result-set coherence (spec §17): exactly one template identity/version, one
  --      row per item, full coverage.
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

  -- ---- PERSISTED Phase 5 publish gate (spec §13 / §14 / §16). Rules are NOT duplicated here —
  --      this reads the persisted checklist_results + checklist_items metadata only.
  --      A. any REQUIRED result still MISSING   (NOT_APPLICABLE never blocks; scope already baked in)
  --      B. any publish-blocking item at WARNING (ordinary WARNING does not block)
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

  -- ---- ONE transaction: status, snapshot, audit. Any failure below rolls everything back.
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
      (v_org, p_manual_version_id, p_render_json, p_snapshot_hash, p_public_slug, p_public_version)
    returning id into v_snapshot_id;
  exception when unique_violation then
    raise exception 'conflict: this manual version is already published, or the public slug + version is taken'
      using errcode = 'unique_violation';
  end;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, p_actor_id, 'manual_version:publish', 'manual_version', p_manual_version_id,
    jsonb_build_object(
      'round',              v_round,
      'fromStatus',         'APPROVED',
      'toStatus',           'PUBLISHED',
      'publicSlug',         p_public_slug,
      'publicVersion',      p_public_version,
      'snapshotId',         v_snapshot_id,
      'contentHash',        p_snapshot_hash,
      'reviewedContentHash', v_submitted,
      'blockingCheckIds',   '[]'::jsonb));

  return jsonb_build_object(
    'status',        'PUBLISHED',
    'snapshotId',    v_snapshot_id,
    'contentHash',   p_snapshot_hash,
    'publicSlug',    p_public_slug,
    'publicVersion', p_public_version);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. archive_manual_version  (SERVICE-ROLE ONLY; PUBLISHED -> ARCHIVED)
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
-- 7. EXECUTE hardening — SERVICE-ROLE ONLY (no browser-reachable privileged path, spec §12)
-- ---------------------------------------------------------------------------
revoke execute on function public.publish_manual_version(uuid, uuid, text, jsonb, text, text, text) from public, anon, authenticated;
revoke execute on function public.archive_manual_version(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.publish_manual_version(uuid, uuid, text, jsonb, text, text, text) to service_role;
grant  execute on function public.archive_manual_version(uuid, uuid) to service_role;
