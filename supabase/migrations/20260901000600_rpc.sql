-- Phase 2 · Callable RPCs (PostgREST -> live in `public`).
--
-- Authorisation: every mutating RPC calls `app.assert_author(org)` FIRST
-- (defined in 20260901000100_core.sql). That gate:
--   * allows a genuine service-role request (JWT role = service_role) or the DB owner
--     (migrations / seed);
--   * DENIES an anonymous caller (auth.uid() NULL and not a service request);
--   * otherwise requires an authenticated member with DEVELOPER or ADMIN.
--
-- EXECUTE hardening: PostgreSQL grants EXECUTE to PUBLIC by default, and PUBLIC
-- includes `anon`. The grant block at the bottom REVOKEs EXECUTE from PUBLIC and
-- from `anon` on every RPC, then GRANTs only `authenticated` + `service_role`.

-- ---------------------------------------------------------------------------
-- create_ea_version_with_setups
-- ---------------------------------------------------------------------------
create or replace function public.create_ea_version_with_setups(
  p_org uuid,
  p_ea_product_id uuid,
  p_version text,
  p_platform ea_platform,
  p_release_date date,
  p_requirements jsonb,
  p_support jsonb,
  p_setups jsonb,
  p_copy_params_from uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_version uuid;
  r_setup jsonb;
  v_product_org uuid;
begin
  perform app.assert_author(p_org);

  select organization_id into v_product_org from ea_products where id = p_ea_product_id;
  if v_product_org is distinct from p_org then
    raise exception 'ea product not in organisation' using errcode = 'foreign_key_violation';
  end if;

  insert into ea_versions (organization_id, ea_product_id, version, platform, release_date, requirements, support)
  values (p_org, p_ea_product_id, p_version, p_platform, p_release_date, coalesce(p_requirements, '{}'::jsonb), coalesce(p_support, '{}'::jsonb))
  returning id into v_new_version;

  for r_setup in select * from jsonb_array_elements(coalesce(p_setups, '[]'::jsonb))
  loop
    insert into ea_version_setups (
      organization_id, ea_version_id, symbol, timeframe, preset_ref, tested_minimum_lot, notes, is_supported, position
    ) values (
      p_org, v_new_version,
      r_setup ->> 'symbol',
      (r_setup ->> 'timeframe')::mt_timeframe,
      nullif(r_setup ->> 'presetRef', ''),
      case when coalesce(r_setup ->> 'testedMinimumLot', '') = '' then null else (r_setup ->> 'testedMinimumLot')::numeric end,
      nullif(r_setup ->> 'notes', ''),
      coalesce((r_setup ->> 'isSupported')::boolean, true),
      coalesce((r_setup ->> 'position')::integer, 0)
    );
  end loop;

  if p_copy_params_from is not null then
    perform app.copy_parameter_definitions(p_copy_params_from, v_new_version);
  end if;

  return v_new_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- replace_ea_version_setups — ATOMIC full-list replace (AC-P2-9b / spec §5).
-- ---------------------------------------------------------------------------
create or replace function public.replace_ea_version_setups(
  p_org uuid,
  p_ea_version_id uuid,
  p_setups jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r_setup jsonb;
  v_pos integer := 0;
  v_count integer := 0;
  v_version_org uuid;
begin
  perform app.assert_author(p_org);

  select organization_id into v_version_org from ea_versions where id = p_ea_version_id;
  if v_version_org is distinct from p_org then
    raise exception 'ea version not in organisation' using errcode = 'foreign_key_violation';
  end if;
  if jsonb_typeof(p_setups) <> 'array' or jsonb_array_length(p_setups) = 0 then
    raise exception 'at least one supported configuration is required' using errcode = 'check_violation';
  end if;

  delete from ea_version_setups where ea_version_id = p_ea_version_id;

  for r_setup in select * from jsonb_array_elements(p_setups)
  loop
    insert into ea_version_setups (
      organization_id, ea_version_id, symbol, timeframe, preset_ref, tested_minimum_lot, notes, is_supported, position
    ) values (
      p_org, p_ea_version_id,
      r_setup ->> 'symbol',
      (r_setup ->> 'timeframe')::mt_timeframe,
      nullif(r_setup ->> 'presetRef', ''),
      case when coalesce(r_setup ->> 'testedMinimumLot', '') = '' then null else (r_setup ->> 'testedMinimumLot')::numeric end,
      nullif(r_setup ->> 'notes', ''),
      coalesce((r_setup ->> 'isSupported')::boolean, true),
      v_pos
    );
    v_pos := v_pos + 1;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_manual_with_version — records template_id + template_version on the
-- Manual Version as immutable creation evidence; instantiates from that exact
-- template version (AC-P2-10/26). Callers pass a concrete `p_template_id`;
-- the active system template is only a defensive fallback.
-- ---------------------------------------------------------------------------
create or replace function public.create_manual_with_version(
  p_org uuid,
  p_ea_product_id uuid,
  p_ea_version_id uuid,
  p_manual_version text,
  p_template_id uuid default null,
  p_locale text default 'id'
)
returns table (manual_id uuid, manual_version_id uuid, template_id uuid, template_version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manual uuid;
  v_version uuid;
  v_ea_product_of_version uuid;
  v_template uuid;
  v_template_version integer;
begin
  perform app.assert_author(p_org);

  select ea_product_id into v_ea_product_of_version from ea_versions
  where id = p_ea_version_id and organization_id = p_org;
  if v_ea_product_of_version is null then
    raise exception 'ea version not found in organisation' using errcode = 'foreign_key_violation';
  end if;
  if v_ea_product_of_version is distinct from p_ea_product_id then
    raise exception 'ea version does not belong to the given product' using errcode = 'foreign_key_violation';
  end if;

  if p_template_id is not null then
    select mt.id, mt.version into v_template, v_template_version
    from manual_templates mt
    where mt.id = p_template_id and (mt.organization_id is null or mt.organization_id = p_org);
  else
    select mt.id, mt.version into v_template, v_template_version
    from manual_templates mt
    where mt.organization_id is null and mt.key = 'smartin-ea-manual' and mt.is_active
    order by mt.version desc
    limit 1;
  end if;
  if v_template is null then
    raise exception 'no manual template available' using errcode = 'no_data_found';
  end if;

  insert into manuals (organization_id, ea_product_id, template_id, locale)
  values (p_org, p_ea_product_id, v_template, coalesce(p_locale, 'id'))
  returning id into v_manual;

  insert into manual_versions (organization_id, manual_id, ea_version_id, version, status, template_id, template_version)
  values (p_org, v_manual, p_ea_version_id, p_manual_version, 'DRAFT', v_template, v_template_version)
  returning id into v_version;

  perform app.instantiate_sections_from_template(v_version, v_template);

  manual_id := v_manual;
  manual_version_id := v_version;
  template_id := v_template;
  template_version := v_template_version;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_product_version_manual — the wizard "new EA" path (AC-P2-11), fully atomic.
-- Takes an explicit `p_template_id` — no internal null.
-- ---------------------------------------------------------------------------
create or replace function public.create_product_version_manual(
  p_org uuid,
  p_owner uuid,
  p_product_name text,
  p_product_slug text,
  p_product_description text,
  p_version text,
  p_platform ea_platform,
  p_release_date date,
  p_requirements jsonb,
  p_support jsonb,
  p_setups jsonb,
  p_manual_version text,
  p_template_id uuid,
  p_locale text default 'id'
)
returns table (product_id uuid, ea_version_id uuid, manual_id uuid, manual_version_id uuid, template_version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product uuid;
  v_version uuid;
  v_row record;
begin
  perform app.assert_author(p_org);
  if p_template_id is null then
    raise exception 'template id is required' using errcode = 'null_value_not_allowed';
  end if;

  insert into ea_products (organization_id, owner_id, name, slug, description)
  values (p_org, p_owner, p_product_name, p_product_slug, coalesce(p_product_description, ''))
  returning id into v_product;

  v_version := public.create_ea_version_with_setups(
    p_org, v_product, p_version, p_platform, p_release_date, p_requirements, p_support, p_setups, null
  );

  select * into v_row
  from public.create_manual_with_version(p_org, v_product, v_version, p_manual_version, p_template_id, p_locale);

  product_id := v_product;
  ea_version_id := v_version;
  manual_id := v_row.manual_id;
  manual_version_id := v_row.manual_version_id;
  template_version := v_row.template_version;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Transactional reorder helpers.
-- Each independently verifies the ordered id list against the CURRENT rows:
--   * no NULLs, no duplicates
--   * exact count == number of live target rows
--   * no foreign id (every id is a live row of the target parent)
--   * (count match + subset + no dupes  ==>  exact permutation, none omitted)
-- Two-phase update (shift to a high offset, then 0..n-1) keeps positions unique.
-- The whole function is one transaction: any failure rolls back the original order.
-- ---------------------------------------------------------------------------
create or replace function app.assert_reorder_list(p_ids uuid[], p_current_count integer)
returns void
language plpgsql
immutable
as $$
declare
  n integer := coalesce(array_length(p_ids, 1), 0);
begin
  if n = 0 then
    raise exception 'reorder list is empty' using errcode = 'check_violation';
  end if;
  if exists (select 1 from unnest(p_ids) x where x is null) then
    raise exception 'reorder list contains a null id' using errcode = 'check_violation';
  end if;
  if (select count(distinct x) from unnest(p_ids) x) <> n then
    raise exception 'reorder list contains duplicate ids' using errcode = 'check_violation';
  end if;
  if n <> p_current_count then
    raise exception 'reorder list count (%) does not match the current rows (%)', n, p_current_count
      using errcode = 'check_violation';
  end if;
end;
$$;
revoke execute on function app.assert_reorder_list(uuid[], integer) from public;

create or replace function public.reorder_manual_blocks(p_section_id uuid, p_ordered_ids uuid[])
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
  select organization_id into v_org from manual_sections where id = p_section_id;
  if v_org is null then raise exception 'section not found' using errcode = 'no_data_found'; end if;
  perform app.assert_author(v_org);

  select count(*) into v_actual from manual_blocks where manual_section_id = p_section_id and deleted_at is null;
  perform app.assert_reorder_list(p_ordered_ids, v_actual);

  update manual_blocks set position = position + 1000000
  where manual_section_id = p_section_id and deleted_at is null;

  for i in 1 .. array_length(p_ordered_ids, 1) loop
    update manual_blocks set position = i - 1
    where id = p_ordered_ids[i] and manual_section_id = p_section_id and deleted_at is null;
    if not found then
      raise exception 'block % is not a live block of this section', p_ordered_ids[i]
        using errcode = 'foreign_key_violation';
    end if;
  end loop;
end;
$$;

create or replace function public.reorder_parameter_groups(p_ea_version_id uuid, p_ordered_ids uuid[])
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
  select organization_id into v_org from ea_versions where id = p_ea_version_id;
  if v_org is null then raise exception 'ea version not found' using errcode = 'no_data_found'; end if;
  perform app.assert_author(v_org);

  select count(*) into v_actual from parameter_groups where ea_version_id = p_ea_version_id;
  perform app.assert_reorder_list(p_ordered_ids, v_actual);

  update parameter_groups set position = position + 1000000 where ea_version_id = p_ea_version_id;
  for i in 1 .. array_length(p_ordered_ids, 1) loop
    update parameter_groups set position = i - 1
    where id = p_ordered_ids[i] and ea_version_id = p_ea_version_id;
    if not found then
      raise exception 'group % not in this ea version', p_ordered_ids[i] using errcode = 'foreign_key_violation';
    end if;
  end loop;
end;
$$;

create or replace function public.reorder_ea_parameters(p_group_id uuid, p_ordered_ids uuid[])
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
  select organization_id into v_org from parameter_groups where id = p_group_id;
  if v_org is null then raise exception 'group not found' using errcode = 'no_data_found'; end if;
  perform app.assert_author(v_org);

  select count(*) into v_actual from ea_parameters where parameter_group_id = p_group_id;
  perform app.assert_reorder_list(p_ordered_ids, v_actual);

  update ea_parameters set position = position + 1000000 where parameter_group_id = p_group_id;
  for i in 1 .. array_length(p_ordered_ids, 1) loop
    update ea_parameters set position = i - 1
    where id = p_ordered_ids[i] and parameter_group_id = p_group_id;
    if not found then
      raise exception 'parameter % not in this group', p_ordered_ids[i] using errcode = 'foreign_key_violation';
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants — explicitly strip PUBLIC's + anon's default EXECUTE, then grant only
-- the intended roles. Applies to every public RPC and every privileged app.* helper.
-- ---------------------------------------------------------------------------
grant usage on schema app to authenticated, service_role; -- RLS references app.can_author / app.member_org_ids / app.is_admin

do $$
declare
  fn text;
  public_rpcs text[] := array[
    'public.create_ea_version_with_setups(uuid, uuid, text, ea_platform, date, jsonb, jsonb, jsonb, uuid)',
    'public.replace_ea_version_setups(uuid, uuid, jsonb)',
    'public.create_manual_with_version(uuid, uuid, uuid, text, uuid, text)',
    'public.create_product_version_manual(uuid, uuid, text, text, text, text, ea_platform, date, jsonb, jsonb, jsonb, text, uuid, text)',
    'public.reorder_manual_blocks(uuid, uuid[])',
    'public.reorder_parameter_groups(uuid, uuid[])',
    'public.reorder_ea_parameters(uuid, uuid[])'
  ];
  app_helpers text[] := array[
    'app.assert_author(uuid)',
    'app.assert_reorder_list(uuid[], integer)',
    'app.is_service_request()',
    'app.instantiate_manual_sections(uuid)',
    'app.instantiate_sections_from_template(uuid, uuid)',
    'app.copy_parameter_definitions(uuid, uuid)'
  ];
begin
  foreach fn in array public_rpcs loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
  foreach fn in array app_helpers loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
