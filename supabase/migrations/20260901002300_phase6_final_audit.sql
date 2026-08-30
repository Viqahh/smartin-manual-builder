-- Phase 6 · Slice 7 (final gate) — audit completeness + append-only hardening (AC-P6-13, PRD-SEC-007).
--
-- New file after 20260901002200 (01300–02200 are NOT modified).
--
-- AC-P6-13 requires "every privileged action (assignment, decision, publish, archive, template
-- change, member change)" to write exactly one append-only `audit_events` row. Slices 2/5/6 cover
-- assignment / decisions / clone / publish / archive inside their SECURITY DEFINER RPCs. The
-- product has NO template-management or member-management UI (`/templates` is a static page,
-- `/settings` is read-only), but the DB DOES expose the mutation to an ADMIN:
--   * `membership_write_admin`  — `for all to authenticated using (app.is_admin(organization_id))`
--   * `template_write_admin`    — `for all to authenticated` on ORG-owned `manual_templates`
-- i.e. an authenticated ADMIN can `INSERT/UPDATE/DELETE` these rows directly through PostgREST.
-- That real privileged path had no audit. This migration adds a DB-level audit trigger for it —
-- no fake UI (spec §11/§13/§34) — plus a defensive append-only trigger on `audit_events`.

-- ---------------------------------------------------------------------------
-- 1. generic privileged-row audit trigger
--    One `audit_events` row per mutated row, for a NON-service authenticated caller only
--    (service-role / DB-owner writes — migrations, seed, trusted jobs, RPC internals — are the
--    trusted path and are skipped, exactly like every other Phase 6 guard).
--    Safe metadata only: role / is_active / key / version / title / active flag — never a body.
-- ---------------------------------------------------------------------------
create or replace function app.audit_privileged_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_base   text := tg_argv[0];               -- 'member' | 'template'
  v_op     text := lower(tg_op);             -- 'insert' | 'update' | 'delete'
  v_row    record := coalesce(new, old);
  v_org    uuid  := v_row.organization_id;
  v_meta   jsonb;
begin
  -- trusted callers (service_role / postgres / supabase_admin) use the normal server paths /
  -- migrations / seed and are never audited here.
  if app.is_service_request() then
    return coalesce(new, old);
  end if;
  if v_actor is null or v_org is null then
    return coalesce(new, old);
  end if;

  if v_base = 'member' then
    v_meta := jsonb_build_object(
      'op',          v_op,
      'targetUserId', v_row.user_id,
      'role',        v_row.role,
      'isActive',    v_row.is_active,
      'previousRole',     case when tg_op = 'UPDATE' then old.role      end,
      'previousIsActive', case when tg_op = 'UPDATE' then old.is_active end);
  else -- template
    v_meta := jsonb_build_object(
      'op',              v_op,
      'templateKind',    'manual',            -- distinct from a checklist template (spec §12)
      'key',             v_row.key,
      'version',         v_row.version,
      'title',           left(coalesce(v_row.title, ''), 200),
      'isActive',        v_row.is_active,
      'previousIsActive', case when tg_op = 'UPDATE' then old.is_active end,
      'previousVersion',  case when tg_op = 'UPDATE' then old.version   end);
  end if;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_org,
    v_actor,
    v_base || ':' || v_op,                    -- member:insert | template:update | ...
    case when v_base = 'member' then 'membership' else 'manual_template' end,
    v_row.id,
    v_meta);

  return coalesce(new, old);
end;
$$;
revoke execute on function app.audit_privileged_change() from public;

create trigger memberships_audit
  after insert or update or delete on memberships
  for each row execute function app.audit_privileged_change('member');

create trigger manual_templates_audit
  after insert or update or delete on manual_templates
  for each row execute function app.audit_privileged_change('template');

-- ---------------------------------------------------------------------------
-- 2. audit_events is append-only (spec §15).
--    RLS already grants members SELECT + INSERT only — no UPDATE / DELETE policy — so an ordinary
--    authenticated caller (incl. ADMIN) cannot mutate an audit row. This trigger makes it
--    explicit and gives a clear message; the ONLY bypass is a trusted service / DB-owner request
--    (documented cleanup boundary).
-- ---------------------------------------------------------------------------
create or replace function app.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return coalesce(new, old);
  end if;
  raise exception 'audit_events is append-only'
    using errcode = 'restrict_violation';
end;
$$;
revoke execute on function app.reject_audit_mutation() from public;
create trigger audit_events_no_update before update on audit_events
  for each row execute function app.reject_audit_mutation();
create trigger audit_events_no_delete before delete on audit_events
  for each row execute function app.reject_audit_mutation();
