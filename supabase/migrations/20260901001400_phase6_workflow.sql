-- Phase 6 · Slice 2 — workflow commands, reviewer assignment integrity, read-only-by-state.
--
-- New file after 20260901001300 (that migration is NOT modified).
--
--   guards (triggers on manual_versions / manual_sections / manual_blocks):
--     * app.guard_manual_version_update()  — workflow + assignment columns change ONLY through
--       the SECURITY DEFINER RPCs below (or a trusted service request); a wrong-role reviewer id
--       is rejected at the DB.  SECURITY INVOKER: `current_user` is `authenticated` for a direct
--       PostgREST write (blocked), `postgres` inside an RPC (allowed), `service_role` for the
--       service key (allowed).
--     * app.assert_manual_version_draft()  — manual content (sections + blocks) is writable only
--       while the owning manual_version.status = 'DRAFT'.  SECURITY INVOKER (same reason).
--
--   RPCs (SECURITY DEFINER, search_path = public, authorise via auth.uid(), write EXACTLY one
--   audit_events row inside the transaction, return jsonb, revoked from public/anon):
--     * assign_reviewers            ADMIN sets technical + compliance reviewers
--     * submit_for_technical_review DRAFT -> TECHNICAL_REVIEW  (round++, stores content hash)
--     * record_technical_decision   TECHNICAL_REVIEW -> COMPLIANCE_REVIEW | CHANGES_REQUESTED
--     * record_compliance_decision  COMPLIANCE_REVIEW -> APPROVED | CHANGES_REQUESTED
--     * begin_revision              CHANGES_REQUESTED -> DRAFT  (round unchanged; hash cleared)
--
-- Concurrency is LOCK-FREE: no `FOR UPDATE`, no advisory locks (both can be stranded by a pooled
-- connection whose function RAISEd). Instead every status change is a single conditional
-- `UPDATE ... WHERE status = <expected> [AND review_round = <expected>]`; a 0-row result means a
-- concurrent command already moved the version, and the loser gets a typed workflow/stale error.
-- For the two decision RPCs, `reviews (manual_version_id, round_number, review_type)` UNIQUE is
-- the race winner-picker: the losing INSERT hits 23505 and is mapped to a typed error before any
-- transition or audit row is written.
--
-- The Phase 5 validation gate (no required in-scope MISSING) is enforced by the SERVER ACTION
-- before it calls submit_for_technical_review — validation rules are not duplicated in SQL.
-- The content fingerprint is computed in TypeScript (lib/reviews/fingerprint.ts) and passed in;
-- the RPC compares the caller-supplied CURRENT hash against the stored submitted hash.

-- ---------------------------------------------------------------------------
-- 1. manual_versions guard — workflow/assignment columns + reviewer integrity
-- ---------------------------------------------------------------------------
create or replace function app.guard_manual_version_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_workflow_changed boolean := (
    new.status                is distinct from old.status
    or new.review_round       is distinct from old.review_round
    or new.submitted_content_hash is distinct from old.submitted_content_hash
    or new.technical_reviewer_id  is distinct from old.technical_reviewer_id
    or new.compliance_reviewer_id is distinct from old.compliance_reviewer_id
    or new.published_at       is distinct from old.published_at
  );
begin
  if v_workflow_changed and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'workflow and reviewer-assignment columns change only through review commands'
      using errcode = 'insufficient_privilege';
  end if;

  if new.technical_reviewer_id is distinct from old.technical_reviewer_id
     and new.technical_reviewer_id is not null then
    if not exists (
      select 1 from memberships
      where organization_id = new.organization_id and user_id = new.technical_reviewer_id
        and role = 'TECHNICAL_REVIEWER' and is_active
    ) then
      raise exception 'assigned technical reviewer must be an active TECHNICAL_REVIEWER in this organisation'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.compliance_reviewer_id is distinct from old.compliance_reviewer_id
     and new.compliance_reviewer_id is not null then
    if not exists (
      select 1 from memberships
      where organization_id = new.organization_id and user_id = new.compliance_reviewer_id
        and role = 'COMPLIANCE_REVIEWER' and is_active
    ) then
      raise exception 'assigned compliance reviewer must be an active COMPLIANCE_REVIEWER in this organisation'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;
