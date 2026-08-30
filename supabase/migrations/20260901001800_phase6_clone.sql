-- Phase 6 · Slice 5 (part 2) — "Buat manual untuk versi baru": one atomic SECURITY DEFINER
-- transaction that clones a source Manual Version into a fresh DRAFT linked to a chosen TARGET
-- EA Version, remapping every parameterTable block's parameter-group references by group NAME
-- (unique (ea_version_id, name)). Any failure rolls the whole transaction back — no partial clone.
-- 001300 / 001400 / 001500 / 001600 / 001700 are NOT edited.
--
-- COPIED : manual-version template evidence, ordered sections (key/title/required/is_custom),
--          ordered ACTIVE blocks (payload deep-copied; parameterTable group ids + payload.groupIds
--          remapped to the target EA version), ordered structured changelog (source_ea_version_id
--          preserved — history keeps saying which EA version each change came from).
-- NOT    : status / review_round / submitted_content_hash / reviewed_at / published_at /
--          reviewer ids, reviews, review_comments, review rounds, audit_events, ai_revisions,
--          checklist_results (+ reviewer N/A overrides), published_snapshots, the source version's
--          contributors, parameter_groups / ea_parameters / ea_version_setups, and image bytes.
-- IMAGES : a cloned image block keeps the SAME image_asset_id (org-owned, private; the
--          (image_asset_id, organization_id) composite FK keeps it same-org; the block→asset FK is
--          ON DELETE SET NULL so deleting a block never deletes the shared asset). No bytes copied.

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
          -- reset per iteration: PL/pgSQL SELECT ... INTO leaves the variable UNCHANGED on 0 rows,
          -- so a stale previous value must never survive into the null-checks below.
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
      -- app.guard_parameter_table_ownership (BEFORE INSERT) re-validates v_new_gids against the
      -- TARGET EA version — a wrong remap here aborts the whole clone.
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
      'sourceManualVersionId',     p_source_manual_version_id,
      'newManualVersionId',        v_new_mv,
      'targetEaVersionId',         p_target_ea_version_id,
      'sourceManualVersionString', v_src_version,
      'newManualVersionString',    p_new_version));

  return jsonb_build_object('manualId', v_manual, 'newManualVersionId', v_new_mv, 'newVersion', p_new_version);
end;
$$;

revoke execute on function public.clone_manual_version(uuid, uuid, text) from public, anon;
grant execute on function public.clone_manual_version(uuid, uuid, text) to authenticated, service_role;
