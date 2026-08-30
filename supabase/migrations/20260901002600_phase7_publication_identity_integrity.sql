-- Phase 7 · Slice 1 — final correction: publication-identity integrity guard in the RPC.
--
-- New file after 20260901002500 (00100–02500 are deployed/frozen and NOT modified).
--
-- `20260901002500` freezes the public lineage slug inside the transaction, but the trusted server
-- action builds `p_render_json` + `p_snapshot_hash` BEFORE the RPC decides `v_effective_public_slug`.
-- If the EA product was renamed between publications (its mutable `ea_products.slug` changed), or a
-- concurrent publication claims the slug first, the server could hand the RPC a snapshot whose
-- `render_json.public.slug` / `.version` disagree with what the DB will persist.
--
-- This migration REPLACES `publish_manual_version` (same signature, Phase-6 + Phase-7 body verbatim)
-- and adds three identity guards that run AFTER `v_effective_public_slug` is resolved and BEFORE any
-- permanent publication mutation. On mismatch the whole transaction rolls back with a typed
-- `stale content:` error (mapped to STALE by the server action). The RPC never mutates
-- `p_render_json`; it never accepts a `content_hash` that describes a different public identity.
-- The caller may retry: on retry the server action reads the now-established lineage claim and
-- rebuilds the snapshot with the frozen slug.
--
-- `archive_manual_version` is unchanged (it takes no render_json).

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
  v_mv_version  text;
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
  select organization_id, manual_id, version, status, review_round, submitted_content_hash
    into v_org, v_manual_id, v_mv_version, v_status, v_round, v_submitted
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
  perform 1 from manuals where id = v_manual_id for update;

  select id, public_slug into v_public_manual_id, v_effective_public_slug
  from public_manuals
  where organization_id = v_org and manual_id = v_manual_id;

  if v_public_manual_id is null then
    if p_public_slug is null or p_public_slug = '' then
      raise exception 'validation: a public slug is required for the first publication'
        using errcode = 'invalid_parameter_value';
    end if;

    insert into public_manuals (public_slug, organization_id, manual_id)
    values (p_public_slug, v_org, v_manual_id)
    on conflict (public_slug) do nothing;

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

  -- ---- Phase 7 identity guards: the frozen snapshot must describe THIS version and THIS slug ----
  -- Runs after the effective slug is known, before any permanent mutation. p_render_json is never
  -- modified here — a mismatch means the caller built the snapshot against a stale public identity
  -- (an EA-product rename, or a lost slug race). Roll everything back; the caller rebuilds + retries.
  if p_public_version is distinct from v_mv_version then
    raise exception 'stale content: publish version "%" does not match the manual version "%"',
      p_public_version, v_mv_version
      using errcode = 'invalid_parameter_value';
  end if;
  if (p_render_json #>> '{public,slug}') is distinct from v_effective_public_slug then
    raise exception 'stale content: snapshot public slug "%" does not match the frozen lineage slug "%" — rebuild the snapshot and retry',
      p_render_json #>> '{public,slug}', v_effective_public_slug
      using errcode = 'invalid_parameter_value';
  end if;
  if (p_render_json #>> '{public,version}') is distinct from p_public_version then
    raise exception 'stale content: snapshot public version "%" does not match "%"',
      p_render_json #>> '{public,version}', p_public_version
      using errcode = 'invalid_parameter_value';
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

revoke execute on function public.publish_manual_version(uuid, uuid, text, jsonb, text, text, text) from public, anon, authenticated;
grant  execute on function public.publish_manual_version(uuid, uuid, text, jsonb, text, text, text) to service_role;
