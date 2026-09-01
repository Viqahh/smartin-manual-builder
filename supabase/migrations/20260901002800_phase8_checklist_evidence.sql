-- Phase 8 · UAT-35 — human-evidence workflow for machine false-negative WARNING checks.
--
-- A deterministic checklist rule can miss prose the author has genuinely written. This adds a
-- SEPARATE human record: the author points at the chapter/block that already documents the fact,
-- an assigned reviewer accepts or returns it. It NEVER rewrites checklist_results.state — the
-- automated result and the human decision stay distinct. An accepted, current evidence record may
-- let the readiness score + publish gate treat that ONE eligible WARNING as resolved; it can NEVER
-- clear a MISSING authoritative fact, and it is not a regulator approval.
--
-- New objects only. No existing migration file is modified. `publish_manual_version` is
-- re-defined here (the repo's established pattern — it was already re-defined in 2500 and 2600),
-- with a SINGLE delta: the publish-blocking-WARNING query now excludes an eligible check that has
-- a current ACCEPTED human-evidence submission.

-- ===========================================================================
-- 1. eligibility flag on checklist_items  (DB copy of HUMAN_EVIDENCE_ELIGIBLE)
-- ===========================================================================
alter table checklist_items
  add column if not exists human_evidence_eligible boolean not null default false;

-- STRICT allowlist: documentation-wording checks prone to a machine false negative. Never a rule
-- whose fact could be simply absent. Mirrored in lib/validation/types.ts (a test asserts parity).
update checklist_items
  set human_evidence_eligible = true
  where check_key in ('CHK-INSTALL-AUTOTRADING', 'CHK-PACKAGE-FILES');

-- ===========================================================================
-- 2. checklist_evidence_submissions
-- ===========================================================================
create table if not exists checklist_evidence_submissions (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references organizations (id) on delete cascade,
  manual_version_id           uuid not null,
  -- checklist identity (§4): enough to understand this record if a later template changes wording
  checklist_template_id       uuid not null references checklist_templates (id),
  checklist_template_version  integer not null,
  checklist_item_id           uuid references checklist_items (id) on delete set null,
  check_key                   text not null,                    -- snapshot of the check identity
  -- author submission
  submitted_by                uuid not null references profiles (id) on delete restrict,
  submitted_at                timestamptz not null default now(),
  section_id                  uuid,
  block_id                    uuid,
  note                        text check (note is null or length(note) <= 2000),
  automated_state_at_submit   text not null
                                check (automated_state_at_submit in ('PASS','WARNING','MISSING','NOT_APPLICABLE')),
  evidence_content_hash       text not null,                    -- server-computed fingerprint
  -- lifecycle
  status                      text not null default 'PENDING'
                                check (status in ('PENDING','ACCEPTED','RETURNED','SUPERSEDED','STALE')),
  -- reviewer decision (review type is SERVER-DERIVED in decide_checklist_evidence, never trusted from a client)
  decided_by                  uuid references profiles (id) on delete set null,
  decided_at                  timestamptz,
  decision_review_type        text check (decision_review_type in ('TECHNICAL','COMPLIANCE')),
  return_reason               text check (return_reason is null or length(return_reason) <= 2000),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  -- org + manual composite ownership (same pattern as checklist_results / review_comments)
  foreign key (manual_version_id, organization_id)
    references manual_versions (id, organization_id) on delete cascade,
  foreign key (checklist_template_id, check_key)
    references checklist_items (checklist_template_id, check_key),
  -- anchors: SET NULL on delete; a STALE trigger (below) also fires so an accepted record becomes
  -- ineffective the moment its evidence is deleted. Tenancy + same-manual-version binding of the
  -- anchor is enforced by app.assert_evidence_anchor (manual_blocks has no (id, org) unique key).
  foreign key (section_id) references manual_sections (id) on delete set null,
  foreign key (block_id)   references manual_blocks (id)   on delete set null
);

-- at most ONE live (author still waiting, or reviewer-accepted) submission per check per version
create unique index if not exists chk_evi_one_live
  on checklist_evidence_submissions (manual_version_id, check_key)
  where status in ('PENDING', 'ACCEPTED');
create index if not exists chk_evi_mv_idx     on checklist_evidence_submissions (manual_version_id);
create index if not exists chk_evi_block_idx  on checklist_evidence_submissions (block_id)   where block_id   is not null;
create index if not exists chk_evi_sect_idx   on checklist_evidence_submissions (section_id) where section_id is not null;

drop trigger if exists chk_evi_touch on checklist_evidence_submissions;
create trigger chk_evi_touch before update on checklist_evidence_submissions
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2a. anchor must belong to the SAME manual_version + org
-- ---------------------------------------------------------------------------
create or replace function app.assert_evidence_anchor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.section_id is not null and not exists (
    select 1 from manual_sections s
    where s.id = new.section_id
      and s.manual_version_id = new.manual_version_id
      and s.organization_id = new.organization_id
  ) then
    raise exception 'invalid evidence anchor: the chapter is not part of this manual version'
      using errcode = 'foreign_key_violation';
  end if;
  if new.block_id is not null then
    if new.section_id is null then
      raise exception 'invalid evidence anchor: a block anchor needs its chapter'
        using errcode = 'invalid_parameter_value';
    end if;
    if not exists (
      select 1 from manual_blocks b
      where b.id = new.block_id
        and b.manual_section_id = new.section_id
        and b.organization_id = new.organization_id
        and b.deleted_at is null
    ) then
      raise exception 'invalid evidence anchor: the block is not a live block of that chapter'
        using errcode = 'foreign_key_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function app.assert_evidence_anchor() from public;
drop trigger if exists chk_evi_anchor on checklist_evidence_submissions;
create trigger chk_evi_anchor before insert on checklist_evidence_submissions
  for each row execute function app.assert_evidence_anchor();

-- ---------------------------------------------------------------------------
-- 2b. immutability — a decided row is historical evidence
--     PENDING may become ACCEPTED / RETURNED / SUPERSEDED / STALE.
--     ACCEPTED may become SUPERSEDED / STALE only.
--     RETURNED / SUPERSEDED / STALE are terminal (never recycled back to PENDING).
--     submission identity + author fields are frozen after insert.
-- ---------------------------------------------------------------------------
create or replace function app.guard_evidence_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.manual_version_id          is distinct from old.manual_version_id
     or new.organization_id          is distinct from old.organization_id
     or new.check_key                is distinct from old.check_key
     or new.checklist_template_id    is distinct from old.checklist_template_id
     or new.checklist_template_version is distinct from old.checklist_template_version
     or new.submitted_by             is distinct from old.submitted_by
     or new.submitted_at             is distinct from old.submitted_at
     or new.automated_state_at_submit is distinct from old.automated_state_at_submit
     or new.evidence_content_hash    is distinct from old.evidence_content_hash
     or new.note                     is distinct from old.note then
    raise exception 'a human-evidence submission is immutable; only its lifecycle / decision may change'
      using errcode = 'restrict_violation';
  end if;

  if old.status = 'PENDING' and new.status not in ('PENDING','ACCEPTED','RETURNED','SUPERSEDED','STALE') then
    raise exception 'invalid evidence transition from PENDING to %', new.status using errcode = 'check_violation';
  end if;
  if old.status = 'ACCEPTED' and new.status not in ('ACCEPTED','SUPERSEDED','STALE') then
    raise exception 'invalid evidence transition from ACCEPTED to %', new.status using errcode = 'check_violation';
  end if;
  if old.status in ('RETURNED','SUPERSEDED','STALE') and new.status is distinct from old.status then
    raise exception 'a % evidence row is terminal', old.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function app.guard_evidence_update() from public;
drop trigger if exists chk_evi_guard on checklist_evidence_submissions;
create trigger chk_evi_guard before update on checklist_evidence_submissions
  for each row execute function app.guard_evidence_update();

-- ---------------------------------------------------------------------------
-- 2c. content-bound staleness — editing / soft-deleting the anchored block, or adding/removing a
--     block in the anchored chapter, makes a live submission STALE. A STALE row never clears a
--     gate; the reviewer must look again. (Belt: the app also re-checks the fingerprint.)
-- ---------------------------------------------------------------------------
create or replace function app.stale_evidence_for_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block   uuid := coalesce(new.id, old.id);
  v_section uuid := coalesce(new.manual_section_id, old.manual_section_id);
begin
  update checklist_evidence_submissions ev
    set status = 'STALE', updated_at = now()
    from manual_sections s
    where ev.status in ('PENDING','ACCEPTED')
      and s.id = v_section
      and ev.manual_version_id = s.manual_version_id
      and (ev.block_id = v_block or (ev.block_id is null and ev.section_id = v_section));
  return null;
end;
$$;
revoke execute on function app.stale_evidence_for_block() from public;

-- payload edit or soft-delete (deleted_at set) of a block
drop trigger if exists manual_blocks_stale_evidence_upd on manual_blocks;
create trigger manual_blocks_stale_evidence_upd
  after update on manual_blocks
  for each row
  when (new.payload is distinct from old.payload or new.deleted_at is distinct from old.deleted_at)
  execute function app.stale_evidence_for_block();
-- a new block added to (or a hard delete from) the anchored chapter changes section-level evidence
drop trigger if exists manual_blocks_stale_evidence_ins on manual_blocks;
create trigger manual_blocks_stale_evidence_ins
  after insert on manual_blocks
  for each row execute function app.stale_evidence_for_block();
drop trigger if exists manual_blocks_stale_evidence_del on manual_blocks;
create trigger manual_blocks_stale_evidence_del
  after delete on manual_blocks
  for each row execute function app.stale_evidence_for_block();

-- a deleted chapter also invalidates any evidence anchored to it
create or replace function app.stale_evidence_for_section()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update checklist_evidence_submissions
    set status = 'STALE', updated_at = now()
    where status in ('PENDING','ACCEPTED') and section_id = old.id;
  return null;
end;
$$;
revoke execute on function app.stale_evidence_for_section() from public;
drop trigger if exists manual_sections_stale_evidence_del on manual_sections;
create trigger manual_sections_stale_evidence_del
  after delete on manual_sections
  for each row execute function app.stale_evidence_for_section();

-- ===========================================================================
-- 3. RLS — org members read; NO client write (RPCs only, service-role owned)
-- ===========================================================================
alter table checklist_evidence_submissions enable row level security;

drop policy if exists chk_evi_select_members on checklist_evidence_submissions;
create policy chk_evi_select_members on checklist_evidence_submissions
  for select to authenticated
  using (organization_id in (select app.member_org_ids()));

grant select on table public.checklist_evidence_submissions to authenticated;
grant select, insert, update, delete on table public.checklist_evidence_submissions to service_role;

-- ===========================================================================
-- 4. submit_checklist_evidence  (author only, eligible WARNING only)
-- ===========================================================================
create or replace function public.submit_checklist_evidence(
  p_manual_version_id uuid,
  p_check_key         text,
  p_section_id        uuid,
  p_block_id          uuid,
  p_note              text,
  p_evidence_hash     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_status   manual_status;
  v_actor    uuid := auth.uid();
  v_tid      uuid;
  v_tver     integer;
  v_item_id  uuid;
  v_eligible boolean;
  v_auto     text;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_id       uuid;
begin
  select organization_id, status into v_org, v_status
  from manual_versions where id = p_manual_version_id;
  if v_org is null then raise exception 'manual version not found' using errcode = 'no_data_found'; end if;
  if v_actor is null then raise exception 'forbidden: authentication required' using errcode = 'insufficient_privilege'; end if;

  if not app.is_service_request() and not app.can_author(v_org) then
    raise exception 'forbidden: submitting evidence requires DEVELOPER or ADMIN'
      using errcode = 'insufficient_privilege';
  end if;
  if v_status not in ('DRAFT', 'CHANGES_REQUESTED') then
    raise exception 'workflow: evidence can only be submitted while the manual is editable (current %)', v_status
      using errcode = 'invalid_parameter_value';
  end if;
  if p_evidence_hash is null or length(p_evidence_hash) not between 16 and 128 then
    raise exception 'invalid evidence fingerprint' using errcode = 'invalid_parameter_value';
  end if;

  -- template + item identity from THIS version's persisted checklist result set
  select cr.checklist_template_id, cr.checklist_template_version, cr.state
    into v_tid, v_tver, v_auto
  from checklist_results cr
  where cr.manual_version_id = p_manual_version_id and cr.check_key = p_check_key;
  if v_tid is null then
    raise exception 'validation: this check has not been evaluated for the manual yet'
      using errcode = 'check_violation';
  end if;

  select ci.id, ci.human_evidence_eligible
    into v_item_id, v_eligible
  from checklist_items ci
  where ci.checklist_template_id = v_tid and ci.check_key = p_check_key;
  if not coalesce(v_eligible, false) then
    raise exception 'forbidden: this check does not accept "already in the manual" evidence'
      using errcode = 'insufficient_privilege';
  end if;

  -- §7/§8: ONLY a machine false-negative WARNING. MISSING authoritative facts can never be attested.
  if v_auto is distinct from 'WARNING' then
    raise exception 'validation: human evidence applies only to a WARNING result (current %)', coalesce(v_auto, 'none')
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from checklist_evidence_submissions
    where manual_version_id = p_manual_version_id and check_key = p_check_key
      and status in ('PENDING', 'ACCEPTED')
  ) then
    raise exception 'conflict: a live evidence submission already exists for this check'
      using errcode = 'unique_violation';
  end if;

  insert into checklist_evidence_submissions
    (organization_id, manual_version_id, checklist_template_id, checklist_template_version,
     checklist_item_id, check_key, submitted_by, section_id, block_id, note,
     automated_state_at_submit, evidence_content_hash, status)
  values
    (v_org, p_manual_version_id, v_tid, v_tver, v_item_id, p_check_key, v_actor,
     p_section_id, p_block_id, v_note, v_auto, p_evidence_hash, 'PENDING')
  returning id into v_id;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, v_actor, 'checklist_evidence:submitted', 'checklist_evidence_submission', v_id,
    jsonb_build_object('checkKey', p_check_key, 'manualVersionId', p_manual_version_id,
      'sectionId', p_section_id, 'blockId', p_block_id, 'automatedState', v_auto));

  return jsonb_build_object('id', v_id, 'status', 'PENDING');
