-- Phase 4 · AI revision audit trail (PRD-AI-007, AC-P4-9/10).
--
-- Every AI proposal and its Accept/Reject outcome is recorded here. The table is an AUDIT
-- record: it never drives workflow status, compliance state, or publishing (Phase 5+ owns
-- that). No credential, session token, signed URL, or raw DB context is ever stored — only
-- normalised inputs, a canonical `input_hash`, grounded fact ids, the proposed output, and
-- safe provider metadata.
--
-- Data API note: this project has "expose new tables" = OFF, so explicit grants are required.
-- RLS remains the authorization boundary: read = any org member; write = app.can_author only.

create table ai_revisions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations (id) on delete cascade,
  manual_version_id     uuid not null,
  -- where the proposal targets (null for a whole-manual claim scan)
  section_id            uuid,
  block_id              uuid,
  target_field          text check (target_field in ('content','answer','question','caption','steps')),
  actor_id              uuid references profiles (id) on delete set null,
  operation             text not null check (operation in (
                          'improveText','simplifyText','technicalRewrite',
                          'generateSteps','generateCaption','detectClaims')),
  -- canonical hash of {operation, selectedText, locale, factBundle, target} — key-order stable
  input_hash            text not null,
  locale                text not null default 'id',
  fact_reference_ids    text[] not null default '{}',
  -- result kind + payload
  status                text not null check (status in ('PROPOSAL','ADDITIONAL_INFORMATION_REQUIRED','SCAN')),
  proposed_output       jsonb,
  grounding_ok          boolean not null default true,
  grounding_violations  text[] not null default '{}',
  -- provider metadata — SAFE ONLY
  provider              text not null,
  provider_model        text,
  provider_metadata     jsonb not null default '{}'::jsonb,
  -- decision lifecycle
  decision              text not null default 'PENDING' check (decision in ('PENDING','ACCEPTED','REJECTED','N/A')),
  decided_at            timestamptz,
  applied_row_version   bigint,
  created_at            timestamptz not null default now(),
  foreign key (manual_version_id, organization_id)
    references manual_versions (id, organization_id) on delete cascade
);

create index ai_revisions_mv_idx on ai_revisions (manual_version_id, created_at desc);
create index ai_revisions_actor_idx on ai_revisions (organization_id, actor_id, created_at desc);

-- Idempotency (AC-P4-10): at most one PENDING proposal per (manual version, canonical input).
-- A concurrent identical request loses this insert and re-reads the winner's row.
create unique index ai_revisions_pending_dedup
  on ai_revisions (manual_version_id, input_hash)
  where decision = 'PENDING';

alter table ai_revisions enable row level security;

-- SELECT: any active member of the org (reviewers may read the audit, read-only).
create policy ai_revisions_select_members on ai_revisions
  for select to authenticated
  using (organization_id in (select app.member_org_ids()));

-- INSERT/UPDATE: authors only (DEVELOPER / ADMIN). Reviewers cannot generate or decide.
create policy ai_revisions_insert_authors on ai_revisions
  for insert to authenticated
  with check (app.can_author(organization_id) and actor_id = auth.uid());

create policy ai_revisions_update_authors on ai_revisions
  for update to authenticated
  using (app.can_author(organization_id))
  with check (app.can_author(organization_id));

-- No DELETE policy — the audit trail is append + decision-update only.

-- ---------------------------------------------------------------------------
-- Data API grants (RLS still decides the effective operation per role).
-- ---------------------------------------------------------------------------
grant select, insert, update on table public.ai_revisions to authenticated;
grant select, insert, update, delete on table public.ai_revisions to service_role;
