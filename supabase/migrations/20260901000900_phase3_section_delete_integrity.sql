-- Phase 3 · Section-delete integrity (follow-up to 20260901000800).
--
-- Two corrections surfaced by Phase 3 verification:
--
--   A. app.guard_required_section_delete() rejected EVERY delete of a required
--      canonical manual_section — including the delete issued by an FK cascade
--      when an authorised parent manual_version / manual is removed. That made
--      parent deletion impossible and leaked integration fixtures on DEV.
--
--   B. deleteCustomSection performed "DELETE row" then "reorder_manual_sections
--      RPC" as two separate requests. Safe (positions stay unique) but not one
--      transaction. This replaces it with a single atomic RPC.
--
-- No table shape changes. This migration is additive and idempotent
-- (create-or-replace only); 20260901000800 is left untouched.

-- ---------------------------------------------------------------------------
-- A. Cascade-aware required-section guard (AC-P2-14, corrected).
--
--   * A DIRECT `DELETE FROM manual_sections ...` fires this trigger at
--     pg_trigger_depth() = 1  -> a required, non-custom section is REJECTED.
--   * An FK CASCADE from an authorised `DELETE FROM manual_versions` / `manuals`
--     fires it at pg_trigger_depth() >= 2  -> the row is allowed through so the
--     parent delete can complete. Authorisation / org-isolation / reviewer
--     read-only on the PARENT delete are still enforced by RLS + the
--     guard_published_manual_version trigger; nothing here weakens them.
--   * Custom / non-required sections are unaffected (still freely deletable
--     when authorised).
--
-- Verified on PG17: direct delete -> depth 1; cascade from parent -> depth 2;
-- delete inside a SECURITY DEFINER function -> depth 1 (treated as direct).
-- ---------------------------------------------------------------------------
create or replace function app.guard_required_section_delete()
returns trigger
language plpgsql
as $$
begin
  -- depth > 1  =>  this DELETE is a cascade from an (already authorised) parent
  -- delete; let it proceed so manual / manual_version removal is not blocked.
  if pg_trigger_depth() > 1 then
    return old;
  end if;

  -- direct delete: a required, canonical (template) chapter can never be removed.
  if old.required and not old.is_custom then
    raise exception 'Bab wajib tidak dapat dihapus (%).', old.section_key
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

-- The BEFORE DELETE trigger from 20260901000400 already points at this function;
-- create-or-replace above is enough (no trigger drop/recreate needed).

-- ---------------------------------------------------------------------------
-- B. public.delete_custom_manual_section — ATOMIC custom-chapter delete +
--    contiguous re-pack (AC-P3-5). One PostgreSQL transaction:
--      1. author gate (app.assert_author — denies anon/PUBLIC, requires
--         DEVELOPER/ADMIN or a genuine service request)
--      2. scope check: the section exists and belongs to a manual version
--      3. refuse required / non-custom canonical sections
--      4. delete the custom section (direct delete of a CUSTOM section — the
--         guard above allows it)
--      5/6/7. two-phase position re-pack (shift +1e6, then renumber 0..n-1 in
--         the current order) behind the deferrable
--         unique (manual_version_id, position) — order preserved, unique
--         throughout, same technique as public.reorder_manual_sections
--      8. return the surviving sections: id, position, row_version
-- ---------------------------------------------------------------------------
create or replace function public.delete_custom_manual_section(p_section_id uuid)
returns table (id uuid, "position" integer, row_version bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_mv       uuid;
  v_custom   boolean;
  v_required boolean;
  v_key      text;
  i          integer := 0;
  r          record;
begin
  select ms.organization_id, ms.manual_version_id, ms.is_custom, ms.required, ms.section_key
    into v_org, v_mv, v_custom, v_required, v_key
  from manual_sections ms
  where ms.id = p_section_id;

  if v_org is null then
    raise exception 'section not found' using errcode = 'no_data_found';
  end if;

  perform app.assert_author(v_org);

  if v_required or not v_custom then
    raise exception 'Bab bawaan tidak dapat dihapus (%).', v_key
      using errcode = 'check_violation';
  end if;

  delete from manual_sections ms where ms.id = p_section_id;

  -- phase 1: lift every surviving position clear of the 0..n-1 target range
  update manual_sections ms
     set position = ms.position + 1000000
   where ms.manual_version_id = v_mv;

  -- phase 2: renumber contiguously in the existing visible order
  for r in
    select ms.id
      from manual_sections ms
     where ms.manual_version_id = v_mv
     order by ms.position
  loop
    update manual_sections ms set position = i where ms.id = r.id;
    i := i + 1;
  end loop;

  return query
    select ms.id, ms.position, ms.row_version
      from manual_sections ms
     where ms.manual_version_id = v_mv
     order by ms.position;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants — identical lockdown to 20260901000600_rpc.sql / _000800:
--   revoke from PUBLIC and anon; grant only to authenticated + service_role.
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'revoke execute on function public.delete_custom_manual_section(uuid) from public';
  execute 'revoke execute on function public.delete_custom_manual_section(uuid) from anon';
  execute 'grant execute on function public.delete_custom_manual_section(uuid) to authenticated, service_role';
end;
$$;
