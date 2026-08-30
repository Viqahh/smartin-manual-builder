-- Phase 6 · Slice 3 — review comments: create + resolve/reopen RPCs, body immutability guard.
--
-- New file after 20260901001400 (neither 001300 nor 001400 is modified).
--
-- The review_comments TABLE, its at-most-one-anchor CHECK, the composite anchor FKs, the
-- same-manual-version anchor trigger (app.assert_review_comment_anchor), and the SELECT-for-org-
-- members RLS policy all shipped in 001300. This migration adds ONLY:
--
--   * app.guard_review_comment_update()  — body / anchor / author / round / review_type are
--     immutable review evidence; after creation, only resolved / resolved_by / resolved_at may
--     change (§6, §26). Blocks the change for EVERY caller (like reviews' immutability trigger).
--   * public.create_review_comment(...)      — the only write path for a new comment. Validates
--     session / role / assignment / status / round / anchor / body; no audit_events row (§12).
--   * public.set_review_comment_resolved(...) — resolve (true) / reopen (false); only the
--     assigned reviewer of the comment's review_type may call it (§7, §8).
--
-- No new client INSERT/UPDATE/DELETE policy — writes go only through the two SECURITY DEFINER
-- RPCs. Creating / resolving / reopening a comment NEVER changes manual_versions.status,
-- review_round, submitted_content_hash, or any checklist_results row (§20).

-- ---------------------------------------------------------------------------
-- 1. body / anchor / provenance immutability (only resolution columns may change)
-- ---------------------------------------------------------------------------
create or replace function app.guard_review_comment_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.manual_version_id is distinct from old.manual_version_id
     or new.round_number    is distinct from old.round_number
     or new.review_type     is distinct from old.review_type
     or new.author_id       is distinct from old.author_id
     or new.section_id      is distinct from old.section_id
     or new.block_id        is distinct from old.block_id
     or new.body            is distinct from old.body
     or new.organization_id is distinct from old.organization_id
     or new.created_at      is distinct from old.created_at then
    raise exception 'a review comment is immutable review evidence; only its resolved state may change'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
revoke execute on function app.guard_review_comment_update() from public;

-- fires after app.assert_review_comment_anchor (alphabetical) and before app.touch_updated_at
create trigger review_comments_body_guard before update on review_comments
  for each row execute function app.guard_review_comment_update();

-- ---------------------------------------------------------------------------
-- 2. create_review_comment  (assigned reviewer of the active stage)
-- ---------------------------------------------------------------------------
create or replace function public.create_review_comment(
  p_manual_version_id uuid,
  p_review_type       text,
  p_round             integer,
  p_section_id        uuid,
  p_block_id          uuid,
  p_body              text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_status manual_status;
  v_round  integer;
  v_tech   uuid;
  v_comp   uuid;
  v_actor  uuid := auth.uid();
  v_body   text := btrim(coalesce(p_body, ''));
  v_id     uuid;
begin
  select organization_id, status, review_round, technical_reviewer_id, compliance_reviewer_id
    into v_org, v_status, v_round, v_tech, v_comp
  from manual_versions where id = p_manual_version_id;
  if v_org is null then raise exception 'manual version not found' using errcode = 'no_data_found'; end if;

  if p_review_type not in ('TECHNICAL', 'COMPLIANCE') then
    raise exception 'workflow: unknown review type' using errcode = 'invalid_parameter_value'; end if;
  if length(v_body) < 1 or length(v_body) > 5000 then
    raise exception 'workflow: comment body must be 1..5000 characters' using errcode = 'invalid_parameter_value'; end if;
  if p_section_id is not null and p_block_id is not null then
    raise exception 'workflow: a comment targets the manual, one section, or one block — not more than one'
      using errcode = 'invalid_parameter_value'; end if;
  if v_actor is null then
    raise exception 'forbidden: authentication required' using errcode = 'insufficient_privilege'; end if;

  if not app.is_service_request() then
    if p_review_type = 'TECHNICAL' then
      if not (app.has_role(v_org, 'TECHNICAL_REVIEWER') or app.has_role(v_org, 'ADMIN')) then
        raise exception 'forbidden: technical review permission required' using errcode = 'insufficient_privilege'; end if;
      if v_tech is distinct from v_actor then
        raise exception 'forbidden: not the assigned technical reviewer' using errcode = 'insufficient_privilege'; end if;
    else
      if not (app.has_role(v_org, 'COMPLIANCE_REVIEWER') or app.has_role(v_org, 'ADMIN')) then
        raise exception 'forbidden: compliance review permission required' using errcode = 'insufficient_privilege'; end if;
      if v_comp is distinct from v_actor then
        raise exception 'forbidden: not the assigned compliance reviewer' using errcode = 'insufficient_privilege'; end if;
    end if;
  end if;

  if p_review_type = 'TECHNICAL' and v_status <> 'TECHNICAL_REVIEW' then
    raise exception 'workflow: a technical comment needs the version in TECHNICAL_REVIEW (current %)', v_status
      using errcode = 'invalid_parameter_value'; end if;
  if p_review_type = 'COMPLIANCE' and v_status <> 'COMPLIANCE_REVIEW' then
    raise exception 'workflow: a compliance comment needs the version in COMPLIANCE_REVIEW (current %)', v_status
      using errcode = 'invalid_parameter_value'; end if;
  if p_round is not null and p_round <> v_round then
    raise exception 'workflow: stale review round'; end if;

  -- typed anchor validation (the 001300 anchor trigger is the last line of defence)
  if p_section_id is not null and not exists (
    select 1 from manual_sections
    where id = p_section_id and manual_version_id = p_manual_version_id and organization_id = v_org
  ) then
    raise exception 'invalid anchor: the section is not part of this manual version'
      using errcode = 'foreign_key_violation'; end if;
  if p_block_id is not null and not exists (
    select 1 from manual_blocks mb
    join manual_sections ms on ms.id = mb.manual_section_id
    where mb.id = p_block_id and ms.manual_version_id = p_manual_version_id and mb.organization_id = v_org
  ) then
    raise exception 'invalid anchor: the block is not part of this manual version'
      using errcode = 'foreign_key_violation'; end if;

  insert into review_comments
    (organization_id, manual_version_id, round_number, review_type, author_id, section_id, block_id, body)
  values
    (v_org, p_manual_version_id, v_round, p_review_type, v_actor, p_section_id, p_block_id, v_body)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'round', v_round, 'reviewType', p_review_type, 'resolved', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. set_review_comment_resolved  (assigned reviewer of the comment's type)
-- ---------------------------------------------------------------------------
create or replace function public.set_review_comment_resolved(
  p_comment_id uuid,
  p_resolved   boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid;
  v_mv    uuid;
  v_type  text;
  v_actor uuid := auth.uid();
  v_tech  uuid;
  v_comp  uuid;
  v_rows  integer;
begin
  select rc.organization_id, rc.manual_version_id, rc.review_type
    into v_org, v_mv, v_type
  from review_comments rc where rc.id = p_comment_id;
  if v_org is null then raise exception 'review comment not found' using errcode = 'no_data_found'; end if;

  select technical_reviewer_id, compliance_reviewer_id into v_tech, v_comp
  from manual_versions where id = v_mv;

  if not app.is_service_request() then
    if v_actor is null then raise exception 'forbidden: authentication required' using errcode = 'insufficient_privilege'; end if;
    if v_type = 'TECHNICAL' then
      if not (app.has_role(v_org, 'TECHNICAL_REVIEWER') or app.has_role(v_org, 'ADMIN')) or v_tech is distinct from v_actor then
        raise exception 'forbidden: only the assigned technical reviewer may resolve or reopen a technical comment'
          using errcode = 'insufficient_privilege'; end if;
    else
      if not (app.has_role(v_org, 'COMPLIANCE_REVIEWER') or app.has_role(v_org, 'ADMIN')) or v_comp is distinct from v_actor then
        raise exception 'forbidden: only the assigned compliance reviewer may resolve or reopen a compliance comment'
          using errcode = 'insufficient_privilege'; end if;
    end if;
  end if;

  if p_resolved then
    update review_comments set resolved = true, resolved_by = v_actor, resolved_at = now()
    where id = p_comment_id;
  else
    update review_comments set resolved = false, resolved_by = null, resolved_at = null
    where id = p_comment_id;
  end if;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'review comment not found' using errcode = 'no_data_found'; end if;

  return jsonb_build_object('id', p_comment_id, 'resolved', p_resolved);
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE hardening (mirrors 20260901000600 / 20260901001400)
-- ---------------------------------------------------------------------------
revoke execute on function public.create_review_comment(uuid, text, integer, uuid, uuid, text) from public, anon;
revoke execute on function public.set_review_comment_resolved(uuid, boolean) from public, anon;

grant execute on function public.create_review_comment(uuid, text, integer, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.set_review_comment_resolved(uuid, boolean) to authenticated, service_role;
