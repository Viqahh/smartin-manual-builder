-- Phase 2 · Atomic creation RPCs. A single failure rolls the whole call back (spec §14).
-- Callable via PostgREST (`supabase.rpc(...)`) so they live in `public`; the bodies are
-- SECURITY DEFINER but verify the caller has active membership in the target organisation.

-- ---------------------------------------------------------------------------
-- create_ea_version_with_setups
--   p_setups: jsonb array of
--     { symbol, timeframe, presetRef, testedMinimumLot, notes, isSupported, position }
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
  if not app.has_org_access(p_org) then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;

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
      p_org,
      v_new_version,
      r_setup ->> 'symbol',
      (r_setup ->> 'timeframe')::mt_timeframe,
      nullif(r_setup ->> 'presetRef', ''),
      case when coalesce(r_setup ->> 'testedMinimumLot', '') = '' then null
           else (r_setup ->> 'testedMinimumLot')::numeric end,
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
-- create_manual_with_version
-- ---------------------------------------------------------------------------
create or replace function public.create_manual_with_version(
  p_org uuid,
  p_ea_product_id uuid,
  p_ea_version_id uuid,
  p_manual_version text,
  p_template_id uuid default null,
  p_template_version integer default 1,
  p_locale text default 'id'
)
returns table (manual_id uuid, manual_version_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manual uuid;
  v_version uuid;
  v_ea_product_of_version uuid;
begin
  if not app.has_org_access(p_org) then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;

  select ea_product_id into v_ea_product_of_version from ea_versions
  where id = p_ea_version_id and organization_id = p_org;
  if v_ea_product_of_version is null then
    raise exception 'ea version not found in organisation' using errcode = 'foreign_key_violation';
  end if;
  if v_ea_product_of_version is distinct from p_ea_product_id then
    raise exception 'ea version does not belong to the given product' using errcode = 'foreign_key_violation';
  end if;

  insert into manuals (organization_id, ea_product_id, template_id, locale)
  values (p_org, p_ea_product_id, p_template_id, coalesce(p_locale, 'id'))
  returning id into v_manual;

  insert into manual_versions (organization_id, manual_id, ea_version_id, version, status, template_version)
  values (p_org, v_manual, p_ea_version_id, p_manual_version, 'DRAFT', p_template_version)
  returning id into v_version;

  perform app.instantiate_manual_sections(v_version);

  manual_id := v_manual;
  manual_version_id := v_version;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_product_version_manual — the wizard "new EA" path (AC-P2-11), fully atomic.
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
  p_template_id uuid default null,
  p_template_version integer default 1,
  p_locale text default 'id'
)
returns table (product_id uuid, ea_version_id uuid, manual_id uuid, manual_version_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product uuid;
  v_version uuid;
  v_manual uuid;
  v_mv uuid;
begin
  if not app.has_org_access(p_org) then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;

  insert into ea_products (organization_id, owner_id, name, slug, description)
  values (p_org, p_owner, p_product_name, p_product_slug, coalesce(p_product_description, ''))
  returning id into v_product;

  v_version := public.create_ea_version_with_setups(
    p_org, v_product, p_version, p_platform, p_release_date, p_requirements, p_support, p_setups, null
  );

  select cmv.manual_id, cmv.manual_version_id
    into v_manual, v_mv
  from public.create_manual_with_version(p_org, v_product, v_version, p_manual_version, p_template_id, p_template_version, p_locale) cmv;

  product_id := v_product;
  ea_version_id := v_version;
  manual_id := v_manual;
  manual_version_id := v_mv;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (SECURITY DEFINER bodies still enforce org access)
-- ---------------------------------------------------------------------------
grant usage on schema app to authenticated, service_role;
grant execute on function public.create_ea_version_with_setups(uuid, uuid, text, ea_platform, date, jsonb, jsonb, jsonb, uuid) to authenticated, service_role;
grant execute on function public.create_manual_with_version(uuid, uuid, uuid, text, uuid, integer, text) to authenticated, service_role;
grant execute on function public.create_product_version_manual(uuid, uuid, text, text, text, text, ea_platform, date, jsonb, jsonb, jsonb, text, uuid, integer, text) to authenticated, service_role;
grant execute on function app.instantiate_manual_sections(uuid) to authenticated, service_role;
grant execute on function app.copy_parameter_definitions(uuid, uuid) to authenticated, service_role;
