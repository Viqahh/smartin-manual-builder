-- Phase 6 · Slice 6 follow-up — reconcile the pre-existing published-immutability guard.
--
-- `app.guard_published_manual_version()` (20260901000400, self-described "light guard now; full
-- Phase 6 snapshot immutability later") blocked EVERY caller — including `postgres` /
-- `service_role` — from moving a PUBLISHED row, and did not cover ARCHIVED. That made the
-- `archive_manual_version` RPC (runs as `postgres`) and trusted infra / test cleanup impossible.
--
-- Make it THE single published/archived content-immutability guard, matching the rest of the
-- Phase 6 model:
--   * trusted bypass for `postgres` / `supabase_admin` / `service_role`
--     (the archive RPC + service-role maintenance);
--   * UPDATE and DELETE are blocked for an ordinary caller when status is PUBLISHED *or* ARCHIVED.
-- The controlled PUBLISHED -> ARCHIVED transition happens only inside `archive_manual_version`
-- (SECURITY DEFINER, owner `postgres`), so it lands on the trusted-bypass path.
--
-- The slice-6 `app.guard_manual_version_update()` frozen block and
-- `app.reject_frozen_manual_version_delete()` trigger (both already carry a `not trusted` guard)
-- stay as harmless defence-in-depth.

create or replace function app.guard_published_manual_version()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.status in ('PUBLISHED', 'ARCHIVED') then
      raise exception 'Versi manual yang diterbitkan tidak dapat dihapus.'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status in ('PUBLISHED', 'ARCHIVED') then
    raise exception 'Versi manual yang diterbitkan bersifat immutable.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
