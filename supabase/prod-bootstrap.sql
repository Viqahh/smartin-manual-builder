-- ===========================================================================
-- Production bootstrap  (Phase 8A.5 · option 8.5(a))  —  RUN ONCE, MANUALLY.
--
-- This is NOT a migration. It is never run by `supabase db push` and never on DEV.
-- It creates ONE real organisation and grants the first ADMIN membership to an
-- account that already signed up through the deployed app.
--
-- It does NOT create auth users and does NOT insert any demo / sample / UAT data.
--
-- Prerequisites:
--   1. Migrations 1–31 applied to Production.
--   2. The first admin auth user has been created MANUALLY in the Production project's
--      Auth dashboard (NOT via the deployed app — the live Production deployment still
--      points at DEV until cutover). The on_auth_user_created trigger then creates the
--      matching public.profiles row; verify it exists before running this.
--
-- Keep this file a TEMPLATE in git: never commit a real admin email, organisation name,
-- slug, UUID, password, or any credential. Fill the values in only at run time.
--
-- Usage:
--   - Edit the three values in the DECLARE block below (do not commit the edit).
--   - Run against Production exactly once. Either:
--       * paste this file into the Production project's SQL editor, or
--       * supabase link --project-ref wotidyhpbltoxmzvdqkj
--         supabase db query --linked -f supabase/prod-bootstrap.sql
--         supabase link --project-ref tmrwhkhydkjaubpuegqa   # re-link back to DEV afterwards
--
-- Idempotent: re-running with the same values is a no-op.
-- ===========================================================================

do $$
declare
  -- >>> EDIT THESE THREE VALUES <<<
  v_admin_email text := 'CHANGE_ME@example.com';        -- the signed-up admin's email
  v_org_name    text := 'CHANGE_ME Organisation Name';  -- 2–160 chars
  v_org_slug    text := 'change-me';                    -- lower-case, digits, single hyphens

  v_user_id uuid;
  v_org_id  uuid;
begin
  if v_admin_email = 'CHANGE_ME@example.com' then
    raise exception 'Edit the DECLARE block first (admin email / org name / org slug).';
  end if;

  select id into v_user_id
  from public.profiles
  where lower(email) = lower(v_admin_email);

  if v_user_id is null then
    raise exception
      'No public.profiles row for %. The admin must sign up through the deployed app first.',
      v_admin_email;
  end if;

  -- One organisation, keyed by slug (unique). Re-run updates the display name only.
  insert into public.organizations (name, slug)
  values (v_org_name, v_org_slug)
  on conflict (slug) do update set name = excluded.name
  returning id into v_org_id;

  if v_org_id is null then
    select id into v_org_id from public.organizations where slug = v_org_slug;
  end if;

  -- First ADMIN membership (one row per org/user/role; re-run is a no-op).
  insert into public.memberships (organization_id, user_id, role)
  values (v_org_id, v_user_id, 'ADMIN')
  on conflict (organization_id, user_id, role) do nothing;

  raise notice 'Bootstrapped organisation "%" (%) with ADMIN %.', v_org_name, v_org_id, v_admin_email;
end $$;

-- Verify:
--   select o.slug, o.name, m.role, p.email
--   from public.memberships m
--   join public.organizations o on o.id = m.organization_id
--   join public.profiles p on p.id = m.user_id;
