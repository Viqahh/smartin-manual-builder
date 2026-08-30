-- Phase 6 · Slice 5 (final correction) — fix: `min(uuid)` does not exist in Postgres, so the
-- checklist-template resolution in 20260901001900 raised `42883` at clone time. Split it into a
-- COUNT(distinct version) guard + a single-row read of (template_id, version). Everything else in
-- the clone body is byte-identical to 20260901001900 (which is NOT rewritten — it is deployed).

create or replace function public.clone_manual_version(
  p_source_manual_version_id uuid,
  p_target_ea_version_id     uuid,
  p_new_version              text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org          uuid;
  v_manual       uuid;
  v_src_version  text;
  v_template_id  uuid;
  v_template_ver integer;
  v_src_ea_ver   uuid;
  v_src_product  uuid;
  v_tgt_product  uuid;
  v_actor        uuid := auth.uid();
  v_latest_mv    uuid;
  v_cl_distinct  integer;
  v_src_cl_tid   uuid;
  v_src_cl_ver   integer;
  v_new_mv       uuid;
  v_new_sec      uuid;
  v_new_gids     uuid[];
  v_gid          uuid;
  v_gname        text;
  v_tgt_gid      uuid;
  v_payload      jsonb;
  r_sec          record;
  r_blk          record;
begin
  -- ---- load source + authorise (org is DERIVED from the source, never trusted from the caller)
  select mv.organization_id, mv.manual_id, mv.version, mv.template_id, mv.template_version, mv.ea_version_id
    into v_org, v_manual, v_src_version, v_template_id, v_template_ver, v_src_ea_ver
  from manual_versions mv
  where mv.id = p_source_manual_version_id;
  if v_org is null then raise exception 'source manual version not found' using errcode = 'no_data_found'; end if;

  perform app.assert_author(v_org);

  -- ---- serialise clones within one lineage: lock the parent `manuals` row, THEN check "latest".
  -- Two concurrent clones of the same latest source cannot both win — the second resumes after
  -- the lock, sees the sibling version the first created, and is rejected as a stale source.
  perform 1 from manuals where id = v_manual for update;

  select id into v_latest_mv
  from manual_versions
  where manual_id = v_manual and organization_id = v_org
  order by created_at desc, id desc   -- matches SupabaseManualDataSource's "latest" (created_at desc)
  limit 1;
  if v_latest_mv is distinct from p_source_manual_version_id then
    raise exception 'clone: source Manual Version is no longer the latest version for this manual'
      using errcode = 'invalid_parameter_value';
  end if;

  -- ---- resolve the source's CHECKLIST-TEMPLATE version (not the manual template_version).
  -- Every row in one manual version's result set must agree on a single checklist template version.
  select count(distinct checklist_template_version) into v_cl_distinct
  from checklist_results
  where manual_version_id = p_source_manual_version_id;

  if v_cl_distinct > 1 then
    raise exception 'clone: source Manual Version has mixed checklist template versions'
      using errcode = 'data_exception';
  end if;
  if v_cl_distinct = 1 then
    select checklist_template_id, checklist_template_version
      into v_src_cl_tid, v_src_cl_ver
    from checklist_results
    where manual_version_id = p_source_manual_version_id
    limit 1;
  else
    -- documented fallback: the source has no evaluation yet -> current active checklist template
    select id, version into v_src_cl_tid, v_src_cl_ver
    from checklist_templates
    where key = 'smartin-documentation-checklist' and is_active
    order by version desc
    limit 1;
  end if;

  -- ---- target EA version must be same-org AND same EA product lineage
  select ea_product_id into v_src_product from ea_versions where id = v_src_ea_ver;
  select ea_product_id into v_tgt_product
    from ea_versions
   where id = p_target_ea_version_id and organization_id = v_org;
  if v_tgt_product is null then
    raise exception 'clone: target EA version not found in this organisation' using errcode = 'foreign_key_violation';
  end if;
  if v_tgt_product is distinct from v_src_product then
    raise exception 'clone: target EA version belongs to a different EA product' using errcode = 'foreign_key_violation';
  end if;

  -- ---- new manual-version string
  if p_new_version is null or p_new_version !~ '^\d+\.\d+\.\d+$' then
    raise exception 'clone: the new manual version must be X.Y.Z' using errcode = 'invalid_parameter_value';
  end if;
  -- uniqueness within the manual lineage: unique (manual_id, version). A racing INSERT below
  -- raises 23505 and the whole transaction rolls back; the server action maps it to a conflict.

  -- ---- fresh DRAFT (same manual lineage + the SAME template evidence for a valid Phase 5 scaffold)
  insert into manual_versions
    (organization_id, manual_id, ea_version_id, version, status, template_id, template_version)
  values
    (v_org, v_manual, p_target_ea_version_id, p_new_version, 'DRAFT', v_template_id, v_template_ver)
  returning id into v_new_mv;

  -- the cloning actor is a contributor of the NEW version (row triggers below reinforce this)
  insert into manual_version_contributors (organization_id, manual_version_id, user_id)
  values (v_org, v_new_mv, v_actor)
  on conflict (manual_version_id, user_id) do nothing;

  -- ---- sections (ordered; completion_state reset to 'incomplete')
  for r_sec in
    select * from manual_sections where manual_version_id = p_source_manual_version_id order by position
  loop
    insert into manual_sections
      (organization_id, manual_version_id, section_key, title, required, is_custom, position, completion_state)
    values
      (v_org, v_new_mv, r_sec.section_key, r_sec.title, r_sec.required, r_sec.is_custom, r_sec.position, 'incomplete')
    returning id into v_new_sec;

    -- ---- ACTIVE blocks only (deleted_at is null); deep payload copy; new ids
    for r_blk in
      select * from manual_blocks
      where manual_section_id = r_sec.id and deleted_at is null
      order by position
    loop
      v_new_gids := '{}'::uuid[];
      v_payload  := r_blk.payload;

      if r_blk.block_type = 'parameterTable' then
        foreach v_gid in array coalesce(r_blk.parameter_group_ids, '{}'::uuid[])
        loop
          -- reset per iteration: PL/pgSQL SELECT ... INTO leaves the variable UNCHANGED on 0 rows.
          v_gname := null;
          v_tgt_gid := null;
          select name into v_gname from parameter_groups where id = v_gid;
          if not found or v_gname is null then
            raise exception 'clone: a parameterTable block references parameter group % which no longer exists', v_gid
              using errcode = 'foreign_key_violation';
          end if;
          select id into v_tgt_gid
            from parameter_groups
           where ea_version_id = p_target_ea_version_id and organization_id = v_org and name = v_gname;
          if not found or v_tgt_gid is null then
            raise exception 'clone: parameter group "%" is not available on the target EA version', v_gname
              using errcode = 'foreign_key_violation';
          end if;
          v_new_gids := v_new_gids || v_tgt_gid;
        end loop;
        v_payload := jsonb_set(v_payload, '{groupIds}', to_jsonb(v_new_gids));
      end if;

      insert into manual_blocks
        (organization_id, manual_section_id, block_type, payload, position, image_asset_id, parameter_group_ids)
      values
        (v_org, v_new_sec, r_blk.block_type, v_payload, r_blk.position, r_blk.image_asset_id, v_new_gids);
    end loop;
  end loop;

  -- ---- structured changelog history (source_ea_version_id kept as-is)
  insert into changelog_entries
    (organization_id, manual_version_id, position, entry_type, body, source_ea_version_id, is_feature_change, open_position_impact)
  select v_org, v_new_mv, position, entry_type, body, source_ea_version_id, is_feature_change, open_position_impact
  from changelog_entries
  where manual_version_id = p_source_manual_version_id
  order by position;

  -- ---- exactly one audit row (safe metadata only)
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, v_actor, 'manual_version:clone', 'manual_version', v_new_mv,
    jsonb_build_object(
      'sourceManualVersionId',       p_source_manual_version_id,
      'newManualVersionId',          v_new_mv,
      'targetEaVersionId',           p_target_ea_version_id,
      'sourceManualVersionString',   v_src_version,
      'newManualVersionString',      p_new_version,
      'checklistTemplateVersion',    v_src_cl_ver));

  return jsonb_build_object(
    'manualId',                     v_manual,
    'newManualVersionId',           v_new_mv,
    'newVersion',                   p_new_version,
    'sourceChecklistTemplateId',    v_src_cl_tid,
    'sourceChecklistTemplateVersion', v_src_cl_ver);
end;
$$;

revoke execute on function public.clone_manual_version(uuid, uuid, text) from public, anon;
grant execute on function public.clone_manual_version(uuid, uuid, text) to authenticated, service_role;
