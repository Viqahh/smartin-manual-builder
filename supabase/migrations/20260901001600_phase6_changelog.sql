-- Phase 6 · Slice 4 — structured changelog: DRAFT-only guard, contributor provenance,
-- BREAKING-impact constraint, source-EA-version integrity, CRUD + reorder RPCs.
--
-- New file after 20260901001500 (001300 / 001400 / 001500 are NOT modified). The
-- changelog_entries table, its position UNIQUE (deferrable), the (manual_version_id,
-- organization_id) + (source_ea_version_id, organization_id) composite FKs, and the
-- SELECT-for-org-members RLS policy all shipped in 001300. This migration adds only guards,
-- a contributor trigger, one CHECK, and the write-path RPCs.
--
-- No new client INSERT/UPDATE/DELETE policy — every changelog write goes through the SECURITY
-- DEFINER RPCs below. Creating / editing / deleting / reordering a changelog entry never touches
-- manual_versions.status, review_round, submitted_content_hash, or checklist_results, and writes
-- NO audit_events row.

-- ---------------------------------------------------------------------------
-- 1. BREAKING entries must describe the open-position impact (PRD-VER-006)
-- ---------------------------------------------------------------------------
alter table changelog_entries
  add constraint changelog_breaking_needs_impact
  check (entry_type <> 'BREAKING' or length(btrim(coalesce(open_position_impact, ''))) > 0);

-- ---------------------------------------------------------------------------
-- 2. changelog is manual-version content — editable ONLY while status = DRAFT
--    (server-side; the smallest DB guard against a forged direct client write)
-- ---------------------------------------------------------------------------
create or replace function app.assert_changelog_draft()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status manual_status;
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return coalesce(new, old);
  end if;
  select status into v_status from manual_versions
   where id = coalesce(new.manual_version_id, old.manual_version_id);
  if v_status is distinct from 'DRAFT' then
    raise exception 'changelog is editable only while the manual version is DRAFT (current status: %)', v_status
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function app.assert_changelog_draft() from public;
create trigger changelog_entries_draft_guard before insert or update or delete on changelog_entries
  for each row execute function app.assert_changelog_draft();

-- ---------------------------------------------------------------------------
-- 3. contributor provenance — a changelog write records the acting user (AC-P6-6).
--    Mirrors app.record_manual_contributor(); reading changelog is not a write, so it never
--    fires. A migration / seed / service write (auth.uid() IS NULL) is skipped.
-- ---------------------------------------------------------------------------
create or replace function app.record_changelog_contributor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_version uuid := coalesce(new.manual_version_id, old.manual_version_id);
  v_org     uuid := coalesce(new.organization_id, old.organization_id);
begin
  if v_user is null or v_version is null or v_org is null then
    return coalesce(new, old);
  end if;
  insert into manual_version_contributors (organization_id, manual_version_id, user_id)
  values (v_org, v_version, v_user)
  on conflict (manual_version_id, user_id) do update
    set last_contributed_at = now(),
        contribution_count   = manual_version_contributors.contribution_count + 1;
  return coalesce(new, old);
end;
$$;
revoke execute on function app.record_changelog_contributor() from public;
create trigger changelog_entries_contributor after insert or update or delete on changelog_entries
  for each row execute function app.record_changelog_contributor();

-- ---------------------------------------------------------------------------
-- 4. source EA version integrity — same org AND same EA product lineage (§5).
--    The (source_ea_version_id, organization_id) FK already enforces same-org; this adds the
--    product-lineage check. Never clones EA facts — source_ea_version_id is a reference only.
-- ---------------------------------------------------------------------------
create or replace function app.assert_changelog_source(p_org uuid, p_manual_version_id uuid, p_source uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_product uuid;
begin
  if p_source is null then
    return;
  end if;
  select ev.ea_product_id into v_product
  from manual_versions mv
  join ea_versions ev on ev.id = mv.ea_version_id
  where mv.id = p_manual_version_id;
  if not exists (
    select 1 from ea_versions
    where id = p_source and organization_id = p_org and ea_product_id = v_product
  ) then
    raise exception 'invalid source: the changelog source EA version must belong to this organisation and the same EA product'
      using errcode = 'foreign_key_violation';
  end if;
end;
$$;
revoke execute on function app.assert_changelog_source(uuid, uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- 5. write-path RPCs (SECURITY DEFINER, app.assert_author first, revoked from public/anon)
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

create or replace function public.delete_changelog_entry(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_mv     uuid;
  v_status manual_status;
begin
  select organization_id, manual_version_id into v_org, v_mv
  from changelog_entries where id = p_id;
  if v_org is null then raise exception 'changelog entry not found' using errcode = 'no_data_found'; end if;
  select status into v_status from manual_versions where id = v_mv;

  perform app.assert_author(v_org);
  if v_status <> 'DRAFT' then
    raise exception 'changelog: entries are editable only in DRAFT (current %)', v_status using errcode = 'invalid_parameter_value'; end if;

  delete from changelog_entries where id = p_id;

  -- repack positions to 0..n-1 (the position UNIQUE is DEFERRABLE INITIALLY DEFERRED)
  with ranked as (
    select id, (row_number() over (order by position)) - 1 as np
    from changelog_entries where manual_version_id = v_mv
  )
  update changelog_entries c set position = ranked.np
  from ranked where c.id = ranked.id and c.position is distinct from ranked.np;

  return jsonb_build_object('deleted', p_id);
end;
$$;

create or replace function public.reorder_changelog_entries(p_manual_version_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_status manual_status;
  v_count  integer;
  i        integer;
begin
  select organization_id, status into v_org, v_status
  from manual_versions where id = p_manual_version_id;
  if v_org is null then raise exception 'manual version not found' using errcode = 'no_data_found'; end if;

  perform app.assert_author(v_org);
  if v_status <> 'DRAFT' then
    raise exception 'changelog: entries are editable only in DRAFT (current %)', v_status using errcode = 'invalid_parameter_value'; end if;

  select count(*) into v_count from changelog_entries where manual_version_id = p_manual_version_id;
  perform app.assert_reorder_list(p_ordered_ids, v_count);

  update changelog_entries set position = position + 1000000
  where manual_version_id = p_manual_version_id;

  for i in 1 .. array_length(p_ordered_ids, 1) loop
    update changelog_entries set position = i - 1
    where id = p_ordered_ids[i] and manual_version_id = p_manual_version_id;
    if not found then
      raise exception 'changelog: % is not an entry of this manual version', p_ordered_ids[i]
        using errcode = 'foreign_key_violation';
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE hardening (mirrors 20260901000600 / 20260901001400 / 20260901001500)
-- ---------------------------------------------------------------------------
revoke execute on function public.create_changelog_entry(uuid, text, text, uuid, boolean, text) from public, anon;
revoke execute on function public.update_changelog_entry(uuid, text, text, uuid, boolean, text) from public, anon;
revoke execute on function public.delete_changelog_entry(uuid) from public, anon;
revoke execute on function public.reorder_changelog_entries(uuid, uuid[]) from public, anon;

grant execute on function public.create_changelog_entry(uuid, text, text, uuid, boolean, text) to authenticated, service_role;
grant execute on function public.update_changelog_entry(uuid, text, text, uuid, boolean, text) to authenticated, service_role;
grant execute on function public.delete_changelog_entry(uuid) to authenticated, service_role;
grant execute on function public.reorder_changelog_entries(uuid, uuid[]) to authenticated, service_role;
