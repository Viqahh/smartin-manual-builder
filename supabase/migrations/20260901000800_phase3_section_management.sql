-- Phase 3 · Chapter (manual_sections) management for the document editor.
--
-- Phase 2 already lets an author INSERT/UPDATE/DELETE manual_sections (role-aware RLS gated on
-- app.can_author), and app.guard_required_section_delete blocks removing a required, non-custom
-- section (AC-P2-14). Phase 3 adds:
--   1. a transactional section-reorder RPC (mirrors public.reorder_manual_blocks), and
--   2. a guard so a canonical (non-custom) section's title cannot be renamed.
--
-- No table shape changes. Custom sections are ordinary manual_sections rows with is_custom=true.

-- ---------------------------------------------------------------------------
-- Guard: only custom sections may be renamed. Canonical template titles are fixed
-- (a developer renames the CHAPTER they added, not the standard Smartin chapters).
-- AC-P3-6 / PRD-MAN-007.
-- ---------------------------------------------------------------------------
create or replace function app.guard_section_title_immutable()
returns trigger
language plpgsql
as $$
begin
  if not old.is_custom and new.title is distinct from old.title then
    raise exception 'Judul bab bawaan tidak dapat diubah (%).', old.section_key
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger manual_sections_guard_title_immutable
  before update on manual_sections
  for each row execute function app.guard_section_title_immutable();

-- ---------------------------------------------------------------------------
-- public.reorder_manual_sections: transactional full reorder of a manual version's
-- sections (AC-P3-5). Two-phase write behind the deferrable unique(manual_version_id,
-- position); assert_author + assert_reorder_list applied exactly as for blocks.
-- ---------------------------------------------------------------------------
create or replace function public.reorder_manual_sections(p_manual_version_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_actual integer;
  i integer;
begin
  select organization_id into v_org from manual_versions where id = p_manual_version_id;
  if v_org is null then raise exception 'manual version not found' using errcode = 'no_data_found'; end if;
  perform app.assert_author(v_org);

  select count(*) into v_actual from manual_sections where manual_version_id = p_manual_version_id;
  perform app.assert_reorder_list(p_ordered_ids, v_actual);

  update manual_sections set position = position + 1000000
  where manual_version_id = p_manual_version_id;

  for i in 1 .. array_length(p_ordered_ids, 1) loop
    update manual_sections set position = i - 1
    where id = p_ordered_ids[i] and manual_version_id = p_manual_version_id;
    if not found then
      raise exception 'section % is not a section of this manual version', p_ordered_ids[i]
        using errcode = 'foreign_key_violation';
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants — same lockdown pattern as 20260901000600_rpc.sql.
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'revoke execute on function public.reorder_manual_sections(uuid, uuid[]) from public';
  execute 'revoke execute on function public.reorder_manual_sections(uuid, uuid[]) from anon';
  execute 'grant execute on function public.reorder_manual_sections(uuid, uuid[]) to authenticated, service_role';
end;
$$;