end;
$$;
revoke execute on function public.submit_checklist_evidence(uuid, text, uuid, uuid, text, text) from public, anon;
grant  execute on function public.submit_checklist_evidence(uuid, text, uuid, uuid, text, text) to authenticated, service_role;

-- ===========================================================================
-- 5. decide_checklist_evidence  (assigned reviewer of the CURRENT stage; type server-derived)
-- ===========================================================================
create or replace function public.decide_checklist_evidence(
  p_submission_id  uuid,
  p_decision       text,        -- 'ACCEPT' | 'RETURN'
  p_return_reason  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_mv      uuid;
  v_status  manual_status;
  v_tech    uuid;
  v_comp    uuid;
  v_actor   uuid := auth.uid();
  v_cur     text;
  v_rtype   text;
  v_reason  text := nullif(btrim(coalesce(p_return_reason, '')), '');
  v_new     text;
begin
  select ev.organization_id, ev.manual_version_id, ev.status
    into v_org, v_mv, v_cur
  from checklist_evidence_submissions ev
  where ev.id = p_submission_id
  for update;
  if v_org is null then raise exception 'evidence submission not found' using errcode = 'no_data_found'; end if;
  if v_actor is null then raise exception 'forbidden: authentication required' using errcode = 'insufficient_privilege'; end if;
  if p_decision not in ('ACCEPT', 'RETURN') then
    raise exception 'workflow: decision must be ACCEPT or RETURN' using errcode = 'invalid_parameter_value';
  end if;
  if v_cur <> 'PENDING' then
    raise exception 'workflow: only a PENDING submission can be decided (current %)', v_cur
      using errcode = 'invalid_parameter_value';
  end if;

  select mv.status, mv.technical_reviewer_id, mv.compliance_reviewer_id
    into v_status, v_tech, v_comp
  from manual_versions mv where mv.id = v_mv;

  -- review type is DERIVED from the current stage + the assigned reviewer. Never from a client arg.
  if v_status = 'TECHNICAL_REVIEW' and v_actor = v_tech then
    v_rtype := 'TECHNICAL';
  elsif v_status = 'COMPLIANCE_REVIEW' and v_actor = v_comp then
    v_rtype := 'COMPLIANCE';
  else
    raise exception 'forbidden: only the assigned reviewer of the current review stage may decide evidence'
      using errcode = 'insufficient_privilege';
  end if;

  if p_decision = 'RETURN' and (v_reason is null or length(v_reason) < 5) then
    raise exception 'workflow: a return needs a reason (min 5 characters)' using errcode = 'invalid_parameter_value';
  end if;

  v_new := case when p_decision = 'ACCEPT' then 'ACCEPTED' else 'RETURNED' end;

  update checklist_evidence_submissions
    set status = v_new,
        decided_by = v_actor,
        decided_at = now(),
        decision_review_type = v_rtype,
        return_reason = case when p_decision = 'RETURN' then v_reason else null end
  where id = p_submission_id;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, v_actor,
    case when p_decision = 'ACCEPT' then 'checklist_evidence:accepted' else 'checklist_evidence:returned' end,
    'checklist_evidence_submission', p_submission_id,
    jsonb_build_object('manualVersionId', v_mv, 'reviewType', v_rtype, 'stage', v_status));

  return jsonb_build_object('id', p_submission_id, 'status', v_new, 'reviewType', v_rtype);
