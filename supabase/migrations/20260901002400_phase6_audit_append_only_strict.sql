-- Phase 6 · final correction — `audit_events` is strictly append-only for ALL application code.
--
-- New file after 20260901002300 (01300–02300 are NOT modified).
--
-- `20260901002300` gave `app.reject_audit_mutation()` a bypass for
-- `('postgres', 'supabase_admin', 'service_role')`. `service_role` is the APPLICATION / server
-- credential (the trusted service client, `createSupabaseServiceClient()`), so with that bypass
-- normal application execution could still `DELETE` / `UPDATE` audit history — which contradicts
-- the append-only invariant AC-P6-13 / PRD-SEC-007 requires.
--
-- Corrected semantics:
--   * INSERT — unaffected. SECURITY DEFINER workflow RPCs, publish/archive RPCs, the
--     template/member audit triggers, and the Phase-5 N/A audit path all still write rows
--     (the guard triggers below are BEFORE UPDATE / BEFORE DELETE only).
--   * UPDATE / DELETE — rejected for EVERY application identity: `anon`, `authenticated`,
--     `ADMIN`, reviewer, developer, **and `service_role`**.
--   * The ONLY bypass is an actual database-owner identity (`postgres` / `supabase_admin`),
--     retained solely because PostgreSQL ownership / superuser semantics make raw DB maintenance
--     technically possible. That is outside the application trust boundary — `service_role`
--     (app/server) and `postgres` (DB maintenance authority) are NOT equivalent for this rule.
--
-- No cascade-delete risk: `audit_events.entity_id` is a plain `uuid` with NO foreign key, so
-- deleting an audited `manual_templates` / `memberships` row never removes its audit rows.
-- (`audit_events.organization_id` is `on delete cascade`, i.e. audit history is scoped to the
--  lifetime of its organisation only — deleting a whole org, not an individual entity.)

create or replace function app.reject_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- database-owner maintenance only — NOT the `service_role` application credential
  if current_user in ('postgres', 'supabase_admin') then
    return coalesce(new, old);
  end if;
  raise exception 'audit_events is append-only (INSERT only; no UPDATE / DELETE from application code, service_role included)'
    using errcode = 'restrict_violation';
end;
$$;
revoke execute on function app.reject_audit_mutation() from public;
-- triggers `audit_events_no_update` / `audit_events_no_delete` were bound in 20260901002300 and
-- now execute this corrected body.
