-- Phase 6 · Slice 5 (part 1) — structured changelog: source EA version is now MANDATORY.
--
-- PRD-VER-006 requires every structured changelog entry to record which EA version the change
-- came from. Slice 4 shipped the column nullable; this migration backfills, hardens the FK, sets
-- NOT NULL, and re-checks it in the CRUD RPCs. 001300 / 001400 / 001500 / 001600 are NOT edited.

-- ---------------------------------------------------------------------------
-- 1. deterministic backfill — an entry already belongs to a manual version, whose linked
--    ea_version_id is the only correct answer for a NULL source.
-- ---------------------------------------------------------------------------
update changelog_entries ce
set source_ea_version_id = mv.ea_version_id
from manual_versions mv
where ce.manual_version_id = mv.id and ce.source_ea_version_id is null;

-- ---------------------------------------------------------------------------
-- 2. a NOT NULL column cannot be nulled by an FK action — swap ON DELETE SET NULL for RESTRICT
--    (consistent with manual_versions.ea_version_id). Same-org + same-product-lineage validation
--    stays in app.assert_changelog_source.
-- ---------------------------------------------------------------------------
alter table changelog_entries
  drop constraint changelog_entries_source_ea_version_id_organization_id_fkey;
alter table changelog_entries
  add constraint changelog_entries_source_ea_version_id_organization_id_fkey
  foreign key (source_ea_version_id, organization_id)
  references ea_versions (id, organization_id) on delete restrict;

alter table changelog_entries alter column source_ea_version_id set not null;

-- ---------------------------------------------------------------------------
-- 3. RPC re-check — reject a missing source explicitly (a clearer error than a NOT NULL violation)
-- ---------------------------------------------------------------------------
create or replace function public.create_changelog_entry(
  p_manual_version_id    uuid,
  p_entry_type           text,
  p_body                 text,
  p_source_ea_version_id uuid,
  p_is_feature_change    boolean,
  p_open_position_impact text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_status manual_status;
  v_body   text := btrim(coalesce(p_body, ''));
  v_impact text := nullif(btrim(coalesce(p_open_position_impact, '')), '');
  v_pos    integer;
  v_id     uuid;
begin
  select organization_id, status into v_org, v_status
  from manual_versions where id = p_manual_version_id;
  if v_org is null then raise exception 'manual version not found' using errcode = 'no_data_found'; end if;

  perform app.assert_author(v_org);
  if v_status <> 'DRAFT' then
    raise exception 'changelog: entries are editable only in DRAFT (current %)', v_status using errcode = 'invalid_parameter_value'; end if;
  if p_entry_type not in ('ADDED', 'CHANGED', 'FIXED', 'BREAKING') then
    raise exception 'changelog: unknown entry type' using errcode = 'invalid_parameter_value'; end if;
  if length(v_body) < 1 or length(v_body) > 4000 then
    raise exception 'changelog: the change description must be 1..4000 characters' using errcode = 'invalid_parameter_value'; end if;
  if p_entry_type = 'BREAKING' and v_impact is null then
    raise exception 'changelog: a BREAKING entry must describe the impact on users with open positions' using errcode = 'invalid_parameter_value'; end if;
  if p_source_ea_version_id is null then
    raise exception 'changelog: the source EA version is required' using errcode = 'invalid_parameter_value'; end if;
  perform app.assert_changelog_source(v_org, p_manual_version_id, p_source_ea_version_id);

  select coalesce(max(position) + 1, 0) into v_pos
  from changelog_entries where manual_version_id = p_manual_version_id;

  insert into changelog_entries
    (organization_id, manual_version_id, position, entry_type, body, source_ea_version_id, is_feature_change, open_position_impact)
  values
    (v_org, p_manual_version_id, v_pos, p_entry_type, v_body, p_source_ea_version_id, coalesce(p_is_feature_change, false), v_impact)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'position', v_pos);
end;
$$;

create or replace function public.update_changelog_entry(
  p_id                   uuid,
  p_entry_type           text,
  p_body                 text,
  p_source_ea_version_id uuid,
  p_is_feature_change    boolean,
  p_open_position_impact text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_mv     uuid;
  v_status manual_status;
  v_body   text := btrim(coalesce(p_body, ''));
  v_impact text := nullif(btrim(coalesce(p_open_position_impact, '')), '');
begin
  select organization_id, manual_version_id into v_org, v_mv
  from changelog_entries where id = p_id;
  if v_org is null then raise exception 'changelog entry not found' using errcode = 'no_data_found'; end if;
  select status into v_status from manual_versions where id = v_mv;

  perform app.assert_author(v_org);
  if v_status <> 'DRAFT' then
    raise exception 'changelog: entries are editable only in DRAFT (current %)', v_status using errcode = 'invalid_parameter_value'; end if;
  if p_entry_type not in ('ADDED', 'CHANGED', 'FIXED', 'BREAKING') then
    raise exception 'changelog: unknown entry type' using errcode = 'invalid_parameter_value'; end if;
  if length(v_body) < 1 or length(v_body) > 4000 then
    raise exception 'changelog: the change description must be 1..4000 characters' using errcode = 'invalid_parameter_value'; end if;
  if p_entry_type = 'BREAKING' and v_impact is null then
    raise exception 'changelog: a BREAKING entry must describe the impact on users with open positions' using errcode = 'invalid_parameter_value'; end if;
  if p_source_ea_version_id is null then
    raise exception 'changelog: the source EA version is required' using errcode = 'invalid_parameter_value'; end if;
  perform app.assert_changelog_source(v_org, v_mv, p_source_ea_version_id);

  update changelog_entries
    set entry_type           = p_entry_type,
        body                 = v_body,
        source_ea_version_id = p_source_ea_version_id,
        is_feature_change    = coalesce(p_is_feature_change, false),
        open_position_impact = v_impact
  where id = p_id;

  return jsonb_build_object('id', p_id);
end;
$$;