end;
$$;
revoke execute on function public.decide_checklist_evidence(uuid, text, text) from public, anon;
grant  execute on function public.decide_checklist_evidence(uuid, text, text) to authenticated, service_role;

-- ===========================================================================
-- 6a. publish_warning_blockers — the publish-blocking WARNING checks that are NOT excused.
--     Extracted so the publish gate stays DRY and the rule is directly testable. A check is
--     excused ONLY when it is human_evidence_eligible AND has a current ACCEPTED submission on
--     the SAME checklist template. STALE / RETURNED / SUPERSEDED never excuse. MISSING is not
--     handled here at all — an authoritative missing fact can never be cleared this way.
-- ===========================================================================
drop function if exists app.publish_warning_blockers(uuid);
create or replace function public.publish_warning_blockers(p_manual_version_id uuid)
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(cr.check_key order by cr.check_key), '{}')
  from checklist_results cr
  join checklist_items ci
    on ci.checklist_template_id = cr.checklist_template_id and ci.check_key = cr.check_key
  where cr.manual_version_id = p_manual_version_id
    and ci.publish_blocking and cr.state = 'WARNING'
    and not (
      ci.human_evidence_eligible
      and exists (
        select 1 from checklist_evidence_submissions ev
        where ev.manual_version_id = cr.manual_version_id
          and ev.check_key = cr.check_key
          and ev.checklist_template_id = cr.checklist_template_id
          and ev.status = 'ACCEPTED'
      )
    );
