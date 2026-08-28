-- Phase 2 · Row Level Security. Organisation isolation as defence in depth (PRD-SEC-002, AC-P2-21).
-- Server actions ALSO check the action-based permission map; RLS guarantees no cross-org read/write
-- even if a server check is missed. The service-role key bypasses RLS and is used only by trusted
-- server jobs (seeding, atomic multi-table creation) — never shipped to the browser.

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere in `public`
-- ---------------------------------------------------------------------------
alter table organizations           enable row level security;
alter table profiles                enable row level security;
alter table memberships             enable row level security;
alter table audit_events            enable row level security;
alter table ea_products             enable row level security;
alter table ea_versions             enable row level security;
alter table ea_version_setups       enable row level security;
alter table parameter_groups        enable row level security;
alter table ea_parameters           enable row level security;
alter table manual_templates        enable row level security;
alter table manual_template_sections enable row level security;
alter table image_assets            enable row level security;
alter table manuals                 enable row level security;
alter table manual_versions         enable row level security;
alter table manual_sections         enable row level security;
alter table manual_blocks           enable row level security;

-- ---------------------------------------------------------------------------
-- organizations / profiles / memberships
-- ---------------------------------------------------------------------------
create policy org_select_members on organizations
  for select to authenticated
  using (id in (select app.member_org_ids()));

create policy org_update_admin on organizations
  for update to authenticated
  using (app.member_role(id) = 'ADMIN')
  with check (app.member_role(id) = 'ADMIN');

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
  using (app.member_role(organization_id) = 'ADMIN')
  with check (app.member_role(organization_id) = 'ADMIN');

-- ---------------------------------------------------------------------------
-- audit_events — members read; members insert; NO update/delete policy (append only)
-- ---------------------------------------------------------------------------
create policy audit_select_members on audit_events
  for select to authenticated
  using (organization_id in (select app.member_org_ids()));

create policy audit_insert_members on audit_events
  for insert to authenticated
  with check (organization_id in (select app.member_org_ids()));

-- ---------------------------------------------------------------------------
-- Organisation-owned tables: full CRUD scoped to the caller's organisations.
-- Role enforcement is layered on top by server actions (assertCan).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  org_tables text[] := array[
    'ea_products', 'ea_versions', 'ea_version_setups', 'parameter_groups', 'ea_parameters',
    'image_assets', 'manuals', 'manual_versions', 'manual_sections', 'manual_blocks'
  ];
begin
  foreach t in array org_tables loop
    execute format(
      'create policy %I on %I for select to authenticated using (organization_id in (select app.member_org_ids()))',
      t || '_select_members', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (organization_id in (select app.member_org_ids()))',
      t || '_insert_members', t);
    execute format(
      'create policy %I on %I for update to authenticated using (organization_id in (select app.member_org_ids())) with check (organization_id in (select app.member_org_ids()))',
      t || '_update_members', t);
    execute format(
      'create policy %I on %I for delete to authenticated using (organization_id in (select app.member_org_ids()))',
      t || '_delete_members', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- manual_templates: system templates (org NULL) readable by all authenticated;
-- org templates scoped to members; writes ADMIN only.
-- ---------------------------------------------------------------------------
create policy template_select on manual_templates
  for select to authenticated
  using (organization_id is null or organization_id in (select app.member_org_ids()));

create policy template_write_admin on manual_templates
  for all to authenticated
  using (organization_id is not null and app.member_role(organization_id) = 'ADMIN')
  with check (organization_id is not null and app.member_role(organization_id) = 'ADMIN');

create policy template_section_select on manual_template_sections
  for select to authenticated
  using (
    exists (
      select 1 from manual_templates mt
      where mt.id = manual_template_sections.template_id
        and (mt.organization_id is null or mt.organization_id in (select app.member_org_ids()))
    )
  );

-- ---------------------------------------------------------------------------
-- Storage: private bucket for draft manual images. Object path convention:
--   <organization_id>/<image_asset_id>.<ext>
-- Access is allowed only to members of the org in the first path segment.
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
    and (split_part(name, '/', 1))::uuid in (select app.member_org_ids())
  );

create policy manual_images_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'manual-images'
    and (split_part(name, '/', 1))::uuid in (select app.member_org_ids())
  );

create policy manual_images_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'manual-images'
    and (split_part(name, '/', 1))::uuid in (select app.member_org_ids())
  );
