-- Phase 2 · Domain functions & guard triggers.
-- Enforce invariants in the database, not only the frontend (spec §7).

-- ---------------------------------------------------------------------------
-- instantiate_sections_from_template: seed a freshly created ManualVersion's
-- sections from a SPECIFIC manual_templates row's manual_template_sections
-- (PRD-MAN-006, AC-P2-10/26). The canonical system template + its 18 sections
-- are installed by 20260901000350_system_template.sql.
--
-- SECURITY: this helper mutates manual_sections, so it verifies the caller has
-- authoring access to the manual version's organisation — a caller who merely
-- knows a UUID of another org's manual version cannot use it (spec §2).
-- ---------------------------------------------------------------------------
create or replace function app.instantiate_sections_from_template(
  p_manual_version_id uuid,
  p_template_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from manual_versions where id = p_manual_version_id;
  if v_org is null then
    raise exception 'manual version % not found', p_manual_version_id;
  end if;
  -- auth.uid() is NULL for trusted backend sessions (service_role / seed / migrations).
  if auth.uid() is not null and not app.can_author(v_org) then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from manual_templates where id = p_template_id) then
    raise exception 'manual template % not found', p_template_id;
  end if;

  insert into manual_sections (organization_id, manual_version_id, section_key, title, required, is_custom, position)
  select v_org, p_manual_version_id, ts.section_key, ts.title, ts.required, false, ts.position
  from manual_template_sections ts
  where ts.template_id = p_template_id
  on conflict (manual_version_id, section_key) do nothing;

  if not found then
    raise exception 'manual template % has no sections', p_template_id;
  end if;
end;
$$;

-- Back-compat shim: resolve the active system template, then delegate.
create or replace function app.instantiate_manual_sections(p_manual_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template uuid;
begin
  select id into v_template
  from manual_templates
  where organization_id is null and key = 'smartin-ea-manual' and is_active
  order by version desc
  limit 1;
  if v_template is null then
    raise exception 'no active system manual template installed';
  end if;
  perform app.instantiate_sections_from_template(p_manual_version_id, v_template);
end;
$$;

-- ---------------------------------------------------------------------------
-- Guard: a required, non-custom template section cannot be deleted (AC-P2-14).
-- Custom sections a developer added may be removed.
-- ---------------------------------------------------------------------------
create or replace function app.guard_required_section_delete()
returns trigger
language plpgsql
as $$
begin
  if old.required and not old.is_custom then
    raise exception 'Bab wajib tidak dapat dihapus (%).', old.section_key
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger manual_sections_guard_required_delete
  before delete on manual_sections
  for each row execute function app.guard_required_section_delete();

-- ---------------------------------------------------------------------------
-- Guard: a PUBLISHED manual version is immutable except for a controlled move
-- to ARCHIVED (light guard now; full Phase 6 snapshot immutability later).
-- ---------------------------------------------------------------------------
create or replace function app.guard_published_manual_version()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'PUBLISHED' then
      raise exception 'Versi manual yang diterbitkan tidak dapat dihapus.'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status = 'PUBLISHED' and new.status not in ('PUBLISHED', 'ARCHIVED') then
    raise exception 'Versi manual yang diterbitkan bersifat immutable.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger manual_versions_guard_published
  before update or delete on manual_versions
  for each row execute function app.guard_published_manual_version();

-- ---------------------------------------------------------------------------
-- Guard: a parameterTable block may only reference parameter_groups that belong
-- to the manual version's linked EA version (GI-11, AC-P2-18a).
-- ---------------------------------------------------------------------------
create or replace function app.guard_parameter_table_ownership()
returns trigger
language plpgsql
as $$
declare
  v_ea_version uuid;
  v_bad_count integer;
begin
  if new.block_type <> 'parameterTable' then
    return new;
  end if;
  if coalesce(array_length(new.parameter_group_ids, 1), 0) = 0 then
    return new;
  end if;

  select mv.ea_version_id
    into v_ea_version
  from manual_sections ms
  join manual_versions mv on mv.id = ms.manual_version_id
  where ms.id = new.manual_section_id;

  select count(*)
    into v_bad_count
  from unnest(new.parameter_group_ids) as gid
  left join parameter_groups pg on pg.id = gid
  where pg.id is null or pg.ea_version_id is distinct from v_ea_version;

  if v_bad_count > 0 then
    raise exception 'parameterTable hanya boleh mereferensikan grup parameter dari EA Version yang terkait.'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger manual_blocks_guard_parameter_table
  before insert or update on manual_blocks
  for each row execute function app.guard_parameter_table_ownership();

-- ---------------------------------------------------------------------------
-- copy_parameter_definitions: EA-version -> EA-version copy only (AC-P2-18c).
-- Never touches manual versions.
--
-- SECURITY: BOTH the source and the target EA version must belong to the SAME
-- organisation, and the caller must have authoring access to it. A caller who
-- knows another org's EA-version UUID cannot copy its parameter definitions
-- across an organisation boundary (spec §2).
-- ---------------------------------------------------------------------------
create or replace function app.copy_parameter_definitions(p_source_ea_version uuid, p_target_ea_version uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_org uuid;
  v_target_org uuid;
  r_group record;
  v_new_group uuid;
begin
  select organization_id into v_source_org from ea_versions where id = p_source_ea_version;
  select organization_id into v_target_org from ea_versions where id = p_target_ea_version;
  if v_source_org is null then
    raise exception 'source EA version % not found', p_source_ea_version;
  end if;
  if v_target_org is null then
    raise exception 'target EA version % not found', p_target_ea_version;
  end if;
  if v_source_org is distinct from v_target_org then
    raise exception 'cross-organisation parameter copy is not allowed'
      using errcode = 'insufficient_privilege';
  end if;
  -- auth.uid() is NULL for trusted backend sessions.
  if auth.uid() is not null and not app.can_author(v_target_org) then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;

  for r_group in
    select * from parameter_groups where ea_version_id = p_source_ea_version order by position
  loop
    insert into parameter_groups (organization_id, ea_version_id, name, position)
    values (v_target_org, p_target_ea_version, r_group.name, r_group.position)
    returning id into v_new_group;

    insert into ea_parameters (
      organization_id, parameter_group_id, display_name, technical_name, param_type,
      default_value, unit, min_value, max_value, enum_options, safe_range, description,
      order_effect, mutability, notes, required, position
    )
    select
      v_target_org, v_new_group, display_name, technical_name, param_type,
      default_value, unit, min_value, max_value, enum_options, safe_range, description,
      order_effect, mutability, notes, required, position
    from ea_parameters where parameter_group_id = r_group.id;
  end loop;
end;
$$;
