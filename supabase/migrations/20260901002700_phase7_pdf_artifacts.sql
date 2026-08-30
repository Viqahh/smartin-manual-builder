-- Phase 7 · Slice 4B — immutable PDF artifact lifecycle.
--
-- New file after 20260901002600 (00100–02600 are deployed/frozen and NOT modified).
--
-- WHY: Slice 4 generated the PDF synchronously inside every `GET /manual/<slug>/<version>/pdf`
-- request (headless Chromium per request). That is correct for an isolated call but is NOT
-- reliable under concurrent load on the current Vercel plan (Hobby + Fluid Compute): a warm
-- instance intermittently OOM-kills Chromium at launch. Decision: OPTION B — generate the PDF
-- ONCE per immutable published snapshot, store it as an immutable artifact in a private bucket,
-- and serve every public download from that stored object. `GET /pdf` never launches Chromium.
--
-- CORE INVARIANT: one immutable published snapshot  =  one immutable READY PDF artifact.
-- Once an artifact is READY its snapshot identity, frozen hash, storage location, pdf bytes hash,
-- byte size and page count cannot be changed by ordinary application actions. A new manual output
-- requires a NEW published manual version, never mutation of an existing READY artifact. ARCHIVED
-- versions keep their original READY artifact byte-for-byte.
--
-- Adds:
--   * storage bucket `manual-pdf-artifacts` (PRIVATE — no anon/authenticated storage policy at all;
--     the trusted server (service role) is the only reader/writer)
--   * table `published_pdf_artifacts` — one row per `published_snapshots` row (UNIQUE), lifecycle
--     PENDING -> GENERATING -> READY, failure path GENERATING -> FAILED, retry FAILED -> GENERATING,
--     expired-lease recovery GENERATING -> GENERATING
--   * BEFORE UPDATE trigger `app.guard_pdf_artifact_update` — creation-frozen columns are always
--     immutable; a READY row is fully immutable except `updated_at`; only the enumerated status
--     transitions are allowed (defence-in-depth, runs even for the RPCs / postgres)
--   * SECURITY DEFINER RPCs (owner postgres, hardened search_path, SERVICE-ROLE execute only):
--       ensure_pdf_artifact(snapshot)                      -> idempotent PENDING row
--       claim_pdf_artifact_generation(snapshot, seconds)   -> atomic distributed generation lock
--       complete_pdf_artifact_generation(snapshot, lease, hash, key, sha, size, pages) -> READY
--       fail_pdf_artifact_generation(snapshot, lease, code, message)                   -> FAILED
--
-- Write boundary matches Phase 7 slice 1: the artifact table gets SELECT-only grants (org-member
-- RLS + service_role for the server read path). NO INSERT/UPDATE/DELETE grant to anyone — the only
-- writers are the four RPCs above.

-- ---------------------------------------------------------------------------
-- 0. private artifact bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('manual-pdf-artifacts', 'manual-pdf-artifacts', false)
on conflict (id) do nothing;
-- Deliberately NO `storage.objects` policy for anon / authenticated on this bucket: published PDF
-- artifacts are read and written ONLY by the trusted server via the service role (which bypasses
-- RLS). An anonymous or authenticated direct Storage request for a `manual-pdf-artifacts` object
-- has no policy and is denied.

