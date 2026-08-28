-- Phase 2 · Explicit Data API grants
--
-- The Supabase project uses "Automatically expose new tables" = OFF.
-- Therefore Data API roles need explicit table/function privileges.
-- RLS remains the authorization boundary for authenticated users.

-- =========================================================
-- AUTHENTICATED
-- =========================================================

-- Workspace/account tables
grant select, update
on table public.organizations
to authenticated;

grant select, update
on table public.profiles
to authenticated;

grant select, insert, update, delete
on table public.memberships
to authenticated;

grant select, insert
on table public.audit_events
to authenticated;

-- EA / manual authoring tables.
-- RLS decides which operations each role may actually perform.
grant select, insert, update, delete
on table
  public.ea_products,
  public.ea_versions,
  public.ea_version_setups,
  public.parameter_groups,
  public.ea_parameters,
  public.image_assets,
  public.manuals,
  public.manual_versions,
  public.manual_sections,
  public.manual_blocks
to authenticated;

-- Template tables.
-- RLS restricts writes to ADMIN and keeps system templates immutable.
grant select, insert, update, delete
on table
  public.manual_templates,
  public.manual_template_sections
to authenticated;


-- =========================================================
-- SERVICE ROLE
-- =========================================================

grant select, insert, update, delete
on table
  public.organizations,
  public.profiles,
  public.memberships,
  public.audit_events,
  public.ea_products,
  public.ea_versions,
  public.ea_version_setups,
  public.parameter_groups,
  public.ea_parameters,
  public.manual_templates,
  public.manual_template_sections,
  public.image_assets,
  public.manuals,
  public.manual_versions,
  public.manual_sections,
  public.manual_blocks
to service_role;


-- =========================================================
-- RLS helper functions
-- =========================================================

grant usage on schema app
to authenticated, service_role;

grant execute on function app.member_org_ids(uuid)
to authenticated, service_role;

grant execute on function app.has_org_access(uuid, uuid)
to authenticated, service_role;

grant execute on function app.member_roles(uuid, uuid)
to authenticated, service_role;

grant execute on function app.has_role(uuid, membership_role, uuid)
to authenticated, service_role;

grant execute on function app.can_author(uuid, uuid)
to authenticated, service_role;

grant execute on function app.is_admin(uuid, uuid)
to authenticated, service_role;