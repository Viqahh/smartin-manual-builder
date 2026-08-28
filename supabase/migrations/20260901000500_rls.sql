-- Phase 2 · Row Level Security — ROLE-AWARE (PRD-SEC-002/003, AC-P2-21/22).
--
-- RLS mirrors the approved action/role model so a TECHNICAL_REVIEWER or
-- COMPLIANCE_REVIEWER cannot bypass the Next.js server actions by calling
-- Supabase REST/client directly:
--   * SELECT on EA/manual content -> any active member of the organisation
--   * INSERT/UPDATE/DELETE on EA/manual content -> app.can_author() only
--       (DEVELOPER or ADMIN; reviewers are read-only in Phase 2)
--   * memberships / organisations / org templates -> app.is_admin() writes
--   * audit_events -> append only
--   * cross-org access remains impossible for every role
-- The service-role key bypasses RLS and is used only by trusted server jobs.

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere in `public`
-- ---------------------------------------------------------------------------
alter table organizations            enable row level security;
alter table profiles                 enable row level security;
alter table memberships              enable row level security;
alter table audit_events             enable row level security;
alter table ea_products              enable row level security;
alter table ea_versions              enable row level security;
alter table ea_version_setups        enable row level security;
alter table parameter_groups         enable row level security;
alter table ea_parameters            enable row level security;
alter table manual_templates         enable row level security;
alter table manual_template_sections enable row level security;
alter table image_assets             enable row level security;
alter table manuals                  enable row level security;
alter table manual_versions          enable row level security;
alter table manual_sections          enable row level security;
alter table manual_blocks            enable row level security;

-- ---------------------------------------------------------------------------
-- organizations / profiles / memberships
-- ---------------------------------------------------------------------------
create policy org_select_members on organizations
  for select to authenticated
  using (id in (select app.member_org_ids()));

create policy org_update_admin on organizations
  for update to authenticated
  using (app.is_admin(id))
  with check (app.is_admin(id));

create policy profile_select_self_or_shared_org on profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from memberships m_self
      join memberships m_other on m_other.organization_id = m_self.organization_id
      where m_self.user_id = auth.uid() and m_self.is_active
        and m_other.user_id = profiles.id and m_other.is_active
    )
  );

create policy profile_update_self on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy membership_select_members on memberships
  for select to authenticated
  using (organization_id in (select app.member_org_ids()));

create policy membership_write_admin on memberships
  for all to authenticated
  using (app.is_admin(organization_id))
  with check (app.is_admin(organization_id));

-- ---------------------------------------------------------------------------
-- audit_events — members read; members insert; NO update/delete policy
-- ---------------------------------------------------------------------------
create policy audit_select_members on audit_events
  for select to authenticated
  using (organization_id in (select app.member_org_ids()));

create policy audit_insert_members on audit_events
  for insert to authenticated
  with check (organization_id in (select app.member_org_ids()));

-- ---------------------------------------------------------------------------
-- EA / manual content tables:
--   SELECT  -> any active member of the org
--   INSERT/UPDATE/DELETE -> app.can_author(org) (DEVELOPER or ADMIN) only
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  content_tables text[] := array[
    'ea_products', 'ea_versions', 'ea_version_setups', 'parameter_groups', 'ea_parameters',
    'image_assets', 'manuals', 'manual_versions', 'manual_sections', 'manual_blocks'
  ];
begin
  foreach t in array content_tables loop
    execute format(
      'create policy %I on %I for select to authenticated using (organization_id in (select app.member_org_ids()))',
      t || '_select_members', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (app.can_author(organization_id))',
      t || '_insert_authors', t);
    execute format(
      'create policy %I on %I for update to authenticated using (app.can_author(organization_id)) with check (app.can_author(organization_id))',
      t || '_update_authors', t);
    execute format(
      'create policy %I on %I for delete to authenticated using (app.can_author(organization_id))',
      t || '_delete_authors', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- manual_templates: system templates (org NULL) readable by all authenticated;
-- org templates scoped to members; writes ADMIN only. System template rows are
-- installed by migration and are immutable to every client role.
-- ---------------------------------------------------------------------------
create policy template_select on manual_templates
  for select to authenticated
  using (organization_id is null or organization_id in (select app.member_org_ids()));

create policy template_write_admin on manual_templates
  for all to authenticated
  using (organization_id is not null and app.is_admin(organization_id))
  with check (organization_id is not null and app.is_admin(organization_id));

create policy template_section_select on manual_template_sections
  for select to authenticated
  using (
    exists (
      select 1 from manual_templates mt
      where mt.id = manual_template_sections.template_id
        and (mt.organization_id is null or mt.organization_id in (select app.member_org_ids()))
    )
  );

create policy template_section_write_admin on manual_template_sections
  for all to authenticated
  using (
    exists (
      select 1 from manual_templates mt
      where mt.id = manual_template_sections.template_id
        and mt.organization_id is not null and app.is_admin(mt.organization_id)
    )
  )
  with check (
    exists (
      select 1 from manual_templates mt
      where mt.id = manual_template_sections.template_id
        and mt.organization_id is not null and app.is_admin(mt.organization_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Storage: private bucket for draft manual images. Path convention
--   <organization_id>/<image_asset_id>.<ext>
--   read  -> any member of that org
--   write -> app.can_author() of that org (reviewers cannot upload)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('manual-images', 'manual-images', false)
on conflict (id) do nothing;

create policy manual_images_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'manual-images'
    and (split_part(name, '/', 1))::uuid in (select app.member_org_ids())
  );

create policy manual_images_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'manual-images'
    and app.can_author((split_part(name, '/', 1))::uuid)
  );

create policy manual_images_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'manual-images'
    and app.can_author((split_part(name, '/', 1))::uuid)
  );

create policy manual_images_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'manual-images'
    and app.can_author((split_part(name, '/', 1))::uuid)
  );