-- ---------------------------------------------------------------------------
-- 1. published_pdf_artifacts
-- ---------------------------------------------------------------------------
create table published_pdf_artifacts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references organizations (id) on delete cascade,
  -- ONE artifact per immutable published snapshot
  published_snapshot_id uuid not null unique,
  manual_version_id     uuid not null,
  -- frozen at artifact creation; equals published_snapshots.content_hash and never changes
  snapshot_content_hash text not null check (snapshot_content_hash ~ '^[0-9a-f]{64}$'),
  -- PDF generation pipeline / storage-key schema version
  artifact_version      integer not null default 1 check (artifact_version >= 1),
  status                text not null default 'PENDING'
                          check (status in ('PENDING', 'GENERATING', 'READY', 'FAILED')),
  storage_bucket        text not null default 'manual-pdf-artifacts',
  -- content-addressed, server-only: pdf/v<artifact_version>/<snapshot_content_hash>.pdf
  storage_key           text check (storage_key is null or storage_key ~ '^pdf/v[0-9]+/[0-9a-f]{64}\.pdf$'),
  pdf_sha256            text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size             bigint check (byte_size is null or (byte_size > 0 and byte_size <= 52428800)),
  page_count            integer check (page_count is null or page_count > 0),
  attempt_count         integer not null default 0,
  -- active generation lease (present iff GENERATING)
  lease_token           uuid,
  lease_expires_at      timestamptz,
  -- sanitized failure info only — never a secret / token / URL / stack with credentials
  failure_code          text check (failure_code is null or char_length(failure_code) <= 40),
  failure_message       text check (failure_message is null or char_length(failure_message) <= 300),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  generated_at          timestamptz,
  unique (id, organization_id),
  foreign key (published_snapshot_id, organization_id)
    references published_snapshots (id, organization_id) on delete cascade,
  foreign key (manual_version_id, organization_id)
    references manual_versions (id, organization_id) on delete restrict,
  -- a lease exists exactly while GENERATING
  constraint pdf_artifact_lease_iff_generating
    check ((status = 'GENERATING') = (lease_token is not null)),
  constraint pdf_artifact_lease_expiry_iff_generating
    check ((status = 'GENERATING') = (lease_expires_at is not null)),
  -- READY is complete
  constraint pdf_artifact_ready_complete check (
    status <> 'READY' or (
      storage_key is not null
      and pdf_sha256 is not null
      and byte_size is not null
      and generated_at is not null
    )
  )
);

create index published_pdf_artifacts_recover_idx
  on published_pdf_artifacts (status, lease_expires_at);
create index published_pdf_artifacts_org_idx
  on published_pdf_artifacts (organization_id);

create trigger published_pdf_artifacts_touch
  before update on published_pdf_artifacts
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. immutability + transition guard (runs for EVERY caller incl. the RPCs / postgres)
-- ---------------------------------------------------------------------------
create or replace function app.guard_pdf_artifact_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- creation-frozen columns — immutable in every state
  if new.organization_id       is distinct from old.organization_id
     or new.published_snapshot_id is distinct from old.published_snapshot_id
     or new.manual_version_id  is distinct from old.manual_version_id
     or new.snapshot_content_hash is distinct from old.snapshot_content_hash
     or new.artifact_version   is distinct from old.artifact_version
     or new.storage_bucket     is distinct from old.storage_bucket
     or new.created_at         is distinct from old.created_at then
    raise exception 'published_pdf_artifacts: snapshot identity / frozen hash / artifact_version / storage_bucket are immutable'
      using errcode = 'restrict_violation';
  end if;

  -- a READY artifact is an immutable publication record: nothing may change but updated_at
  if old.status = 'READY' then
    if new.status        is distinct from old.status
       or new.storage_key   is distinct from old.storage_key
       or new.pdf_sha256    is distinct from old.pdf_sha256
       or new.byte_size     is distinct from old.byte_size
       or new.page_count    is distinct from old.page_count
       or new.attempt_count is distinct from old.attempt_count
       or new.lease_token   is distinct from old.lease_token
       or new.lease_expires_at is distinct from old.lease_expires_at
       or new.failure_code  is distinct from old.failure_code
       or new.failure_message is distinct from old.failure_message
       or new.generated_at  is distinct from old.generated_at then
      raise exception 'published_pdf_artifacts: a READY artifact is immutable'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  -- allowed status changes (READY handled above)
  if not (
       (old.status = new.status and new.status in ('PENDING', 'GENERATING', 'FAILED'))
    or (old.status = 'PENDING'    and new.status = 'GENERATING')
    or (old.status = 'GENERATING' and new.status = 'READY')
    or (old.status = 'GENERATING' and new.status = 'FAILED')
    or (old.status = 'FAILED'     and new.status = 'GENERATING')
  ) then
    raise exception 'published_pdf_artifacts: illegal status transition % -> %', old.status, new.status
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;
revoke execute on function app.guard_pdf_artifact_update() from public;
create trigger published_pdf_artifacts_guard
  before update on published_pdf_artifacts
  for each row execute function app.guard_pdf_artifact_update();

-- ---------------------------------------------------------------------------
-- 3. RLS + grants — SELECT only; NO client/service write grant
-- ---------------------------------------------------------------------------
alter table published_pdf_artifacts enable row level security;

create policy published_pdf_artifacts_select_members on published_pdf_artifacts
  for select to authenticated
  using (organization_id in (select app.member_org_ids()));