$$;
revoke execute on function public.publish_warning_blockers(uuid) from public, anon;
grant  execute on function public.publish_warning_blockers(uuid) to authenticated, service_role;

-- ===========================================================================
-- 6b. publish_manual_version — re-defined (supersedes 20260901002600). SINGLE delta vs 2600:
--    the publish-blocking-WARNING query now calls app.publish_warning_blockers (which excludes an
--    eligible check with a current ACCEPTED human-evidence submission). MISSING (v_missing) is
--    untouched — an authoritative missing fact can NEVER be cleared this way. N/A logic unchanged.
-- ===========================================================================
create or replace function public.publish_manual_version(
  p_manual_version_id     uuid,
  p_actor_id              uuid,
  p_expected_content_hash text,
  p_render_json           jsonb,
  p_snapshot_hash         text,
  p_public_slug           text,
  p_public_version        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org         uuid;
  v_manual_id   uuid;
  v_mv_version  text;
  v_status      manual_status;
  v_round       integer;
  v_submitted   text;
  v_tech_hash   text;
  v_comp_hash   text;
  v_tid         uuid;
  v_ver         integer;
  v_tid_n       integer;
  v_ver_n       integer;
  v_res_n       integer;
  v_item_n      integer;
  v_missing     text[];
  v_warnblock   text[];
  v_blockers    text[];
  v_snapshot_id uuid;
  v_rows        integer;
  v_effective_public_slug text;
  v_public_manual_id      uuid;
  v_claim_org    uuid;
  v_claim_manual uuid;
begin
  select organization_id, manual_id, version, status, review_round, submitted_content_hash
    into v_org, v_manual_id, v_mv_version, v_status, v_round, v_submitted
  from manual_versions
  where id = p_manual_version_id
  for update;
  if v_org is null then
    raise exception 'manual version not found' using errcode = 'no_data_found';
  end if;

  if p_actor_id is null or not app.is_admin(v_org, p_actor_id) then
    raise exception 'forbidden: only an ADMIN may publish a manual version'
      using errcode = 'insufficient_privilege';
  end if;

  if v_status <> 'APPROVED' then
    raise exception 'workflow: only an APPROVED manual version can be published (current %)', v_status
      using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(v_round, 0) < 1 then
    raise exception 'workflow: a published version must have a completed review round'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_expected_content_hash is null or p_expected_content_hash is distinct from v_submitted then
    raise exception 'stale content: the manual changed since it was approved — re-review is required'
      using errcode = 'invalid_parameter_value';
  end if;

  select reviewed_content_hash into v_tech_hash
  from reviews
  where manual_version_id = p_manual_version_id and round_number = v_round
    and review_type = 'TECHNICAL' and decision = 'APPROVE';
  if v_tech_hash is null then
    raise exception 'workflow: no current-round technical approval'
      using errcode = 'invalid_parameter_value';
  end if;

  select reviewed_content_hash into v_comp_hash
  from reviews
  where manual_version_id = p_manual_version_id and round_number = v_round
    and review_type = 'COMPLIANCE' and decision = 'APPROVE';
  if v_comp_hash is null then
    raise exception 'workflow: no current-round compliance approval'
      using errcode = 'invalid_parameter_value';
  end if;

  if v_tech_hash is distinct from v_submitted or v_comp_hash is distinct from v_submitted then
    raise exception 'stale content: an approval hash no longer matches the approved content'
      using errcode = 'invalid_parameter_value';
  end if;

  select count(distinct checklist_template_id), count(distinct checklist_template_version), count(*)
    into v_tid_n, v_ver_n, v_res_n
  from checklist_results
  where manual_version_id = p_manual_version_id;

  if v_res_n = 0 then
    raise exception 'validation: the manual has no checklist evaluation yet'
      using errcode = 'check_violation';
  end if;
  if v_tid_n <> 1 or v_ver_n <> 1 then
    raise exception 'validation: the checklist result set mixes template versions'
      using errcode = 'check_violation';
  end if;

  select checklist_template_id, checklist_template_version into v_tid, v_ver
  from checklist_results
  where manual_version_id = p_manual_version_id
  limit 1;

  select count(*) into v_item_n from checklist_items where checklist_template_id = v_tid;
  if v_res_n <> v_item_n then
    raise exception 'validation: the checklist result set does not cover every checklist item (% of %)', v_res_n, v_item_n
      using errcode = 'check_violation';
  end if;

  -- A. any REQUIRED result still MISSING — NEVER excused by human evidence.
  select array_agg(check_key order by check_key) into v_missing
  from checklist_results
  where manual_version_id = p_manual_version_id and required and state = 'MISSING';

  -- B. publish-blocking WARNING checks that are NOT excused by a current ACCEPTED, eligible
  --    human-evidence submission (UAT-35 §8).
  v_warnblock := public.publish_warning_blockers(p_manual_version_id);

  v_blockers := coalesce(v_missing, '{}') || coalesce(v_warnblock, '{}');
  if array_length(v_blockers, 1) is not null then
    raise exception 'validation: publication is blocked by unresolved checklist items'
      using errcode = 'check_violation',
            detail = array_to_string(v_blockers, ',');
  end if;

  -- ---- Phase 7: global public-slug claim / reuse (lineage-frozen, concurrency-safe) ----------
  perform 1 from manuals where id = v_manual_id for update;

  select id, public_slug into v_public_manual_id, v_effective_public_slug
  from public_manuals
  where organization_id = v_org and manual_id = v_manual_id;

  if v_public_manual_id is null then
    if p_public_slug is null or p_public_slug = '' then
      raise exception 'validation: a public slug is required for the first publication'
        using errcode = 'invalid_parameter_value';
    end if;

    insert into public_manuals (public_slug, organization_id, manual_id)
    values (p_public_slug, v_org, v_manual_id)
    on conflict (public_slug) do nothing;

    select id, organization_id, manual_id
      into v_public_manual_id, v_claim_org, v_claim_manual
    from public_manuals
    where public_slug = p_public_slug
    for update;

    if v_claim_org is distinct from v_org or v_claim_manual is distinct from v_manual_id then
      raise exception 'conflict: public slug "%" is already claimed by another manual', p_public_slug
        using errcode = 'unique_violation';
    end if;
    v_effective_public_slug := p_public_slug;
  end if;

  if p_public_version is distinct from v_mv_version then
    raise exception 'stale content: publish version "%" does not match the manual version "%"',
      p_public_version, v_mv_version
      using errcode = 'invalid_parameter_value';
  end if;
  if (p_render_json #>> '{public,slug}') is distinct from v_effective_public_slug then
    raise exception 'stale content: snapshot public slug "%" does not match the frozen lineage slug "%" — rebuild the snapshot and retry',
      p_render_json #>> '{public,slug}', v_effective_public_slug
      using errcode = 'invalid_parameter_value';
  end if;
  if (p_render_json #>> '{public,version}') is distinct from p_public_version then
    raise exception 'stale content: snapshot public version "%" does not match "%"',
      p_render_json #>> '{public,version}', p_public_version
      using errcode = 'invalid_parameter_value';
  end if;

  update manual_versions
    set status = 'PUBLISHED', published_at = now()
  where id = p_manual_version_id and status = 'APPROVED' and review_round = v_round;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'workflow: the manual version already left APPROVED'
      using errcode = 'invalid_parameter_value';
  end if;

  begin
    insert into published_snapshots
      (organization_id, manual_version_id, render_json, content_hash, public_slug, public_version)
    values
      (v_org, p_manual_version_id, p_render_json, p_snapshot_hash, v_effective_public_slug, p_public_version)
    returning id into v_snapshot_id;
  exception when unique_violation then
    raise exception 'conflict: this manual version is already published, or the public slug + version is taken'
      using errcode = 'unique_violation';
  end;

  begin
    insert into public_manual_versions
      (public_manual_id, organization_id, public_version, published_snapshot_id, publication_state, published_at)
    values
      (v_public_manual_id, v_org, p_public_version, v_snapshot_id, 'PUBLISHED', now());
  exception when unique_violation then
    raise exception 'conflict: this public version already exists for the manual'
      using errcode = 'unique_violation';
  end;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, p_actor_id, 'manual_version:publish', 'manual_version', p_manual_version_id,
    jsonb_build_object(
      'round',              v_round,
      'fromStatus',         'APPROVED',
      'toStatus',           'PUBLISHED',
      'publicSlug',         v_effective_public_slug,
      'publicVersion',      p_public_version,
      'snapshotId',         v_snapshot_id,
      'contentHash',        p_snapshot_hash,
      'reviewedContentHash', v_submitted,
      'blockingCheckIds',   '[]'::jsonb));

  return jsonb_build_object(
    'status',        'PUBLISHED',
    'snapshotId',    v_snapshot_id,
    'contentHash',   p_snapshot_hash,
    'publicSlug',    v_effective_public_slug,
    'publicVersion', p_public_version);
end;
$$;
revoke execute on function public.publish_manual_version(uuid, uuid, text, jsonb, text, text, text) from public, anon, authenticated;
grant  execute on function public.publish_manual_version(uuid, uuid, text, jsonb, text, text, text) to service_role;