revoke execute on function app.guard_manual_version_update() from public;
create trigger manual_versions_workflow_guard before update on manual_versions
  for each row execute function app.guard_manual_version_update();

-- ---------------------------------------------------------------------------
-- 2. content read-only unless DRAFT (server-side; not just a disabled editor)
-- ---------------------------------------------------------------------------
create or replace function app.assert_manual_version_draft()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status manual_status;
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'manual_sections' then
    select status into v_status from manual_versions
     where id = coalesce(new.manual_version_id, old.manual_version_id);
  else
    select mv.status into v_status
    from manual_sections ms
    join manual_versions mv on mv.id = ms.manual_version_id
    where ms.id = coalesce(new.manual_section_id, old.manual_section_id);
  end if;
  if v_status is distinct from 'DRAFT' then
    raise exception 'manual content is read-only unless the version is DRAFT (current status: %)', v_status
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function app.assert_manual_version_draft() from public;
create trigger manual_sections_draft_guard before insert or update or delete on manual_sections
  for each row execute function app.assert_manual_version_draft();
create trigger manual_blocks_draft_guard before insert or update or delete on manual_blocks
  for each row execute function app.assert_manual_version_draft();

-- ---------------------------------------------------------------------------
-- 3. assign_reviewers  (ADMIN)
-- ---------------------------------------------------------------------------
create or replace function public.assign_reviewers(
  p_manual_version_id uuid,
  p_technical_reviewer_id uuid,
  p_compliance_reviewer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid; v_status manual_status; v_actor uuid := auth.uid();
  v_prev_t uuid; v_prev_c uuid; v_rows integer;
begin
  select organization_id, status, technical_reviewer_id, compliance_reviewer_id
    into v_org, v_status, v_prev_t, v_prev_c
  from manual_versions where id = p_manual_version_id;
  if v_org is null then raise exception 'manual version not found' using errcode = 'no_data_found'; end if;

  if not app.is_service_request() then
    if v_actor is null then raise exception 'forbidden: authentication required' using errcode = 'insufficient_privilege'; end if;
    if not app.is_admin(v_org) then raise exception 'forbidden: only an ADMIN may assign reviewers' using errcode = 'insufficient_privilege'; end if;
  end if;
  if p_technical_reviewer_id is null or p_compliance_reviewer_id is null then
    raise exception 'workflow: both a technical and a compliance reviewer are required' using errcode = 'invalid_parameter_value';
  end if;

  -- conditional UPDATE: a PUBLISHED/ARCHIVED version yields 0 rows. The guard trigger validates
  -- role + org + active for any changed id.
  update manual_versions
    set technical_reviewer_id = p_technical_reviewer_id,
        compliance_reviewer_id = p_compliance_reviewer_id
  where id = p_manual_version_id and status not in ('PUBLISHED', 'ARCHIVED');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'workflow: reviewers cannot be reassigned once % ', v_status using errcode = 'invalid_parameter_value';
  end if;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, v_actor, 'manual_version:assign_reviewers', 'manual_version', p_manual_version_id,
    jsonb_build_object(
      'previousTechnicalReviewerId', v_prev_t, 'previousComplianceReviewerId', v_prev_c,
      'technicalReviewerId', p_technical_reviewer_id, 'complianceReviewerId', p_compliance_reviewer_id));

  return jsonb_build_object('technicalReviewerId', p_technical_reviewer_id, 'complianceReviewerId', p_compliance_reviewer_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. submit_for_technical_review  (author; DRAFT -> TECHNICAL_REVIEW)
-- ---------------------------------------------------------------------------
create or replace function public.submit_for_technical_review(
  p_manual_version_id uuid,
  p_expected_round integer,
  p_content_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid; v_status manual_status; v_round integer;
  v_tech uuid; v_comp uuid; v_new_round integer; v_actor uuid := auth.uid(); v_rows integer;
begin
  select organization_id, status, review_round, technical_reviewer_id, compliance_reviewer_id
    into v_org, v_status, v_round, v_tech, v_comp
  from manual_versions where id = p_manual_version_id;
  if v_org is null then raise exception 'manual version not found' using errcode = 'no_data_found'; end if;

  if not app.is_service_request() then
    if v_actor is null then raise exception 'forbidden: authentication required' using errcode = 'insufficient_privilege'; end if;
    if not app.can_author(v_org) then raise exception 'forbidden: submit requires DEVELOPER or ADMIN' using errcode = 'insufficient_privilege'; end if;
  end if;

  if v_status <> 'DRAFT' then raise exception 'workflow: only a DRAFT can be submitted (current %)', v_status using errcode = 'invalid_parameter_value'; end if;
  if p_expected_round is not null and p_expected_round <> v_round then raise exception 'workflow: stale review round'; end if;
  if v_tech is null then raise exception 'workflow: technical reviewer not assigned' using errcode = 'invalid_parameter_value'; end if;
  if v_comp is null then raise exception 'workflow: compliance reviewer not assigned' using errcode = 'invalid_parameter_value'; end if;
  if p_content_hash is null or length(p_content_hash) < 16 then raise exception 'workflow: missing content hash' using errcode = 'invalid_parameter_value'; end if;

  v_new_round := v_round + 1;
  update manual_versions
    set status = 'TECHNICAL_REVIEW', review_round = v_new_round, submitted_content_hash = p_content_hash
  where id = p_manual_version_id and status = 'DRAFT' and review_round = v_round;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'workflow: stale review round'; end if;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, v_actor, 'manual_version:submit_review', 'manual_version', p_manual_version_id,
    jsonb_build_object('round', v_new_round, 'fromStatus', 'DRAFT', 'toStatus', 'TECHNICAL_REVIEW', 'contentHash', p_content_hash));

  return jsonb_build_object('status', 'TECHNICAL_REVIEW', 'round', v_new_round, 'contentHash', p_content_hash);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. record_technical_decision
-- ---------------------------------------------------------------------------
create or replace function public.record_technical_decision(
  p_manual_version_id uuid,
  p_expected_round integer,
  p_decision text,
  p_summary text,
  p_current_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid; v_status manual_status; v_round integer; v_tech uuid; v_submitted text;
  v_actor uuid := auth.uid(); v_next manual_status; v_review_id uuid; v_rows integer;
begin
  select organization_id, status, review_round, technical_reviewer_id, submitted_content_hash
    into v_org, v_status, v_round, v_tech, v_submitted
  from manual_versions where id = p_manual_version_id;
  if v_org is null then raise exception 'manual version not found' using errcode = 'no_data_found'; end if;

  if not app.is_service_request() then
    if v_actor is null then raise exception 'forbidden: authentication required' using errcode = 'insufficient_privilege'; end if;
    if not (app.has_role(v_org, 'TECHNICAL_REVIEWER') or app.has_role(v_org, 'ADMIN')) then
      raise exception 'forbidden: technical review permission required' using errcode = 'insufficient_privilege'; end if;
    if v_tech is distinct from v_actor then
      raise exception 'forbidden: not the assigned technical reviewer' using errcode = 'insufficient_privilege'; end if;
  end if;

  if v_status <> 'TECHNICAL_REVIEW' then raise exception 'workflow: not in TECHNICAL_REVIEW (current %)', v_status using errcode = 'invalid_parameter_value'; end if;
  if p_expected_round is not null and p_expected_round <> v_round then raise exception 'workflow: stale review round'; end if;
  if p_decision not in ('APPROVE', 'REQUEST_CHANGES') then raise exception 'workflow: unknown decision' using errcode = 'invalid_parameter_value'; end if;

  if p_decision = 'REQUEST_CHANGES' then
    if coalesce(btrim(p_summary), '') = '' then raise exception 'workflow: request-changes needs a non-empty summary' using errcode = 'invalid_parameter_value'; end if;
    v_next := 'CHANGES_REQUESTED';
  else
    if exists (select 1 from manual_version_contributors where manual_version_id = p_manual_version_id and user_id = v_actor) then
      raise exception 'self approval forbidden: a reviewer who authored or edited this manual version cannot approve it' using errcode = 'insufficient_privilege';
    end if;
    if p_current_hash is distinct from v_submitted then
      raise exception 'stale content: the manual changed since it was submitted for review';
    end if;
    v_next := 'COMPLIANCE_REVIEW';
  end if;

  -- the UNIQUE (manual_version_id, round_number, review_type) is the concurrency winner-picker
  begin
    insert into reviews (organization_id, manual_version_id, round_number, review_type, reviewer_id, decision, summary, reviewed_content_hash)
    values (v_org, p_manual_version_id, v_round, 'TECHNICAL', v_actor, p_decision, coalesce(p_summary, ''), coalesce(v_submitted, p_current_hash))
    returning id into v_review_id;
  exception when unique_violation then
    raise exception 'workflow: a technical decision already exists for this review round';
  end;

  update manual_versions set status = v_next
  where id = p_manual_version_id and status = 'TECHNICAL_REVIEW' and review_round = v_round;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'workflow: version already left TECHNICAL_REVIEW'; end if;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, v_actor, 'manual_version:technical_' || lower(p_decision), 'manual_version', p_manual_version_id,
    jsonb_build_object('round', v_round, 'decision', p_decision, 'fromStatus', 'TECHNICAL_REVIEW', 'toStatus', v_next,
      'reviewId', v_review_id, 'reviewedContentHash', coalesce(v_submitted, p_current_hash), 'summary', left(coalesce(p_summary, ''), 500)));

  return jsonb_build_object('status', v_next, 'round', v_round, 'reviewId', v_review_id, 'decision', p_decision);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. record_compliance_decision
-- ---------------------------------------------------------------------------
create or replace function public.record_compliance_decision(
  p_manual_version_id uuid,
  p_expected_round integer,
  p_decision text,
  p_summary text,
  p_current_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid; v_status manual_status; v_round integer; v_comp uuid; v_submitted text;
  v_actor uuid := auth.uid(); v_next manual_status; v_review_id uuid; v_tech_hash text; v_rows integer;
begin
  select organization_id, status, review_round, compliance_reviewer_id, submitted_content_hash
    into v_org, v_status, v_round, v_comp, v_submitted
  from manual_versions where id = p_manual_version_id;
  if v_org is null then raise exception 'manual version not found' using errcode = 'no_data_found'; end if;

  if not app.is_service_request() then
    if v_actor is null then raise exception 'forbidden: authentication required' using errcode = 'insufficient_privilege'; end if;
    if not (app.has_role(v_org, 'COMPLIANCE_REVIEWER') or app.has_role(v_org, 'ADMIN')) then
      raise exception 'forbidden: compliance review permission required' using errcode = 'insufficient_privilege'; end if;
    if v_comp is distinct from v_actor then
      raise exception 'forbidden: not the assigned compliance reviewer' using errcode = 'insufficient_privilege'; end if;
  end if;

  if v_status <> 'COMPLIANCE_REVIEW' then raise exception 'workflow: not in COMPLIANCE_REVIEW (current %)', v_status using errcode = 'invalid_parameter_value'; end if;
  if p_expected_round is not null and p_expected_round <> v_round then raise exception 'workflow: stale review round'; end if;
  if p_decision not in ('APPROVE', 'REQUEST_CHANGES') then raise exception 'workflow: unknown decision' using errcode = 'invalid_parameter_value'; end if;

  select reviewed_content_hash into v_tech_hash
  from reviews
  where manual_version_id = p_manual_version_id and round_number = v_round
    and review_type = 'TECHNICAL' and decision = 'APPROVE';
  if v_tech_hash is null then
    raise exception 'workflow: compliance review is unreachable without a recorded technical approval for this round'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_decision = 'REQUEST_CHANGES' then
    if coalesce(btrim(p_summary), '') = '' then raise exception 'workflow: request-changes needs a non-empty summary' using errcode = 'invalid_parameter_value'; end if;
    v_next := 'CHANGES_REQUESTED';
  else
    if exists (select 1 from manual_version_contributors where manual_version_id = p_manual_version_id and user_id = v_actor) then
      raise exception 'self approval forbidden: a reviewer who authored or edited this manual version cannot approve it' using errcode = 'insufficient_privilege';
    end if;
    if p_current_hash is distinct from v_submitted or v_tech_hash is distinct from v_submitted then
      raise exception 'stale content: the manual changed since technical approval';
    end if;
    v_next := 'APPROVED';
  end if;

  begin
    insert into reviews (organization_id, manual_version_id, round_number, review_type, reviewer_id, decision, summary, reviewed_content_hash)
    values (v_org, p_manual_version_id, v_round, 'COMPLIANCE', v_actor, p_decision, coalesce(p_summary, ''), coalesce(v_submitted, p_current_hash))
    returning id into v_review_id;
  exception when unique_violation then
    raise exception 'workflow: a compliance decision already exists for this review round';
  end;

  update manual_versions
    set status = v_next, reviewed_at = case when v_next = 'APPROVED' then now() else reviewed_at end
  where id = p_manual_version_id and status = 'COMPLIANCE_REVIEW' and review_round = v_round;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'workflow: version already left COMPLIANCE_REVIEW'; end if;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, v_actor, 'manual_version:compliance_' || lower(p_decision), 'manual_version', p_manual_version_id,
    jsonb_build_object('round', v_round, 'decision', p_decision, 'fromStatus', 'COMPLIANCE_REVIEW', 'toStatus', v_next,
      'reviewId', v_review_id, 'reviewedContentHash', coalesce(v_submitted, p_current_hash), 'summary', left(coalesce(p_summary, ''), 500)));

  return jsonb_build_object('status', v_next, 'round', v_round, 'reviewId', v_review_id, 'decision', p_decision);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. begin_revision  (author; CHANGES_REQUESTED -> DRAFT)
-- ---------------------------------------------------------------------------
create or replace function public.begin_revision(
  p_manual_version_id uuid,
  p_expected_round integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid; v_status manual_status; v_round integer; v_actor uuid := auth.uid(); v_rows integer;
begin
  select organization_id, status, review_round into v_org, v_status, v_round
  from manual_versions where id = p_manual_version_id;
  if v_org is null then raise exception 'manual version not found' using errcode = 'no_data_found'; end if;

  if not app.is_service_request() then
    if v_actor is null then raise exception 'forbidden: authentication required' using errcode = 'insufficient_privilege'; end if;
    if not app.can_author(v_org) then raise exception 'forbidden: begin-revision requires DEVELOPER or ADMIN' using errcode = 'insufficient_privilege'; end if;
  end if;
  if v_status <> 'CHANGES_REQUESTED' then raise exception 'workflow: only a CHANGES_REQUESTED version can begin revision (current %)', v_status using errcode = 'invalid_parameter_value'; end if;
  if p_expected_round is not null and p_expected_round <> v_round then raise exception 'workflow: stale review round'; end if;

  -- round is NOT changed here; the stale submitted hash is cleared so it can never be reused as
  -- a next-round approval hash. The next submit recomputes it. Prior reviews + comments untouched.
  update manual_versions set status = 'DRAFT', submitted_content_hash = null
  where id = p_manual_version_id and status = 'CHANGES_REQUESTED' and review_round = v_round;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'workflow: stale review round'; end if;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, v_actor, 'manual_version:begin_revision', 'manual_version', p_manual_version_id,
    jsonb_build_object('round', v_round, 'fromStatus', 'CHANGES_REQUESTED', 'toStatus', 'DRAFT'));

  return jsonb_build_object('status', 'DRAFT', 'round', v_round);
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE hardening (mirrors 20260901000600)
-- ---------------------------------------------------------------------------
revoke execute on function public.assign_reviewers(uuid, uuid, uuid) from public, anon;
revoke execute on function public.submit_for_technical_review(uuid, integer, text) from public, anon;
revoke execute on function public.record_technical_decision(uuid, integer, text, text, text) from public, anon;
revoke execute on function public.record_compliance_decision(uuid, integer, text, text, text) from public, anon;
revoke execute on function public.begin_revision(uuid, integer) from public, anon;

grant execute on function public.assign_reviewers(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.submit_for_technical_review(uuid, integer, text) to authenticated, service_role;
grant execute on function public.record_technical_decision(uuid, integer, text, text, text) to authenticated, service_role;
grant execute on function public.record_compliance_decision(uuid, integer, text, text, text) to authenticated, service_role;
grant execute on function public.begin_revision(uuid, integer) to authenticated, service_role;