grant select on published_pdf_artifacts to authenticated;
grant select on published_pdf_artifacts to service_role;
-- deliberately NO insert/update/delete grant: the only writers are the four RPCs below
-- (SECURITY DEFINER, owner postgres). A direct PostgREST write by anon / authenticated /
-- service_role is denied by the missing grant.

-- ---------------------------------------------------------------------------
-- 4. ensure_pdf_artifact — idempotent PENDING row for one immutable snapshot
-- ---------------------------------------------------------------------------
create or replace function public.ensure_pdf_artifact(p_published_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_mv      uuid;
  v_hash    text;
  v_row     published_pdf_artifacts;
begin
  select ps.organization_id, ps.manual_version_id, ps.content_hash
    into v_org, v_mv, v_hash
  from published_snapshots ps
  where ps.id = p_published_snapshot_id;
  if v_org is null then
    raise exception 'published snapshot not found' using errcode = 'no_data_found';
  end if;

  insert into published_pdf_artifacts
    (organization_id, published_snapshot_id, manual_version_id, snapshot_content_hash)
  values (v_org, p_published_snapshot_id, v_mv, v_hash)
  on conflict (published_snapshot_id) do nothing;

  select * into v_row from published_pdf_artifacts
  where published_snapshot_id = p_published_snapshot_id;

  return jsonb_build_object(
    'id',                v_row.id,
    'status',            v_row.status,
    'snapshotContentHash', v_row.snapshot_content_hash,
    'artifactVersion',   v_row.artifact_version,
    'attemptCount',      v_row.attempt_count,
    'storageKey',        v_row.storage_key,
    'pdfSha256',         v_row.pdf_sha256,
    'byteSize',          v_row.byte_size,
    'pageCount',         v_row.page_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. claim_pdf_artifact_generation — atomic, distributed generation lock
--
--   READY                         -> {outcome: 'ready',       ...metadata}
--   GENERATING + live lease       -> {outcome: 'in_progress'}
--   PENDING | FAILED | expired    -> transition to GENERATING, mint a fresh lease,
--                                    attempt_count += 1
--                                 -> {outcome: 'claimed', leaseToken, leaseExpiresAt,
--                                     snapshotContentHash, artifactVersion, attemptCount}
--
-- Row-locked with FOR UPDATE: two concurrent callers for the same snapshot serialise here, so at
-- most one ever receives 'claimed' — i.e. at most one Chromium generation runs.
-- ---------------------------------------------------------------------------
create or replace function public.claim_pdf_artifact_generation(
  p_published_snapshot_id uuid,
  p_lease_seconds         integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   published_pdf_artifacts;
  v_lease uuid;
  -- default 300 s (well over measured generation time); floor 5 s only so an integration test can
  -- exercise expired-lease recovery without a multi-minute wait; ceiling 1800 s.
  v_secs  integer := greatest(5, least(coalesce(p_lease_seconds, 300), 1800));
begin
  perform public.ensure_pdf_artifact(p_published_snapshot_id);

  select * into v_row from published_pdf_artifacts
  where published_snapshot_id = p_published_snapshot_id
  for update;
  if v_row.id is null then
    raise exception 'pdf artifact not found' using errcode = 'no_data_found';
  end if;

  if v_row.status = 'READY' then
    return jsonb_build_object(
      'outcome',           'ready',
      'snapshotContentHash', v_row.snapshot_content_hash,
      'artifactVersion',   v_row.artifact_version,
      'storageKey',        v_row.storage_key,
      'pdfSha256',         v_row.pdf_sha256,
      'byteSize',          v_row.byte_size,
      'pageCount',         v_row.page_count);
  end if;

  if v_row.status = 'GENERATING' and v_row.lease_expires_at > now() then
    return jsonb_build_object('outcome', 'in_progress', 'leaseExpiresAt', v_row.lease_expires_at);
  end if;

  -- PENDING, FAILED, or GENERATING with an expired lease -> (re)claim
  v_lease := gen_random_uuid();
  update published_pdf_artifacts
     set status           = 'GENERATING',
         lease_token       = v_lease,
         lease_expires_at  = now() + make_interval(secs => v_secs),
         attempt_count     = attempt_count + 1,
         failure_code      = null,
         failure_message   = null
   where published_snapshot_id = p_published_snapshot_id;

  return jsonb_build_object(
    'outcome',           'claimed',
    'leaseToken',        v_lease,
    'leaseExpiresAt',    now() + make_interval(secs => v_secs),
    'snapshotContentHash', v_row.snapshot_content_hash,
    'artifactVersion',   v_row.artifact_version,
    'attemptCount',      v_row.attempt_count + 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. complete_pdf_artifact_generation — GENERATING -> READY (controlled)
-- ---------------------------------------------------------------------------
create or replace function public.complete_pdf_artifact_generation(
  p_published_snapshot_id uuid,
  p_lease_token           uuid,
  p_snapshot_content_hash text,
  p_storage_key           text,
  p_pdf_sha256            text,
  p_byte_size             bigint,
  p_page_count            integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row published_pdf_artifacts;
begin
  select * into v_row from published_pdf_artifacts
  where published_snapshot_id = p_published_snapshot_id
  for update;
  if v_row.id is null then
    raise exception 'pdf artifact not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'GENERATING' then
    raise exception 'pdf artifact is % (expected GENERATING)', v_row.status
      using errcode = 'invalid_parameter_value';
  end if;
  if p_lease_token is null or p_lease_token is distinct from v_row.lease_token then
    raise exception 'pdf artifact: generation lease token mismatch'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_snapshot_content_hash is distinct from v_row.snapshot_content_hash then
    raise exception 'pdf artifact: snapshot content hash mismatch (frozen)'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_storage_key is null
     or p_storage_key !~ ('^pdf/v' || v_row.artifact_version || '/' || v_row.snapshot_content_hash || '\.pdf$') then
    raise exception 'pdf artifact: storage key does not match the content-addressed convention'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_pdf_sha256 is null or p_pdf_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'pdf artifact: invalid pdf sha-256' using errcode = 'invalid_parameter_value';
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > 52428800 then
    raise exception 'pdf artifact: invalid byte size' using errcode = 'invalid_parameter_value';
  end if;

  update published_pdf_artifacts
     set status          = 'READY',
         storage_key      = p_storage_key,
         pdf_sha256       = p_pdf_sha256,
         byte_size        = p_byte_size,
         page_count       = p_page_count,
         generated_at     = now(),
         lease_token      = null,
         lease_expires_at = null,
         failure_code     = null,
         failure_message  = null
   where published_snapshot_id = p_published_snapshot_id;

  return jsonb_build_object('outcome', 'ready', 'pdfSha256', p_pdf_sha256, 'byteSize', p_byte_size);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. fail_pdf_artifact_generation — GENERATING -> FAILED (sanitized info only)
-- ---------------------------------------------------------------------------
create or replace function public.fail_pdf_artifact_generation(
  p_published_snapshot_id uuid,
  p_lease_token           uuid,
  p_failure_code          text,
  p_failure_message       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row published_pdf_artifacts;
begin
  select * into v_row from published_pdf_artifacts
  where published_snapshot_id = p_published_snapshot_id
  for update;
  if v_row.id is null then
    raise exception 'pdf artifact not found' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'GENERATING' then
    raise exception 'pdf artifact is % (expected GENERATING)', v_row.status
      using errcode = 'invalid_parameter_value';
  end if;
  if p_lease_token is null or p_lease_token is distinct from v_row.lease_token then
    raise exception 'pdf artifact: generation lease token mismatch'
      using errcode = 'invalid_parameter_value';
  end if;

  update published_pdf_artifacts
     set status          = 'FAILED',
         lease_token      = null,
         lease_expires_at = null,
         failure_code     = nullif(left(coalesce(p_failure_code, 'unknown'), 40), ''),
         failure_message  = nullif(left(coalesce(p_failure_message, ''), 300), '')
   where published_snapshot_id = p_published_snapshot_id;

  return jsonb_build_object('outcome', 'failed');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. EXECUTE hardening — SERVICE-ROLE ONLY (mirrors publish/archive)
-- ---------------------------------------------------------------------------
revoke execute on function public.ensure_pdf_artifact(uuid) from public, anon, authenticated;
revoke execute on function public.claim_pdf_artifact_generation(uuid, integer) from public, anon, authenticated;
revoke execute on function public.complete_pdf_artifact_generation(uuid, uuid, text, text, text, bigint, integer) from public, anon, authenticated;
revoke execute on function public.fail_pdf_artifact_generation(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.ensure_pdf_artifact(uuid) to service_role;
grant execute on function public.claim_pdf_artifact_generation(uuid, integer) to service_role;
grant execute on function public.complete_pdf_artifact_generation(uuid, uuid, text, text, text, bigint, integer) to service_role;
grant execute on function public.fail_pdf_artifact_generation(uuid, uuid, text, text) to service_role;
