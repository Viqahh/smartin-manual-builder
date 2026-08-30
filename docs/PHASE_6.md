# Phase 6 — Reviews, versioning & immutable publication snapshot

> **Status: IN PROGRESS. Slices 1–5 of 7 complete and verified against Supabase DEV. NOT COMMITTED, NOT PUSHED.**
>
> Phase 6 adds the real review workflow (state machine, reviewer assignment, queues, rounds,
> decisions, comments), durable contributor provenance + self-approval prevention, structured
> changelog + Pasal 8 reminder, manual-version cloning, and the immutable `published_snapshots`
> row (created by an atomic publish transaction; consumed by Phase 7). It never grants
> regulatory approval — every visible decision string is "Disetujui reviewer teknis/kepatuhan —
> <nama>, <waktu>" with the note "Keputusan internal Smartin atas dokumentasi, bukan persetujuan
> regulator."

Approved Phase 5 commit: `0034d30d145f6591e2aaeabaf2231f598b000da7`.

Baseline read (§0): `docs/IMPLEMENTATION_PLAN.md` Phase 6, `docs/ACCEPTANCE_CRITERIA.md`
AC-P6-1…16, `docs/PRD.md` (PRD-REV-*, PRD-OUT-*, PRD-VER-*, PRD-SEC-007, PRD-SUCC-004/006,
OQ-007/010), `docs/DATA_MODEL.md`, `docs/COMPLIANCE_REQUIREMENTS.md` §7/§8/§13, current migrations
`…000100`–`…001200`, `lib/permissions/actions.ts`, `lib/manual/view-model.ts`, `lib/ai/hash.ts`
(canonical hash pattern), `lib/editor/autosave-queue.ts` (`stableStringify`), `features/*` server
actions, `supabase/migrations/20260901000600_rpc.sql` (SECURITY DEFINER pattern).

---

## Phase 7 boundary (do NOT implement in Phase 6)

No public `/manual/[eaSlug]/[version]` route, no public search / TOC / version switcher, no PDF
generation, no Playwright print job, no signed print route, no public asset copy/serving, no PDF
filename handling, no visual-regression PDF suite. **Phase 6 produces the immutable
`published_snapshots` row; Phase 7 consumes it.**

---

## Ponytail / simplicity decisions

| Decision | Why |
|---|---|
| **Reuse the existing `manual_status` enum** (all 7 states already shipped in `…000300`) | No enum migration; the state machine module just encodes the legal edges. |
| **State machine = one pure module** `lib/reviews/state-machine.ts` (transition table + typed `WorkflowError`) | Slice-2/6 commands each call `assertTransition(from, to)`; the DB has its own status guards. No workflow-framework abstraction. |
| **Content fingerprint = a deterministic projection of the *same* `ManualViewModel`** hashed with the repo's `stableStringify` + `createHash("sha256")` (`lib/ai/hash.ts` pattern) | No second content model; key-order-insensitive by construction; slice-6 snapshot payload will be the same projection. |
| **Contributor provenance = one AFTER-ROW trigger** on `manual_sections` + `manual_blocks` that upserts `manual_version_contributors` for `auth.uid()` | One guard where every authoring mutation routes through — not a hook in ~15 server actions. `auth.uid() IS NULL` (migration/seed/service) is skipped, so no fabricated history. An accepted AI proposal writes the block as the accepting editor → attributed correctly with zero extra code. |
| **New foundation tables are SELECT-only for members this slice** — writes arrive via later-slice SECURITY DEFINER RPCs / the trigger | "Do not prematurely grant broad client mutation rights." |
| **DB constraints carry the invariants** — `unique (manual_version_id, round_number, review_type)`, `unique (manual_version_id, user_id)` on contributors, `unique manual_version_id` on snapshots, composite FKs for cross-org integrity, anchor trigger for same-version comments, immutability trigger on `reviews` | Invariants belong in the database, not only in app code. |

---

## Resolved open questions

### PRD-OQ-007 — publishing authority → **ADMIN ONLY**

A `COMPLIANCE_REVIEWER` may **approve the documentation** in the Smartin workflow
(`COMPLIANCE_REVIEW → APPROVED`). That approval does **not** grant publishing authority. Only an
`ADMIN` may execute `APPROVED → PUBLISHED` (slice 6: the `publish_manual_version` RPC asserts
`app.is_admin(org)`). `manual:publish` therefore stays an ADMIN-only action; it is **not** added
to `COMPLIANCE_REVIEWER_ACTIONS`. This is an internal Smartin workflow decision — **not**
regulatory approval, and it is never labelled as such (GI-1 / §47).

### PRD-OQ-010 — changelog ↔ Pasal 8 depth → **record + remind only**

For an **IN_SCOPE** (Indonesian PBK) manual, a feature/behaviour changelog entry
(`changelog_entries.is_feature_change = true`):

1. is **recorded** as a structured `changelog_entries` row (Added/Changed/Fixed/Breaking);
2. **surfaces a clearly-worded operational reminder** — client approval is required where
   applicable, and the change must be reported to Kepala Bappebti where applicable (Perba
   12/2022 Pasal 8);
3. the tool does **not** create a regulatory filing, submit anything, simulate approval,
   generate a fake client-approval artefact, or mark the obligation completed.

For an **OUT_OF_SCOPE** EA the reminder is **not** presented as an applicable Indonesian PBK
legal requirement. (Slice 4 wires the reminder UI; slice 1 ships the `changelog_entries` table.)

---

## Internal implementation slices (Phase 6 stays ONE phase)

| # | Slice | Status | ACs it evidences |
|---|---|---|---|
| 1 | **Foundation** — migration `…001300`, state-machine module, content fingerprint, contributor provenance + backfill, new tables + RLS + DB invariants | **DONE + verified** | groundwork for P6-2 / P6-6 / P6-10 |
| 2 | **Workflow commands + assignment + queues** — migration `…001400`, 5 SECURITY DEFINER RPCs, DB guards (workflow-column + read-only-by-state), `/reviews/*` real queues, submit wired to Phase 5 | **DONE + verified** | **P6-3, P6-5, P6-6, P6-7** PASS; P6-2 / P6-8 / P6-13 partial |
| 3 | **Comments** — migration `…001500`, `create_review_comment` / `set_review_comment_resolved` RPCs, body-immutability guard, `listReviewComments`, builder "Komentar" tab + anchor navigation | **DONE + verified** | **P6-4 PASS; P6-8 PASS** (cross-round comment persistence completes the slice-2 evidence) |
| 4 | **Structured changelog + Pasal 8 reminder** — migration `…001600`, 4 CRUD/reorder RPCs, DRAFT-only guard, contributor trigger, BREAKING-impact CHECK, source-EA-version lineage guard, authoritative review fingerprint (`manualReviewFingerprint`), Chapter 14 editor + reminder | **DONE + verified** | **P6-14 PASS** |

| 5 | **Clone manual version** — migrations `…001700` (changelog source now mandatory) + `…001800` (`clone_manual_version` atomic RPC), parameterTable group remap by name, `cloneManualVersion` action + Chapter-Metadata clone form | **DONE + verified** | **P6-11 PASS** |

| 6 | Publish + snapshot + canonical hash + immutability triggers + archive (atomic RPCs, fault injection) | not started | P6-9, P6-10, P6-12, P6-13 |
| 7 | `/manuals/[id]/reviews` history + audit exactly-once sweep + browser ×6 + responsive + regression + final matrix | not started | P6-1, P6-13, P6-15, P6-16 |

---

## Slice 1 — foundation (implemented + verified)

### Migration `20260901001300_phase6_foundation.sql`

Added **after** `…001200` (not a deployed-migration rewrite). Applied to Supabase DEV:
`db push --dry-run` → `db push` → `migration list` shows **14 migrations, `…001300` local ==
remote**.

**`manual_versions`** — `+ technical_reviewer_id uuid → profiles`, `+ compliance_reviewer_id
uuid → profiles`, `+ review_round integer not null default 0 check (>= 0)`,
`+ submitted_content_hash text`.

**`manual_version_contributors`** — durable authorship provenance.
`(id, organization_id, manual_version_id, user_id, first_contributed_at, last_contributed_at,
contribution_count)`; `unique (manual_version_id, user_id)`; composite FK
`(manual_version_id, organization_id) → manual_versions(id, organization_id)` (cross-org row
impossible). Written **only** by `app.record_manual_contributor()` (SECURITY DEFINER AFTER-ROW
trigger on `manual_sections` + `manual_blocks`): records `auth.uid()` for
create/update/soft-delete/restore/reorder of any block, and add/rename/delete/reorder of any
section. `auth.uid() IS NULL` (migration / seed / service-role) → skipped. No client write
policy.

**`reviews`** — one decision per `(manual_version_id, round_number, review_type)` (unique).
`review_type ∈ {TECHNICAL, COMPLIANCE}`, `decision ∈ {APPROVE, REQUEST_CHANGES}`,
`check (decision = 'APPROVE' OR btrim(summary) <> '')` (REQUEST_CHANGES needs a summary),
`reviewed_content_hash text not null`, `reviewer_id → profiles`. §39 immutability:
`app.reject_review_mutation()` BEFORE UPDATE/DELETE raises `restrict_violation` — **UPDATE is
blocked for every caller** (a decision can never be rewritten); DELETE is blocked for app
callers and permitted only for a trusted service request so a legitimate `manual_versions`
cascade / infra cleanup still works. No client write policy.

**`review_comments`** — `(round_number, review_type, author_id, section_id?, block_id?, body,
resolved, resolved_by, resolved_at, timestamps)`. `check (not (section_id is not null and
block_id is not null))` (at most one anchor). Composite FKs `(section_id, organization_id)` /
`(block_id, organization_id)` → cross-org anchor impossible. `app.assert_review_comment_anchor()`
BEFORE INSERT/UPDATE → the anchored section/block must belong to the **same** manual version (a
foreign UUID is rejected). No client write policy (slice 3).

**`changelog_entries`** — `(position, entry_type ∈ {ADDED,CHANGED,FIXED,BREAKING}, body,
source_ea_version_id?, is_feature_change, open_position_impact?)`. FK
`(source_ea_version_id, organization_id) → ea_versions` — a reference only; **EA facts stay in
the EA Version** (no parameter definitions in changelog rows). No client write policy (slice 4).

**`published_snapshots`** — `(manual_version_id unique, render_json jsonb, content_hash,
public_slug, public_version, published_at)`; `unique (organization_id, public_slug,
public_version)`; FK `(manual_version_id, organization_id) → manual_versions … on delete
restrict`. **At most one snapshot per manual version.** No client write policy — the publish RPC
(slice 6) is the only writer; immutability trigger is slice 6.

**`manual_blocks`** — `+ unique (id, organization_id)` (composite-FK target for the comment
block anchor).

### RLS / relational integrity design

- All 5 new tables: `enable row level security` + a single `*_select_members` policy
  (`organization_id in (select app.member_org_ids())`). **No INSERT/UPDATE/DELETE policy this
  slice.** Grants: `authenticated` → SELECT; `service_role` → full DML (data-API "expose new
  tables" = OFF).
- Every org-owned row carries `organization_id` + a composite FK to its parent keyed on
  `(parent_id, organization_id)` → an Org-A row can never reference an Org-B parent, and a
  cross-org contributor/comment/changelog/snapshot row raises `23503`.
- Anon: no policy applies → 0 rows on SELECT, write denied.

### State-machine domain — `lib/reviews/state-machine.ts`

Pure. `TRANSITIONS: Record<ManualState, ManualState[]>` encodes exactly:
`DRAFT→TECHNICAL_REVIEW`; `TECHNICAL_REVIEW→{COMPLIANCE_REVIEW, CHANGES_REQUESTED}`;
`COMPLIANCE_REVIEW→{APPROVED, CHANGES_REQUESTED}`; `CHANGES_REQUESTED→DRAFT`;
`APPROVED→PUBLISHED`; `PUBLISHED→ARCHIVED`; `ARCHIVED→∅`. `canTransition(from, to)`,
`assertTransition(from, to)` (throws typed `WorkflowError { code: "WORKFLOW", from, to }` for an
illegal edge, an unknown status string, or a no-op `from === to`), `isContentEditable(state)`
(only `DRAFT`), `legalEdges()`. Slice-2/6 commands will not yet be wired — this slice ships the
graph + guard only.

### Content fingerprint — `lib/reviews/fingerprint.ts`

`computeContentFingerprint({ vm, changelog? }) → sha256 hex`. `projectReviewContent()` is a
deterministic projection of the `ManualViewModel`:

- **Included** (review-relevant resolved content/facts): manual id + locale; manual-version id +
  version string; EA product id/name/slug/description; **linked EA version** id/version/platform/
  releaseDate/requirements/support; organization id/name; developer name; ordered
  **supportedSetups** (symbol/timeframe/presetRef/testedMinimumLot/notes/isSupported/position);
  ordered **parameterGroups → parameters** keyed by name/technicalName with
  defaultValue/type/unit/safeRange/description/orderEffect/mutability/required/position; ordered
  **sections** (key/title/required/isCustom/position) → ordered **blocks**
  (type/position/payload/parameterGroupIds/imageAssetId); **image metadata** (altText/caption)
  keyed by asset id; **changelog** rows (position/entryType/body/sourceEaVersionId/
  isFeatureChange/openPositionImpact).
- **Excluded** (volatile / non-content): signed URLs, `updatedAt` / query timestamps,
  `rowVersion`, `completionState`, the workflow `status`, DB row ids for setups/params/sections/
  blocks (content identity is name/technicalName, not the uuid), auth/session, secrets, provider
  metadata, request metadata.
- Serialised with `stableStringify` (recursively key-sorted) → object key **insertion order
  never** changes the digest; section/block **order does** (arrays are hashed in order).

### Contributor model & historical backfill

- **Recorded** on a successful `manual_sections` / `manual_blocks` write by an authenticated user
  (create manual version via template instantiation as the creator; edit content; add / delete /
  restore / reorder a block; add / rename / delete / reorder a custom chapter). An accepted AI
  proposal is a `manual_blocks` UPDATE by the accepting editor → that editor is recorded.
- **Not recorded**: reviewer comments (different table), checklist evaluation (`checklist_results`
  write — verified in the integration suite: 0 contributor rows), AI proposal *rejection* (no
  block write). A service-role / seed write (`auth.uid() IS NULL`) is skipped.
- **Backfill** (in the migration, from RELIABLE recorded actor data only): `audit_events` with
  `action = 'manual:create'` (`entity_type = 'manual'`) → the manual's version(s); `manual:update`
  on `entity_type = 'manual_block'` → the block's section's version; on `manual_section` → the
  section's version. `on conflict (manual_version_id, user_id) do nothing`.
- **Historical limitation (documented):** the pre-Phase-6 schema never stored a per-manual-version
  `created_by`, and many early edits audited only `entity_type = 'manual:update'` with the block
  id (not the version). Editors whose only trace is such a coarse audit row are still recovered
  via the block→section→version join; anything not present in `audit_events` at all (e.g. edits
  made before audit coverage, or via direct DB writes) is **not fabricated**. On the DEV project
  this backfill inserted 0 rows (all manual versions are freshly seeded with no historical
  block-authoring audit); the trigger captures every contribution from Phase 6 forward.

### Slice 1 tests

**Unit** (`npm run test` — 355 passed / 64 skipped total):
- `tests/unit/review-state-machine.test.ts` (18) — all 8 legal edges succeed
  (`canTransition` + `assertTransition`); 21 representative illegal edges + every no-op
  (`from === to`) + unknown status strings throw `WorkflowError`; `legalEdges()` is exactly the 8
  documented pairs; only `DRAFT` is content-editable.
- `tests/unit/review-fingerprint.test.ts` (18) — identical logical content → identical hash;
  stable across 8 recomputations; **reversing every object's key order → same digest**; section
  order / block order / manual text / parameter default / new parameter / supported setup / EA
  version identity+requirements / changelog entry each **change** the hash; signed-URL differences
  do **not** change it (but image alt/caption do); `updatedAt` / `rowVersion` / `status` /
  `completionState` changes do **not**; setup/param/section/block **row-id** rewrites do **not**;
  the projection contains no `token=` / `http(s)://` / `bearer ` / `sb_secret`.

**Live integration** (`tests/integration/rls.test.ts` → "Phase 6 slice 1 — foundation schema +
RLS + provenance", 14 tests, Supabase DEV, **64 passed / 0 failed / 0 skipped**, run twice):
- `manual_versions` gained the four columns (`review_round = 0`, reviewer ids NULL,
  `submitted_content_hash` NULL).
- An authenticated author edit records **exactly one** contributor row for that user; a second
  edit bumps `contribution_count`, still one row; `unique (manual_version_id, user_id)` → `23505`
  on a duplicate.
- A `checklist_results` write creates **no** contributor row; a service-role (no `auth.uid()`)
  block write creates **no** contributor row; a non-service caller **cannot** insert
  `manual_version_contributors` (no policy); a cross-org contributor row → `23503`.
- `reviews`: UPDATE blocked for service-role (`§39`); an app-caller DELETE affects 0 rows and the
  decision survives; `REQUEST_CHANGES` with a whitespace summary rejected; a second technical
  decision in the same round → `23505`.
- `review_comments`: unknown section anchor rejected; wrong-org `manual_version` reference →
  `23503`; two anchors on one comment rejected.
- `changelog_entries`: wrong-org reference → `23503`; bad `entry_type` rejected.
- `published_snapshots`: a second snapshot for the same `manual_version_id` → `23505`; a
  non-service caller cannot insert one.
- Org B reads **0** rows of every Org-A foundation table; the Org-A member sees its own
  contributor rows; **anon** reads nothing and cannot insert.

**Regression** — full integration suite 64 passed ×2 (Phase 2–5 unchanged). Browser: on the DEV
`VMax EA (DEMO)` DRAFT, adding + editing a block with the contributor trigger live → autosave
"Tersimpan", **Undo clears / Redo restores**, block count correct; the edit recorded
`developer@` as a contributor (`contribution_count = 3`). All DEV fixtures then removed — VMAX_MV
back to steady state (0 blocks, 0 contributors, 0 checklist_results).

### Fixture / audit-note policy

Slice-1 tests seed rows under `manual_version_id = VMAX_MV` and delete them in `afterAll`
(`reviews` rows via the service-role DELETE carve-out; everything else normally). No
`audit_events` rows are written by slice 1. The one pre-existing Phase 5 `checklist:override_na`
DEV QA audit row is untouched (append-only; documented in `docs/PHASE_5.md` §21).

---

## Slice 2 — workflow commands + assignment + queues (implemented + verified)

### Migration `20260901001400_phase6_workflow.sql`

Added **after** `…001300` (neither deployed migration is modified). Applied to Supabase DEV
during slice-2 development (`db push --dry-run` → `db push` → `migration list` → **15
migrations, `…001400` local == remote**); re-applied 3× while the lock-free rewrite was
finalised (same uncommitted slice). The live suite passing against DEV is the standing proof
the RPCs + guards are deployed.

**Two `BEFORE` triggers — server-side, not a disabled editor:**

- `app.guard_manual_version_update()` (SECURITY **INVOKER**) on `manual_versions`. Any change to
  `status` / `review_round` / `submitted_content_hash` / `technical_reviewer_id` /
  `compliance_reviewer_id` / `published_at` from a caller whose `current_user` is not
  `postgres` / `supabase_admin` / `service_role` raises `insufficient_privilege` — so a **forged
  direct PostgREST `UPDATE … SET status=…` is rejected at the DB**, and the columns move only
  through the RPCs below (which run as `postgres` inside SECURITY DEFINER) or a trusted service
  request. Independently, a changed `technical_reviewer_id` / `compliance_reviewer_id` must be an
  **active membership of the same org with the matching role** or the write raises
  `check_violation` (defence in depth behind `assign_reviewers`).
- `app.assert_manual_version_draft()` (SECURITY **INVOKER**) on `manual_sections` +
  `manual_blocks` (`INSERT/UPDATE/DELETE`). A non-service caller mutating content while the owning
  `manual_versions.status <> 'DRAFT'` raises `insufficient_privilege` (`manual content is
  read-only unless the version is DRAFT …`). `CHANGES_REQUESTED` is **not** writable — the author
  must call `begin_revision` first. DRAFT autosave / undo / redo / row_version / conflict handling
  are untouched.

Both triggers are SECURITY INVOKER **on purpose**: a SECURITY DEFINER version ran as `postgres`
for every caller, so the `current_user` bypass always matched and the guard never fired for a
real PostgREST write. (This was the slice-2 hang root cause #1.)

**Five RPCs** — `security definer`, `set search_path = public`, authorise via `auth.uid()` +
the Phase 2 `app.*` helpers, write **exactly one** `audit_events` row inside the transaction,
return `jsonb`, `revoke … from public, anon` + `grant … to authenticated, service_role`
(mirrors `…000600`):

| RPC | Actor gate | Transition | Audit action |
|---|---|---|---|
| `assign_reviewers(mv, tech, comp)` | `app.is_admin(org)` | — (sets both reviewer ids; blocked once `PUBLISHED`/`ARCHIVED`) | `manual_version:assign_reviewers` |
| `submit_for_technical_review(mv, expected_round, hash)` | `app.can_author(org)` | `DRAFT → TECHNICAL_REVIEW`, `review_round++`, `submitted_content_hash = hash` | `manual_version:submit_review` |
| `record_technical_decision(mv, expected_round, decision, summary, current_hash)` | `has_role(TECHNICAL_REVIEWER|ADMIN)` **and** `technical_reviewer_id = auth.uid()` | `APPROVE → COMPLIANCE_REVIEW` / `REQUEST_CHANGES → CHANGES_REQUESTED` | `manual_version:technical_approve` \| `…_request_changes` |
| `record_compliance_decision(…)` | `has_role(COMPLIANCE_REVIEWER|ADMIN)` **and** `compliance_reviewer_id = auth.uid()` | `APPROVE → APPROVED` / `REQUEST_CHANGES → CHANGES_REQUESTED` | `manual_version:compliance_approve` \| `…_request_changes` |
| `begin_revision(mv, expected_round)` | `app.can_author(org)` | `CHANGES_REQUESTED → DRAFT`, `submitted_content_hash = NULL` (round **unchanged**) | `manual_version:begin_revision` |

**Concurrency is lock-free.** No `FOR UPDATE`, no advisory locks (a pooled connection whose
function `RAISE`d could strand either). Every state change is a single conditional
`UPDATE … WHERE status = <expected> AND review_round = <expected>`; `GET DIAGNOSTICS row_count =
0` → typed stale/workflow error. For the two decision RPCs the slice-1
`reviews (manual_version_id, round_number, review_type)` UNIQUE is the race winner-picker: the
losing `INSERT` hits `23505`, is caught, and re-raised as a typed error **before** any transition
or audit row is written. Deterministic business rejections use the default `raise_exception`
(P0001) — **never** `serialization_failure` (SQLSTATE 40001), which the PostgREST stack
auto-retries with backoff (slice-2 hang root cause #2).

**Content-hash binding (review of a moving target).** `submit_for_technical_review` stores a
fresh canonical fingerprint (`lib/reviews/fingerprint.ts`, computed in the server action, not
SQL). Before a technical **APPROVE** the action recomputes the fingerprint and the RPC rejects
`p_current_hash <> submitted_content_hash` with a typed `stale content` error. Before a
compliance **APPROVE** the RPC additionally requires that the **current-round technical APPROVE
row** recorded the same `reviewed_content_hash` — compliance is unreachable if the content moved
after technical sign-off. The stored hash is never silently updated mid-review.

### Server actions — `features/reviews/actions.ts` (`"use server"`)

No generic `setStatus`. `assignReviewers`, `submitForTechnicalReview`, `technicalDecision`,
`complianceDecision`, `beginRevision`. Each: `requireActiveOrg()` → `assertCan(roles, …)` → Zod
parse → `resolveVersion(orgId, manualId)` (loads the persisted `ManualViewModel` + the
`manual_versions` row) → for submit, `refreshValidation({ manualId })` and **bail with
`NOT_READY` + `blockingReasons` if `!eligibility.ready`** (a required in-scope `MISSING`; a
`WARNING` alone does not block) → `computeContentFingerprint({ vm })` → `supabase.rpc(…)` →
`mapRpcError` turns a raised message into a typed `ActionResult` code
(`SELF_APPROVAL` / `STALE` / `WORKFLOW` / `FORBIDDEN` / `NOT_FOUND`) with no SQL leak. The audit
row is written **inside** the RPC — the action never calls `writeAudit` (no double-log).
`"review:assign"` added to `ACTIONS` as an ADMIN-only action; `lib/errors.ts` `ActionResult`
codes gained `WORKFLOW | STALE | SELF_APPROVAL | NOT_READY`.

### Queues + UI

- `features/reviews/queue-contract.ts` — pure `REVIEW_QUEUE_STATUS` map:
  `technical → TECHNICAL_REVIEW`, `compliance → COMPLIANCE_REVIEW`. **Stage-specific: each queue
  filters on exactly one status, never a union.** Single source of truth, pinned by
  `tests/unit/review-queue-contract.test.ts`.
- `features/reviews/queries.ts` — `listReviewQueue(orgId, userId, roles, type)`:
  `.eq("status", REVIEW_QUEUE_STATUS[type])` + `.eq(<assignmentCol>, userId)` unless the caller
  is ADMIN, always org-scoped. **ADMIN drops only the assignment filter — never the stage/status
  filter**, so an admin on `/reviews/technical` sees only org items in `TECHNICAL_REVIEW`, and on
  `/reviews/compliance` only those in `COMPLIANCE_REVIEW`. `listAssignableReviewers(orgId, role)`
  (active memberships ⋈ profiles); `getReviewContext(orgId, manualVersionId)` (status, round,
  reviewer ids + names, current-round decision rows).
- `app/(workspace)/reviews/technical/page.tsx` + `compliance/page.tsx` — real server components
  (`getWorkspaceContext` → `listReviewQueue` → `<ReviewQueue>`); the Phase 5 static mock lists
  are gone. Empty state: *"Tidak ada manual yang menunggu keputusan Anda saat ini."*
- `features/reviews/review-controls.tsx` (`"use client"`) in the builder topbar, status-driven:
  `DRAFT` → **Kirim review** (disabled with the real reason: *"Lengkapi item wajib terlebih
  dahulu."* / *"Reviewer teknis belum ditetapkan."* / *"Reviewer kepatuhan belum ditetapkan."*);
  `CHANGES_REQUESTED` → last request-changes summary + **Mulai revisi** (author);
  `TECHNICAL_REVIEW` / `COMPLIANCE_REVIEW` + assigned → approve / request-changes controls with a
  mandatory summary textarea for request-changes. Decision wording is *"Disetujui reviewer
  teknis — <nama>, <waktu>"* / *"Disetujui reviewer kepatuhan — <nama>, <waktu>"*; the compliance
  panel carries the fixed note *"Keputusan internal Smartin atas dokumentasi, bukan persetujuan
  regulator."* No "Approved" / "Bappebti Approved" / "Compliant" / "Certified" string anywhere.
- `features/reviews/assign-reviewers-form.tsx` (`"use client"`, admin only) — two role-filtered
  `<select>`s + **Simpan penetapan**, rendered in the builder Metadata tab when the caller is
  ADMIN and status is `DRAFT` / `CHANGES_REQUESTED`. The Metadata tab also shows read-only
  *Status alur / Ronde review / Reviewer teknis / Reviewer kepatuhan*.

### Slice 2 tests — `tests/integration/rls.test.ts` → "Phase 6 slice 2 — review workflow" (14, Supabase DEV)

Each `it(…, { retry: 2 }, …)`; a dedicated fixture (`MANUAL_ID …a2` / `MV …b2`) reset to an
assigned `DRAFT` in `beforeEach`.

1. admin assigns valid reviewers → **one** `assign_reviewers` audit row; reassignment → one more.
2. wrong-role / cross-org / inactive assignee rejected by **both** the RPC and the DB guard.
3. a non-admin cannot call `assign_reviewers` (`forbidden`).
4. `/reviews/*` queues are assignment-scoped; the admin sees the whole-org queue; a cross-org
   caller sees nothing.
4b. **stage-specific visibility (transition test):** a `TECHNICAL_REVIEW` version is visible in
   the technical queue (assigned reviewer + admin) and **not** the compliance queue (compliance
   reviewer + admin); a technical APPROVE → `COMPLIANCE_REVIEW` makes it leave the technical
   queue and enter the compliance queue for both; `COMPLIANCE_REVIEW → CHANGES_REQUESTED` removes
   it from **both** active queues; a wrong-org user sees nothing throughout. Built from the shared
   `REVIEW_QUEUE_STATUS` contract so the test cannot drift from `listReviewQueue`.
5. submit happy path → `TECHNICAL_REVIEW`, `review_round = 1`, **one** `submit_review` audit row,
   `submitted_content_hash` stored.
6. submit blocked with a missing reviewer, on a stale `expected_round`, and for a non-author; a
   **forged** `manual_versions` `UPDATE status='TECHNICAL_REVIEW'` is rejected at the DB.
7. content mutation (`manual_blocks` / `manual_sections`) fails in `TECHNICAL_REVIEW`,
   `COMPLIANCE_REVIEW`, `CHANGES_REQUESTED`, `APPROVED`, `PUBLISHED`, `ARCHIVED`; `begin_revision`
   returns it to a writable `DRAFT`.
8. self-approval: a reviewer present in `manual_version_contributors` gets typed
   `SELF_APPROVAL_FORBIDDEN` on APPROVE — **technical and compliance**; an independent reviewer
   succeeds; Request Changes by a contributor reviewer is still allowed.
9. technical: `APPROVE → COMPLIANCE_REVIEW`; wrong reviewer / wrong role / stale round / empty
   request-changes summary / stale hash each rejected with a typed error.
10. compliance is unreachable with no current-round technical APPROVE; then
    `APPROVE → APPROVED`, `REQUEST_CHANGES → CHANGES_REQUESTED`.
11. two concurrent `record_technical_decision` calls → exactly **one** `reviews` row, **one**
    transition, **one** audit row; the loser gets a typed stale/workflow error (no 40001 retry
    storm).
12. two full rounds: after `CHANGES_REQUESTED` → `begin_revision` → resubmit re-enters
    `TECHNICAL_REVIEW` (never straight to `COMPLIANCE_REVIEW`), `review_round = 2`; round-1
    `reviews` rows still present.
13. every workflow command writes **exactly one** `audit_events` row (count asserted per action).

**Unit**: `review-state-machine.test.ts` (18), `review-fingerprint.test.ts` (18), and
`review-queue-contract.test.ts` (5 — pins `technical→TECHNICAL_REVIEW` / `compliance→
COMPLIANCE_REVIEW`, exactly two queue types, single-status values, queues never share a status).

### Slice 2 verification results

- **Integration**: full `tests/integration/rls.test.ts` = **78 passed / 0 failed / 0 skipped**,
  two consecutive clean runs after the queue-semantics correction (plus four clean 77-test runs
  before it). A per-email memoised `signIn` (≈27→5 sign-ins/run), a 25 s `AbortSignal.timeout` on
  every Supabase call (`boundFetch`), and `it` `retry: 2` keep it off the **Supabase Auth
  `/token` sign-in rate-limit** ceiling; the Phase 5 checklist `beforeAll` now also self-heals a
  stale `CHK-VERSI-MATCH` row left by an interrupted earlier run (deterministic-seed fix, no
  assertion weakened).
- **Gates**: `npm run lint` clean · `npm run typecheck` clean · `npm run test` 360 passed / 78
  skipped · `npm run build` compiled successfully.
- **Browser (DEV, authenticated)**: as `admin@` — the Metadata tab shows the read-only Review
  block + the role-filtered assignment form; assigning both reviewers persists and audits. As the
  author — topbar **Kirim review** is disabled with the live reason *"Lengkapi item wajib
  terlebih dahulu."*; no admin assignment form. `/reviews/technical` + `/reviews/compliance`
  render real, assignment-scoped, org-scoped queues (mocks gone). The full click-through of a
  decision needs a Phase-5-ready fixture manual — the RPC layer is covered by the 14 integration
  tests + a standalone end-to-end script (submit → tech approve → compliance request-changes →
  begin revision → resubmit round 2 → tech approve → compliance approve → `APPROVED`; 4 `reviews`
  rows; concurrency race → exactly 1 error + 1 row).
- **Responsive** (375 / 768 / 1024 / 1440): the two queue pages, the topbar review controls +
  disabled-reason text, and the Metadata assignment form + summary textarea all lay out with no
  horizontal overflow at every width.
- **Regression**: DRAFT autosave still fires and persists ("Menyimpan…" → saved), Undo/Redo
  toggle correctly; the Phase 5 panel still shows 31 grouped items with the MISSING gate blocking
  submit and `WARNING` ("Perlu ditinjau") **not** blocking. The one induced test edit on a DEV
  demo manual was reverted and the induced contributor row removed.

### Slice 2 fixture / cleanup

Slice-2 integration rows live under `MV …b2` and are torn down in `afterAll`; `assign_reviewers`
audit rows written during the browser check were deleted; the DEV demo manual edited during the
regression spot-check was restored byte-for-byte and its induced `manual_version_contributors`
row removed. The Phase 5 `checklist:override_na` DEV QA audit row is still untouched.

---

## Slice 3 — review comments (implemented + verified)

### Migration `20260901001500_phase6_comments.sql`

Added **after** `…001400` (neither `…001300` nor `…001400` modified). `db push --dry-run` →
`db push` → `migration list` → **16 migrations, `…001500` local == remote**. The
`review_comments` table, its at-most-one-anchor `CHECK`, the composite anchor FKs, the
same-manual-version `app.assert_review_comment_anchor` trigger, and the SELECT-for-org-members RLS
policy all shipped in `…001300`; this migration adds only guards + RPCs.

- **`app.guard_review_comment_update()`** (SECURITY INVOKER, `BEFORE UPDATE`). Raises
  `restrict_violation` if any of `manual_version_id / round_number / review_type / author_id /
  section_id / block_id / body / organization_id / created_at` changes — for **every** caller
  (service role included). After creation, only `resolved / resolved_by / resolved_at`
  (and `updated_at`, via the `…001300` touch trigger) may change (§6, §26). Trigger order:
  `…_anchor_check` → `…_body_guard` → `…_touch`.
- **`public.create_review_comment(mv, review_type, round, section_id, block_id, body)`** —
  SECURITY DEFINER, `search_path = public`, `revoke … from public, anon` + `grant … to
  authenticated, service_role`. Validates, in order: version exists → known `review_type` →
  `btrim(body)` length 1..5000 → not both anchors → actor authenticated → **role + assignment**
  (`TECHNICAL` needs `has_role(TECHNICAL_REVIEWER|ADMIN)` **and**
  `technical_reviewer_id = auth.uid()`; `COMPLIANCE` the compliance equivalent) → **stage**
  (`TECHNICAL` needs `status = 'TECHNICAL_REVIEW'`, `COMPLIANCE` needs `'COMPLIANCE_REVIEW'`) →
  round matches `review_round` → **typed anchor check** (`section_id` / `block_id` must exist in
  *this* version *and* org, else `invalid anchor: …`; the `…001300` DB trigger is the last line
  of defence). Inserts with `author_id = auth.uid()` and `round_number = review_round`. **No
  `audit_events` row** (§12). ADMIN gets no assignment bypass.
- **`public.set_review_comment_resolved(comment_id, resolved)`** — SECURITY DEFINER. Loads the
  comment's `review_type` + org, and the owning version's reviewer ids. Only the **assigned
  reviewer of that `review_type`** (or a service request) may call it — a `TECHNICAL` comment is
  resolvable only by the assigned technical reviewer, `COMPLIANCE` only by the assigned compliance
  reviewer; a developer or the other reviewer is rejected (`forbidden: only the assigned …
  reviewer …`). `resolved = true` → sets `resolved_by = auth.uid()`, `resolved_at = now()`;
  `resolved = false` → nulls both. Idempotent conditional `UPDATE`. **No status / round gate** —
  the assigned reviewer may resolve/reopen a past-round comment (they remain the assigned
  reviewer); documented as the intended reading of §8 / §10.

### Comment permissions (summary)

| Actor | Create (stage-gated) | Resolve / reopen | Read |
|---|---|---|---|
| assigned technical reviewer, `TECHNICAL_REVIEW` | ✅ `TECHNICAL` | ✅ `TECHNICAL` comments | ✅ |
| assigned compliance reviewer, `COMPLIANCE_REVIEW` | ✅ `COMPLIANCE` | ✅ `COMPLIANCE` comments | ✅ |
| a reviewer who holds the role but is **not assigned** | ❌ `not the assigned … reviewer` | ❌ | ✅ |
| ADMIN, not assigned to that review | ❌ (no assignment bypass) | ❌ | ✅ (whole org) |
| developer / author | ❌ (`assertCan` fails; RPC also rejects) | ❌ (`only the assigned … reviewer`) | ✅ (own version) |
| outsider (other org) | ❌ | ❌ | ❌ (RLS: 0 rows) |
| anon | ❌ (`authentication required`) | ❌ | ❌ |

### Anchors

Exactly one of: manual (`section_id = block_id = NULL`), one section, or one block — the
`…001300` `CHECK (NOT (section_id IS NOT NULL AND block_id IS NOT NULL))` plus the RPC's explicit
"not more than one" rejection. A section/block anchor must belong to **this** manual version and
org: the RPC's `EXISTS` check gives a typed `invalid anchor: …`; the `…001300` anchor trigger
independently raises `foreign_key_violation` ("… not part of this manual version") for a forged
direct insert; the composite `(section_id, organization_id)` / `(block_id, organization_id)` FKs
make a cross-org anchor structurally impossible.

### Body immutability

`body`, `author_id`, `round_number`, `review_type`, `section_id`, `block_id`, `manual_version_id`,
`organization_id`, `created_at` are frozen at creation — a correction is a **new** comment.
`app.guard_review_comment_update()` blocks a change to any of them for every caller; a direct
service `UPDATE {resolved, resolved_by, resolved_at}` still succeeds.

### Resolve / reopen semantics

`UNRESOLVED → RESOLVED` (sets resolver + `now()`), `RESOLVED → UNRESOLVED` (clears both). The
comment row is never deleted. Resolution state is independent of review rounds and of the
Request-Changes decision — a Request Changes does **not** require every comment resolved, and
resolving a comment does **not** create/omit any decision (§19).

### Cross-round persistence (AC-P6-4, AC-P6-8)

Round-1 comments are untouched by `TECHNICAL_REVIEW → CHANGES_REQUESTED → begin_revision →
DRAFT → resubmit → TECHNICAL_REVIEW round 2`: same `id`, `body`, anchor, `round_number = 1`, same
`resolved / resolved_by / resolved_at`. A comment created in round 2 gets `round_number = 2`.
`listReviewComments` returns every round ordered `round_number ASC, created_at ASC`. Old comments
stay visible to the developer while they revise in DRAFT (the "Komentar" tab is always present).

### Deleted / soft-deleted block anchor (§18)

Phase 3 block deletion is a **soft delete** (`manual_blocks.deleted_at`) — the row survives, so
the `block_id` FK is never triggered and the comment keeps pointing at that block. The panel
still shows the comment and labels it *"blok sudah dihapus pada revisi berikutnya"*; its "Lihat"
falls back to navigating to the section. No block is ever restored just to keep a comment. (A
*hard* delete would cascade-delete the comment via the `ON DELETE CASCADE` anchor FK, but the app
has no hard-delete path for blocks.)

### RLS / write path

No new client `INSERT/UPDATE/DELETE` policy on `review_comments` — the `…001300`
`review_comments_select_members` policy (org members, `authenticated`) is the only client access;
every write goes through the two SECURITY DEFINER RPCs (which run as `postgres`). `service_role`
keeps full DML for tests / infra.

### No workflow coupling (§20)

`create_review_comment` and `set_review_comment_resolved` never touch `manual_versions.status`,
`review_round`, `submitted_content_hash`, or any `checklist_results` row. Verified: the slice-3
integration tests assert `status` + `submitted_content_hash` + `checklist_results` count are
unchanged across create / resolve / reopen.

### Server actions + query + UI

- `features/reviews/actions.ts` — `createReviewComment` (`assertCan(review:technical|
  review:compliance)`, trims + rejects blank body **before** the RPC so the client keeps the
  draft on a validation error, discriminated-union `target`), `setReviewCommentResolved`
  (`canAny(review:technical|review:compliance)` gate; the RPC does the precise assigned-reviewer +
  type check). `mapRpcError` extended: `invalid anchor` → `VALIDATION`, `comment body must be` →
  `VALIDATION`.
- `features/reviews/queries.ts` — `listReviewComments(orgId, manualVersionId)` → author +
  resolver **display names only** (no profile object), review type, round, resolved metadata, and
  the anchor metadata a client needs to navigate (`{kind:"manual"|"section"|"block", …}` incl.
  section key/title, block position/type, `deleted`). Ordered `round_number, created_at`.
- Builder **"Komentar"** inspector tab (`features/reviews/review-comments-panel.tsx`): comments
  grouped by round; each card = type chip, author + timestamp, anchor line with a working "Lihat"
  (section → `onNavigateSection`; block → `onFocusBlock` → scroll + 1.8 s flash), body
  (`white-space: pre-wrap`), resolved badge / "Belum diselesaikan", and a resolve/reopen toggle
  **only** for the assigned reviewer of that comment's type. A compose block (target =
  manual / current section / a block of the current section, plain textarea, 5000-char counter)
  appears **only** when the viewer is the assigned reviewer of the **active** stage. Content stays
  read-only in review; no AI authoring is exposed.
- Block anchor plumbing: `SectionEditorHandle.focusBlock(blockId)` (scroll into view + transient
  `.rc-anchor-flash`); `[data-block-id]` added to the editable block `<li>` and, via a new
  `anchored` prop on `SectionContent`, to each block in the read-only review render.

### Slice 3 tests — `tests/integration/rls.test.ts` → "Phase 6 slice 3 — review comments" (8, Supabase DEV)

Dedicated fixture: manual `M3` + version `MV3` (cover section + block) + a second same-org
version `MV3B` (for a cross-version anchor) + a minimal **org-B** chain (ea_product → ea_version →
manual → version → section → block, for a genuine cross-org anchor). `beforeEach` resets `MV3` to
an assigned `DRAFT`; `afterAll` drops everything.

1. assigned technical reviewer creates **manual / section / block** comments in the current
   round; body is trimmed; persisted `round_number` / `review_type` / `author_id` / anchor are
   correct; `status` + `submitted_content_hash` + `checklist_results` count are unchanged.
2. assigned compliance reviewer creates comments once the version is in `COMPLIANCE_REVIEW`.
3. invalid anchors rejected: unknown section, unknown block, section from another version, block
   from another version, **cross-org** section, **cross-org** block, both anchors at once — plus a
   forged direct `review_comments` insert with a cross-version section is rejected by the
   `…001300` trigger.
4. only the assigned reviewer of the active stage may create: a role-holding but **unassigned**
   reviewer, the other-type reviewer, an **unassigned ADMIN** (no bypass), an outsider, and anon
   are all rejected; exactly the one valid comment persists.
5. creation rejected in `DRAFT` / on a stale round / with a `COMPLIANCE` comment while in
   `TECHNICAL_REVIEW` (and vice-versa) / in every forced `CHANGES_REQUESTED` / `APPROVED` /
   `PUBLISHED` / `ARCHIVED` state.
6. resolve sets `resolved_by` + `resolved_at`; reopen clears them; a developer and the
   other-type reviewer are rejected; `status` + hash unchanged; the compliance equivalent
   (compliance reviewer resolves a `COMPLIANCE` comment; a technical reviewer cannot).
7. after creation, a direct `UPDATE` of `body` / `author_id` / `round_number` / `review_type` /
   anchor / `manual_version_id` is rejected (`immutable review evidence`); a direct `UPDATE` of
   the resolution columns succeeds and `body` is unchanged.
8. round-1 comments survive `CHANGES_REQUESTED → begin_revision → resubmit` byte-identical
   (`round_number = 1`, same body/anchor/resolved state); a round-2 comment lands under
   `round_number = 2`; the query returns `[1, 1, 2]`.

Unit: `permissions.test.ts` already pins `can("DEVELOPER", "review:technical"|"review:compliance")
=== false` — the exact gate `createReviewComment` uses.

### Slice 3 verification results

- **Integration**: full `tests/integration/rls.test.ts` = **86 passed / 0 failed / 0 skipped**,
  two clean runs. Slice-3 block isolated = **8 / 8**, twice.
- **Gates**: `npm run lint` clean · `npm run typecheck` clean · `npm run test` 360 passed / 86
  skipped · `npm run build` compiled successfully.
- **Browser — technical reviewer** (`reviewer@`, `TECHNICAL_REVIEW`): content read-only
  ("TAMPILAN BACA-SAJA"); added a manual, a section, and a block comment; resolved one (card shows
  *"Selesai — Rina Reviewer (DEMO) · <waktu>"* + "Buka lagi") and reopened it; the section "Lihat"
  navigates to the section; no author controls, no AI mutation controls. The unresolved-count tab
  badge tracks correctly.
- **Browser — developer revision** (`developer@`): in `CHANGES_REQUESTED` the topbar shows the
  request-changes summary + "Mulai revisi"; the "Komentar" tab shows all 3 prior comments with
  the resolved/unresolved state and **no** create/resolve controls; "Mulai revisi" → `DRAFT` and
  the comments are still listed while the editor (Undo/Redo/Tambah blok) is writable again.
- **Browser — compliance reviewer** (`compliance@`, `COMPLIANCE_REVIEW`): sees the 3 prior
  **technical** comments (no resolve button on them); the compose form reads *"Komentar
  kepatuhan · ronde 1"*; content read-only; the "Keputusan internal Smartin … bukan persetujuan
  regulator" note is shown by the decision controls.
- **Responsive** (375 / 768 / 1024 / 1440): the "Komentar" panel — cards, wrapped bodies, wrapped
  anchor labels ("Blok #1 · text (Bab: …)"), resolved metadata, the compose radios + textarea +
  5000 counter + button — lays out with no horizontal document scroll; the panel scrolls
  vertically inside the inspector drawer (768) / side column (1440). At 375 the inspector opens
  via the pre-existing mobile "Inspector" toggle (a Phase 3 tablet-nav quirk, unchanged).
- **Regression**: DRAFT authoring / autosave / Undo-Redo intact (developer's post-revision
  `DRAFT` view); Phase 4 AI paths unchanged (still `canEdit`-gated, so inert in review);
  Phase 5 checklist still 31 grouped items and unaffected by comments (integration asserts the
  `checklist_results` count is unchanged); Phase 6 slice-2 assignment / queue movement / decisions
  / self-approval / concurrency / two-round tests all still pass in the 86/86 run.

### Console note

The dev server (Turbopack) replays stale HMR errors referencing an **old** transient state of
`features/reviews/queries.ts` (a duplicate `REVIEW_QUEUE_STATUS` that existed for a few minutes
during the slice-2 queue-semantics correction). The current file has no duplicate — `tsc`,
`eslint`, and `next build` are all clean — this is the same class of stale-HMR artifact noted in
`docs/PHASE_5.md §14`.

### Slice 3 fixture / cleanup

Slice-3 integration rows (`M3` / `MV3` / `MV3B` + the org-B chain) are dropped in `afterAll`; the
browser-verification fixture (`…7072` / `…7082`, its comments, its `reviews` row, its audit rows)
was deleted after the run. The regenerated `AGENTS.md` / `CLAUDE.md` (written by `next dev`) were
removed. DEV is back to steady state: 2 demo manuals, 0 `review_comments`, 0 `reviews`, only the
genuine `manual_version_contributors` row, and the untouched `checklist:override_na` QA audit row.

---

## Slice 4 — structured changelog + Pasal 8 reminder (implemented + verified)

### Migration `20260901001600_phase6_changelog.sql`

Added **after** `…001500` (`…001300`/`…001400`/`…001500` unchanged). `db push --dry-run` →
`db push` → `migration list` → **17 migrations, `…001600` local == remote**. The
`changelog_entries` table, its `entry_type` / body CHECKs, the deferrable position UNIQUE, and the
`(manual_version_id, organization_id)` + `(source_ea_version_id, organization_id)` composite FKs
shipped in `…001300`. This migration adds:

- **`ALTER TABLE changelog_entries ADD CONSTRAINT changelog_breaking_needs_impact`** —
  `entry_type <> 'BREAKING' OR btrim(open_position_impact) <> ''` (PRD-VER-006). Enforced at the
  DB for *every* writer, RPC or forged.
- **`app.assert_changelog_draft()`** (SECURITY INVOKER, `BEFORE INSERT/UPDATE/DELETE`). A
  non-service caller mutating a `changelog_entries` row while the owning `manual_versions.status
  <> 'DRAFT'` raises `insufficient_privilege`. Same shape as `app.assert_manual_version_draft`
  (slice 2). RLS already denies all client writes; this is the defence-in-depth layer for the
  `authenticated` role.
- **`app.record_changelog_contributor()`** (SECURITY DEFINER, `AFTER INSERT/UPDATE/DELETE`) —
  upserts the acting `auth.uid()` into `manual_version_contributors` (mirrors
  `app.record_manual_contributor`). Reading the changelog is not a write, so it never fires; a
  service / migration write (`auth.uid() IS NULL`) is skipped. **This makes changelog authoring
  count toward AC-P6-6** — a reviewer who wrote a changelog entry becomes a contributor and can
  no longer APPROVE the version.
- **`app.assert_changelog_source(org, manual_version_id, source)`** — `source` must be an
  `ea_versions` row in the **same org** *and* the **same `ea_product_id`** as the manual
  version's linked EA version, else `foreign_key_violation` (`invalid source: …`). EA facts are
  never cloned — `source_ea_version_id` stays a reference.
- **Four SECURITY DEFINER RPCs** — `create_changelog_entry`, `update_changelog_entry`,
  `delete_changelog_entry`, `reorder_changelog_entries`. Each: `perform app.assert_author(org)`
  first, `status = 'DRAFT'` re-check, `entry_type ∈ {ADDED,CHANGED,FIXED,BREAKING}`, body
  1..4000, BREAKING-impact rule, `app.assert_changelog_source`. Positions stay contiguous
  `0..n-1` (create appends `max(position)+1`; delete repacks with a window function; reorder is
  the two-phase `+1000000` swap guarded by `app.assert_reorder_list` — rejects short / duplicate
  / foreign id sets). **No `audit_events` row.** `revoke … from public, anon` + `grant … to
  authenticated, service_role`.

### Authoritative review fingerprint (§10 — critical correction)

`lib/reviews/fingerprint.ts` already *supported* a changelog projection; slice 4 makes it the
**production path everywhere**:

- `SupabaseManualDataSource.loadManualVersionByManualId` now loads `changelog_entries` (ordered
  by `position`) into `vm.changelog` — so the one assembled `ManualViewModel` carries the
  structured changelog.
- `projectReviewContent` uses `input.changelog ?? vm.changelog ?? []` — an explicit arg still
  wins (tests), otherwise the changelog comes from the loaded model. The projection keeps only
  the **semantic** fields (`position`, `entryType`, `body`, `sourceEaVersionId`,
  `isFeatureChange`, `openPositionImpact`) — never the DB row id or timestamps.
- New named helper **`manualReviewFingerprint(vm)`** = `computeContentFingerprint({ vm })`. The
  slice-2 submit / technical-APPROVE / compliance-APPROVE actions now call
  `manualReviewFingerprint(ctx.vm)` (was `computeContentFingerprint({ vm: ctx.vm })` with no
  changelog). Slice 6 publish will use the same helper. Changelog loading is **not** duplicated
  in any workflow action — it happens once, in the data source.

### Contribution semantics

Create / update / delete / reorder of a changelog entry → the actor is recorded as a
`manual_version_contributors` row (or its `contribution_count` bumps). Reading the changelog and
rendering the Pasal 8 reminder are **not** contributions. Verified: slice-4 integration test 3.

### DRAFT-only mutation

The RPCs reject every mutation unless `status = 'DRAFT'`; a forged direct client write is denied
by RLS (no write policy) with `app.assert_changelog_draft` behind it. Verified rejected in
`TECHNICAL_REVIEW`, `COMPLIANCE_REVIEW`, `CHANGES_REQUESTED`, `APPROVED`; allowed again after
`begin_revision` returns the version to `DRAFT` (slice-4 test 6). `PUBLISHED` / `ARCHIVED`
immutability is finalised in slice 6, but the existing DRAFT-only rule is already respected.

### Source EA Version constraint

Same org **and** same EA product lineage. A same-org EA version of an unrelated product, and a
cross-org EA version, are both rejected with `invalid source: …`; `NULL` source is allowed
(schema keeps it optional). The authoring UI defaults the source to the manual version's linked
EA version. Verified: slice-4 test 4.

### BREAKING impact (PRD-VER-006)

`entry_type = 'BREAKING'` ⇒ `open_position_impact` non-empty after trim — enforced by the Zod
schema, by each RPC, and by the DB CHECK (`23514` on a forged direct insert). Verified: slice-4
test 5 + unit `changelog.test.ts`.

### Feature-change marker & PRD-OQ-010 (Pasal 8 reminder)

`is_feature_change` is set **explicitly by the developer** (a checkbox) — never inferred from
body text, never by AI. `lib/changelog/reminder.ts` `pasal8ReminderApplies(scope, entries)` =
`scope === "IN_SCOPE" && entries.some(e => e.isFeatureChange)`. When true, the Chapter 14 editor
shows one design-system `warning` callout with the exact §8 wording:

> *"Perubahan fitur/perilaku ini memerlukan tindak lanjut operasional sesuai ketentuan yang
> berlaku: persetujuan klien dan pelaporan kepada Kepala Bappebti, apabila berlaku. Smartin
> Manual Builder hanya menampilkan pengingat dan tidak melakukan proses tersebut."*

The tool does **not** file the report, submit anything, obtain regulatory approval, create a
client-approval artefact, or track any of it as completed — and there is **no**
`bappebti_reported` / `regulator_approved` / `client_approval_verified` field (§9). For an
**OUT_OF_SCOPE** EA the Pasal 8 obligation is **not** shown; a neutral note is shown instead
(*"… EA ini berada di luar lingkup PBK Indonesia, sehingga kewajiban Pasal 8 tidak ditampilkan
sebagai persyaratan hukum."*).

### Validation integration — `CHK-CHANGELOG-VERSI` (§20)

The one existing Phase 5 rule `checkChangelogVersi(vm)` now reads `vm.changelog` first: **any
structured entry → PASS** (noting how many reference the linked EA version); it falls back to the
legacy free-text `[X.Y.Z]` heuristic on the chapter's blocks only when there are no structured
entries. One rule implementation, no second rule. Verified: `validation-rules.test.ts`
("MISSING → PASS when a structured changelog entry is added") + the browser flow (readiness
13% → 17%, `Lolos 3 → 4`, the changelog item leaves the blocking list).

### UI

- **Chapter 14 "changelog"** (`section.key === "changelog"`): the `ChangelogEditor`
  (`features/changelog/changelog-editor.tsx`) renders **above** the ordinary block editor — the
  chapter's normal blocks are untouched. Per entry: `Jenis` select (Ditambahkan / Diubah /
  Diperbaiki / Perubahan besar), `Versi EA sumber` select (lineage options + "— tidak ada —"),
  `Uraian perubahan` textarea, the feature-change checkbox, and (only for BREAKING) the required
  open-position-impact textarea; ▲▼ reorder, Simpan (dirty-gated), Hapus, and "+ Tambah entri".
  Client-side validation blocks a BREAKING save with no impact and an empty body (input
  preserved on error). The Pasal 8 / neutral callout sits directly below the list.
- **Review states** (`canEdit` false): the same list renders **read-only** — type chip,
  feature-change flag, body, source-version label, BREAKING impact, and the applicable reminder —
  with **no** authoring controls. No AI authoring is exposed.
- Comments (slice 3) are unchanged; changelog entries are **not** new comment anchors.

### Slice 4 tests — `tests/integration/rls.test.ts` → "Phase 6 slice 4 — structured changelog" (8, Supabase DEV)

Fixture: manual `M4` + version `MV4` (VMax product/version, assigned reviewers) + a 2nd VMax EA
version `EAV2` (valid source) + an unrelated ORG_A product/version `EAV_OTHER` (forged) + an
ORG_B product/version `EAV_B` (cross-org forged). `beforeEach` resets `MV4` to `DRAFT`.

1. create / update / delete / reorder keep positions contiguous `0..n-1` (delete repacks;
   reorder swaps).
2. reorder rejects a short / duplicated / foreign id set.
3. a changelog write records the author as a contributor; a reviewer *reading* the changelog
   does not.
4. source EA version must be same-org **and** same product lineage — `EAV2` ok, `NULL` ok,
   `EAV_OTHER` and `EAV_B` → `invalid source`.
5. a BREAKING entry needs the open-position impact — RPC rejects `NULL` / whitespace; a forged
   direct insert hits the DB CHECK (`23514`).
6. changelog mutation rejected in `TECHNICAL_REVIEW` / `COMPLIANCE_REVIEW` /
   `CHANGES_REQUESTED` / `APPROVED` and via a forged direct client write; allowed again after
   `begin_revision` → `DRAFT`.
7. only an author may mutate — reviewer / outsider / anon and a forged direct `INSERT` (RLS) are
   all rejected.
8. changelog CRUD never changes `status` / `review_round` / `submitted_content_hash` and writes
   **no** `audit_events` row.

**Unit** (`tests/unit/changelog.test.ts`, 16): fingerprint §11 A–I (same → same; add / body /
type / source / feature / impact / reorder each change the hash; the `vm.changelog` authoritative
path is included; a row id / volatile field is not); `changelogEntrySchema` (trim, empty-body
reject, BREAKING-needs-impact, unknown type); `pasal8ReminderApplies` (IN_SCOPE+feature → true;
IN_SCOPE+none / OUT_OF_SCOPE+feature → false). Plus `validation-rules.test.ts` gains the
`CHK-CHANGELOG-VERSI` structured MISSING→PASS case.

### Slice 4 verification results

- **Integration**: full `tests/integration/rls.test.ts` = **94 passed / 0 failed / 0 skipped**,
  two consecutive clean runs.
- **Gates**: `npm run lint` clean · `npm run typecheck` clean · `npm run test` 379 passed / 94
  skipped · `npm run build` compiled successfully.
- **Browser — developer** (`developer@`, DRAFT, IN_SCOPE fixture): Chapter 14 shows the
  structured editor; added an ADDED entry, marked feature-change (Pasal 8 reminder appeared with
  the exact wording + "hanya menampilkan pengingat" disclaimer), changed type to BREAKING (the
  required impact field appeared; Simpan without impact was blocked with the field message and
  nothing persisted), added a 2nd entry, reordered (positions swapped in the DB), deleted (rows
  repacked to `0..n-1`). The Phase 5 readiness went 13% → 17%, `Lolos 3 → 4`, and
  *"Entri changelog untuk versi EA saat ini"* left the blocking list.
- **Browser — developer, OUT_OF_SCOPE fixture**: a feature-change entry does **not** raise the
  Pasal 8 obligation; the neutral out-of-scope note is shown instead.
- **Browser — reviewer** (`reviewer@`, TECHNICAL_REVIEW): Chapter 14 shows the structured
  changelog **read-only** (type chip + feature-change flag + body + source-version label), the
  applicable Pasal 8 reminder, **no** authoring controls, content read-only, and no
  regulatory-approval wording.
- **Responsive**: the changelog editor + reminder verified at 768 (read-only card + reminder
  wrap cleanly, no horizontal overflow) and 1280 (full editable flow, all form controls). At 375
  the pre-existing Phase 3 mobile "Bab" / "Inspector" drawer toggle would not open in the test
  browser (same artefact noted for slices 2–3) — the editor CSS is fully fluid (`flex: 1 1
  200px` fields that stack, `width: 100%` inputs, `flex-wrap` throughout, `overflow-wrap:
  anywhere` on text); the slice-7 responsive audit covers 375 with a working harness.
- **Regression**: Phase 2/3 DRAFT autosave / Undo-Redo intact (the developer's editable
  changelog chapter still has the working block editor below it); Phase 4 AI paths unchanged
  (still `canEdit`-gated); Phase 5 checklist still 31 items and `CHK-CHANGELOG-VERSI` now honours
  the structured source; Phase 6 slice-2 workflow + hashes still pass after the switch to
  `manualReviewFingerprint` (the 94/94 run includes every slice-2 test); slice-3 comments
  unaffected.

### Slice 4 fixture / cleanup

Slice-4 integration rows (`M4` / `MV4` + `EAV2` / `EAV_OTHER` / the ORG_B chain) are dropped in
`afterAll`. The two browser fixtures (`…00a1` IN_SCOPE, `…00e1` OUT_OF_SCOPE + its throwaway EA
product/version) and their changelog rows, contributor rows, and audit rows were deleted after
the run. Regenerated `AGENTS.md` / `CLAUDE.md` removed. DEV steady state: 2 demo manuals,
2 EA products, 0 `changelog_entries`, 0 `reviews` / `review_comments`, only the genuine
`manual_version_contributors` row, `checklist:override_na` QA audit row intact.

---

## Slice 5 — clone manual version (implemented + verified)

### Part 1 — `20260901001700_phase6_changelog_source_required.sql`

PRD-VER-006 says every structured changelog entry records its source EA version. Slice 4 shipped
it nullable; this migration:

1. **Backfills** `source_ea_version_id` for any NULL row from that entry's own
   `manual_versions.ea_version_id` (deterministic — the entry already belongs to the version).
2. Swaps the `(source_ea_version_id, organization_id)` FK from `ON DELETE SET NULL` to
   `ON DELETE RESTRICT` (a NOT NULL column can't be nulled by an FK action). Same-org + same
   EA-product-lineage validation stays in `app.assert_changelog_source`.
3. `ALTER COLUMN source_ea_version_id SET NOT NULL`.
4. `create or replace` `create_changelog_entry` / `update_changelog_entry` to also raise
   `changelog: the source EA version is required` on a NULL argument (a clearer message than a
   NOT NULL violation).
5. `features/changelog/schema.ts`: `sourceEaVersionId` is now `z.uuid()` (was `.nullable()`).
   `changelog-editor.tsx`: the "— tidak ada —" option is gone; a new draft defaults the source
   to the linked EA version; Save is blocked with "Pilih versi EA sumber." if empty.

`migration list` → 18 migrations, `…001700` local == remote. Unit `changelog.test.ts` +1
("rejects a missing / null source EA version"); the slice-4 integration block's `create` helper
now passes `VMAX_EA_VERSION` (MV4's linked version — a valid same-org / same-product source);
the "null → ok" assertion became "null → rejected".

### Part 2 — `20260901001800_phase6_clone.sql` (`clone_manual_version` RPC)

One SECURITY DEFINER transaction (`set search_path = public`, `perform app.assert_author(org)`
first, `revoke … from public, anon`, `grant … to authenticated, service_role`). Org is **derived
from the source**, never trusted from the caller. Any error ⇒ the whole transaction rolls back —
**no partial clone**.

`migration list` → 19 migrations, `…001800` local == remote. (The RPC was reverted + re-pushed
once during slice-5 development — same uncommitted slice — to fix a PL/pgSQL `SELECT … INTO`
stale-variable bug where a missing target group could slip through; now each loop iteration
resets `v_gname` / `v_tgt_gid` to null and checks `NOT FOUND`.)

### Inputs

`clone_manual_version(p_source_manual_version_id, p_target_ea_version_id, p_new_version)`. Validates:
source exists → `app.assert_author` → target EA version exists **in the source's org** and has the
**same `ea_product_id`** as the source's linked EA version → `p_new_version` matches `X.Y.Z` →
uniqueness within the manual lineage is the `unique (manual_id, version)` constraint (a racing
INSERT raises `23505`, the whole transaction rolls back, the action maps it to a conflict).
Target is never inferred from "latest".

### Copied vs NOT copied

| Copied | NOT copied |
|---|---|
| a fresh `manual_versions` row: same `manual_id`, **same `template_id` + `template_version`** (Phase 5 scaffold), `ea_version_id` = target, `status = 'DRAFT'`, everything else default | `status`, `review_round`, `submitted_content_hash`, `reviewed_at`, `published_at`, `technical_reviewer_id`, `compliance_reviewer_id` (all default/NULL) |
| ordered `manual_sections` (key / title / required / **is_custom** / position), `completion_state` reset to `incomplete`, **new ids** | `reviews`, review decisions, `review_comments`, review rounds, submitted review hashes |
| ordered **ACTIVE** `manual_blocks` (`deleted_at IS NULL`), payloads deep-copied, **new ids**, `row_version = 1` | soft-deleted (`deleted_at` set) blocks — never cloned as active content |
| every `parameterTable` block's `parameter_group_ids` **and** `payload.groupIds` remapped by group **name** to the target EA version's groups | `parameter_groups`, `ea_parameters`, `ea_version_setups`, image bytes, `audit_events` (other than the one clone row), `ai_revisions`, `checklist_results` (+ reviewer N/A overrides), `published_snapshots` |
| ordered `changelog_entries` (position / entry_type / body / **`source_ea_version_id` preserved** / is_feature_change / open_position_impact) | the source version's `manual_version_contributors` |
| exactly one `audit_events` row (`manual_version:clone`, safe metadata) | — |

### Target-lineage rule

Target EA version must be **same org AND same EA product lineage**. Rejected *before any write*:
a same-org EA version of an unrelated product (`clone: target EA version belongs to a different
EA product`), and a cross-org EA version (`clone: target EA version not found in this
organisation`). A VMax manual can never be cloned into an unrelated EA product.

### Parameter-group remapping

`parameter_groups` has `unique (ea_version_id, name)`, so **group name** is the mapping identity.
Per `parameterTable` block: for each source group id → read its `name` → find the target EA
version's group with that name → substitute. If **any** source group has no target equivalent,
`raise exception 'clone: parameter group "<name>" is not available on the target EA version'` and
the whole transaction rolls back. Source group UUIDs are never retained, groups are never
silently dropped, parameter definitions are never cloned or auto-created. The Phase-2
`app.guard_parameter_table_ownership` BEFORE-INSERT trigger independently re-validates the
remapped ids against the target EA version.

### Target-data ownership (GI-11)

Because parameter definitions and setups belong to the **target** EA version, the cloned
`parameterTable` block automatically renders the target technical name / type / default / unit /
safe range / description, and the new Manual Version resolves the **target's** Supported
Configurations. Verified: source group `Risk` default `0.01` vs target `Risk` default `0.02` — the
clone's `parameterTable` resolves the target group id and `0.02`; source setup `XAUUSD @ M15` vs
target `EURUSD @ H1` — the clone resolves the target setup. **No EA parameter/setup values are
copied into manual content.**

### Image-reference semantics

Image assets are org-owned and private. A cloned `image` block keeps the **same `image_asset_id`**
— the `(image_asset_id, organization_id)` composite FK keeps it same-org (cross-org is
structurally impossible), and `manual_blocks.image_asset_id` is `ON DELETE SET NULL`, so deleting
or editing a block never deletes the shared asset. **No storage bytes are duplicated.** Phase 7
owns public-asset copy/serving.

### Checklist-refresh semantics (§18–19, honest)

The atomic DB clone does **not** compute checklist states (the Phase 5 evaluator is
application-side). After the RPC returns, `cloneManualVersion` calls the existing
`refreshValidation({ manualId })`, which evaluates the **new** version's content against the
**target** EA facts and persists a fresh 31-item result set. If that refresh throws, the DRAFT
still exists and the action returns `validationRefreshed: false`; the clone form shows
*"DRAFT baru dibuat. Evaluasi checklist gagal diperbarui otomatis — buka lalu segarkan
validasinya."* and the user can retry from the new DRAFT. The clone itself does **not** fabricate
a "Updated to vX" changelog entry — Phase 5 may (correctly) flag the new version until the
developer adds the real entry.

### Contributor semantics

The clone RPC inserts **exactly one** `manual_version_contributors` row for the cloning actor
(`ON CONFLICT DO NOTHING`); the section/block/changelog AFTER-ROW triggers then reinforce it for
the same actor (still one row). The source version's contributors, reviewers, and AI actors are
**not** copied — so a later self-approval check on the clone only ever blocks someone who
actually authored the clone.

### Concurrency

Two concurrent `clone_manual_version` calls for the same `(manual_id, version)`: exactly one
succeeds, exactly one new `manual_versions` row exists, the loser gets a `23505`-mapped conflict,
exactly one `manual_version:clone` audit row, no duplicate child rows.

### UI

Chapter-Metadata inspector section **"Buat manual untuk versi baro"** (author only,
`canAny(roles, "manual:create")`; `features/manuals/clone-version-form.tsx`): read-only source
label, an `EA Version tujuan` select listing **only same-product versions** (the linked one is
marked *"(versi EA saat ini)"* and still selectable — a documentation-only re-version of the same
EA version is permitted by the RPC and the PRD), a `Versi manual baru` `X.Y.Z` input, and a
`Buat versi baru` button. The blurb reads *"Menyalin struktur bab, blok, dan catatan perubahan ke
DRAFT baru. Definisi parameter dan Supported Configuration mengikuti EA Version tujuan — bukan
disalin dari versi ini."* — it never implies all EA settings are copied. On success the form
`router.push`es to `/manuals/[manualId]/edit`, which always renders the **latest** version = the
new DRAFT (route identity == rendered identity, GI). On the missing-group failure it shows
*"Grup parameter '<name>' tidak tersedia pada EA Version tujuan."* and keeps the user's input;
no partial Manual Version is created.

> **Route note:** the manual builder route (`/manuals/[id]/edit`) always loads the *latest*
> version of a manual. After a clone the source version is therefore no longer the directly
> editable one — its review history is intact and it can still be previewed, but "current" moves
> to the clone. This matches the app's existing latest-version behaviour.

### Slice 5 tests — `tests/integration/rls.test.ts` → "Phase 6 slice 5 — clone manual version" (6, Supabase DEV)

Fixture: an EA product with source version `SRC` (Risk default `0.01`, setup `XAUUSD@M15`), target
`TGT` (Risk `0.02`, setup `EURUSD.pro@H1`), `NOGRP` (Risk only — no `Trailing`), an unrelated
ORG_A product `EAVX`, an ORG_B version `EAVB`. Source `MV_SRC` in `TECHNICAL_REVIEW` with a custom
section, text/steps/parameterTable/image blocks, one **soft-deleted** block, 2 changelog entries,
and review / comment / checklist (incl. a reviewer N/A override) / AI rows that must **not** be
cloned.

1. **happy path** — fresh DRAFT linked to the target; `status`/`review_round`/hash/reviewer ids
   reset; sections + blocks (soft-deleted excluded) + changelog (with `source_ea_version_id`
   preserved) cloned with new ids; `reviews`/`review_comments`/`checklist_results`/`ai_revisions`/
   `published_snapshots` for the new version = 0; contributor = only the clone actor; **one**
   `manual_version:clone` audit row; source unchanged.
2. **target data ownership** — the cloned `parameterTable` resolves the **target** `Risk` group
   (`RiskPercent` default `0.02`), never source `0.01`; setups follow the target.
3. **atomic failure — missing target group** — clone to `NOGRP` raises an error naming `Trailing`;
   no new `manual_versions` / sections / blocks / changelog / contributor / audit row.
4. **atomic failure — invalid lineage** — unrelated-product and cross-org targets rejected before
   any write; zero partial rows.
5. **concurrency** — two identical-version clones → one wins, one `23505`-mapped conflict, one
   `manual_versions` row, one clone audit row.
6. **permissions** — a reviewer (`app.assert_author` → forbidden) and anon cannot clone.

**Unit**: `changelog.test.ts` (18 now — added the mandatory-source case).

### Slice 5 verification results

- **Integration**: full `tests/integration/rls.test.ts` = **100 passed / 0 failed / 0 skipped**,
  three clean runs. (Two pre-existing slice-1 / slice-4 changelog tests were updated for the now-
  mandatory `source_ea_version_id`.)
- **Gates**: `npm run lint` clean · `npm run typecheck` clean · `npm run test` 380 passed / 100
  skipped · `npm run build` compiled successfully.
- **Browser — happy path** (`developer@`, DEV fixtures): the Metadata clone form lists only
  same-product target versions; cloning `v1.0.0` → target `v2.0.0` "2.0.0" navigates to the new
  DRAFT; the edit route then shows **Versi EA 2.0.0 / Versi manual 2.0.0**, status Draf, ronde 0,
  reviewers "belum ditetapkan", sections + block present, the changelog entry preserved, and a
  fresh 31-item checklist. The cloned `parameterTable` group ids resolve to the **target** `Risk`
  group with default **`0.02`** (DB-verified). One `manual_version:clone` audit row.
- **Browser — failure path**: cloning to `v3.0.0` (missing the `Trailing` group) shows
  *"Grup parameter 'Trailing' tidak tersedia pada EA Version tujuan."*, the form stays on the
  source, and DEV shows **no** new `manual_versions` row and **no** clone audit event.
- **Responsive**: the clone form (source label, target select, version input, blurb, typed error,
  button) verified at 1280 (full flow incl. wrapped error) and 1440 (Metadata side panel) — no
  horizontal overflow, fields stack (`.clone-field` is `flex-direction: column`, inputs
  `width: 100%`, hint/error `overflow-wrap: anywhere`). At 375 the pre-existing Phase 3 mobile
  "Bab" / "Inspector" drawer toggle would not open in the test browser (same artefact as slices
  2–4); the form markup is the same fluid CSS. Slice-7 does the full 375 pass.
- **Regression**: Phase 3 DRAFT editing / autosave / Undo-Redo intact on the source; Phase 4 AI
  history untouched; Phase 5 checklist still 31 items, source `checklist_results` unchanged, clone
  gets fresh results; Phase 6 slice-2 workflow + hashes still pass after the `manualReviewFinger-
  print` switch (the 100/100 run includes every slice-2 test); slice-3 comments and slice-4
  changelog CRUD + Pasal 8 reminder + fingerprint all still pass.

### Slice 5 fixture / cleanup

Slice-5 integration rows are dropped in `afterAll`. The browser fixture (product `…5001`, three
EA versions, groups/params/setups, the source manual + its clone, the clone audit row) was
deleted after the run. Regenerated `AGENTS.md` / `CLAUDE.md` removed. DEV steady state: 2 demo
manuals, 2 EA products, 0 `changelog_entries` / `reviews` / `review_comments`, only the genuine
`manual_version_contributors` row (viqah developer, count 21), `checklist:override_na` QA audit
row intact.

---

## Slice 5 (final correction) — latest-source invariant + checklist-template version

Two AC-P6-11 semantics are now enforced **server-side** and covered by tests. Migration
`20260901001900_phase6_clone_integrity.sql` (superseded on DEV by the drop-in fix
`20260901002000_phase6_clone_integrity_fix.sql` — `min(uuid)` does not exist in Postgres; both
are `create or replace` of the same function, `…001800` is untouched).

### "Latest Manual Version" is the only valid clone source

- **Canonical "latest" semantics reused, not reinvented.** `SupabaseManualDataSource` selects the
  active version with `order by created_at desc limit 1`. `clone_manual_version` now does the
  same inside SQL: `select id from manual_versions where manual_id = <lineage> and
  organization_id = <org> order by created_at desc, id desc limit 1`. No lexicographic semver
  sort. If `p_source_manual_version_id` is not that row the RPC raises
  **`clone: source Manual Version is no longer the latest version for this manual`**
  (`errcode invalid_parameter_value`) **before any write** — DRAFT, sections, contributor and
  audit rows are all absent on rejection.
- The clone server action maps that message to `fail("STALE", …)`; the UI keeps the form input
  and tells the user to reload from the latest version.

### Lineage locking / concurrent-clone behaviour

- Before the latest check the RPC takes `perform 1 from manuals where id = <lineage> for update`.
  Two concurrent clones of the same latest source are therefore **serialised on the parent
  `manuals` row**: the first inserts its sibling version and commits; the second resumes after
  the lock, recomputes "latest", sees the new sibling, and is rejected as a stale source — even
  when the two requests ask for **different** version strings. Net effect: exactly **one** new
  child Manual Version and **one** `manual_version:clone` audit event per winning race.
  (`tests/integration/rls.test.ts` → "clone integrity" tests 1–2.)

### Manual-template version ≠ checklist-template version

- `manual_versions.template_id` / `template_version` bind the **manual layout template** (system
  template `a1a1a1a1-…-0001`). The **checklist** is a *separate* versioned artefact:
  `checklist_templates (key = 'smartin-documentation-checklist', version, is_active)` with
  `checklist_items`, and every `checklist_results` row records the `checklist_template_id` +
  `checklist_template_version` it was evaluated under (Phase 5). The clone must preserve the
  **checklist**-template version, not conflate it with the manual template.
- The clone copies `template_id` / `template_version` verbatim (a valid layout scaffold) and,
  **separately**, resolves the checklist-template version from the source's result set:
  `select count(distinct checklist_template_version) …` over the source `checklist_results`.
  - exactly one distinct version → that `(checklist_template_id, checklist_template_version)`;
  - `> 1` (a mixed result set) → **`clone: source Manual Version has mixed checklist template
    versions`** (`errcode data_exception`), before any write;
  - `0` (source never evaluated) → **documented fallback**: the current **active**
    `smartin-documentation-checklist` template (`is_active`, highest version). Not pretended to
    be a version the source "had".
- The RPC **returns** `sourceChecklistTemplateId` / `sourceChecklistTemplateVersion` and records
  `checklistTemplateVersion` in the clone audit metadata. It does **not** copy any
  `checklist_results` state / evidence / evaluator / `override_*` / timestamps.

### Fresh clone checklist semantics (application-side refresh, pinned)

- `refreshValidation` now accepts `{ manualId, checklistTemplateVersion? }`. `evaluateAndPersist`
  passes it to `loadTemplate(pinnedVersion?)` — renamed from `loadActiveTemplate`; with a pinned
  version it selects `checklist_templates` by `key` + `version` (no `is_active` filter), so a
  superseded version is still loadable; if that version has since been deleted it falls back to
  the active template.
- `cloneManualVersion` reads `sourceChecklistTemplateVersion` off the RPC result and calls
  `refreshValidation({ manualId: newManualId, checklistTemplateVersion: <that version> })`. The
  new version's result set is therefore **freshly evaluated** against the **target EA Version
  facts** but bound to the **source's checklist-template version** — never silently upgraded to
  whatever is `is_active` now. Rule evaluation is not duplicated and no checklist result is
  computed in SQL; the DB clone stays atomic and the refresh stays a separate app-side call
  (on failure the DRAFT still exists and the UI retries).

### Version-preservation test evidence

- **Integration** (`tests/integration/rls.test.ts` → "Phase 6 slice 5 (final) — clone integrity",
  6 tests, Supabase DEV): stale (non-latest) source rejected with no writes then the latest
  source succeeds; concurrent clones with different version strings → one wins / one stale / one
  audit; a source result set on checklist v1 → RPC returns `sourceChecklistTemplateVersion = 1`
  and the audit records `checklistTemplateVersion = 1` while the active template is v2; a
  mixed-version source → typed integrity error, no child; a source with no results → fallback to
  the active v2; and the source result set (states, `checklist_template_version`, reviewer
  override) is byte-identical before and after a clone.
- **Browser spot-check** (`developer@`, isolated DEV fixture, checklist template **v2 made
  active**, source Manual Version carrying a **v1**-evaluated result set incl. one reviewer N/A
  override): cloning through the Metadata "Buat versi baru" form produced a new `DRAFT` whose
  **31 freshly-evaluated** `checklist_results` **all** have `checklist_template_version = 1`
  (not the active v2), all `evaluator = 'system'` with `override_actor_id = null` (the reviewer
  override did **not** carry), a mix of `MISSING` / `WARNING` / `NOT_APPLICABLE` / `PASS` states
  (freshly computed, not copied), and one `manual_version:clone` audit row with
  `checklistTemplateVersion = 1`. The source version's two `checklist_results` (incl. the
  reviewer override on `CHK-VERSI-DUA`) were unchanged. Fixture + the temporary v2 activation
  were reverted; DEV steady state restored (template v1 `is_active`, 2 demo manuals, 0 clone
  audits).

### UI

- The clone form lives only in the Metadata inspector of `/manuals/[id]/edit`, which always
  renders the **latest** version, so the normal path always clones from latest. The server
  invariant (latest-source check under the lineage lock) is authoritative regardless of UI; if a
  future surface ever renders the action against an older version the `STALE` typed error is
  shown and nothing is written.

### Gates (final correction)

- **Integration**: full `tests/integration/rls.test.ts` = **106 passed / 0 failed / 0 skipped**,
  two consecutive clean runs.
- `npm run lint` clean · `npm run typecheck` clean · `npm run test` **380 passed / 106 skipped**
  · `npm run build` compiled successfully.

---

## Slice 6 — publication transaction: immutable snapshot + publish gate + archive (implemented + verified)

The final two workflow edges (`APPROVED → PUBLISHED`, `PUBLISHED → ARCHIVED`) plus the immutable
publication snapshot, the persisted Phase 5 publish gate, and content/snapshot immutability.

### Migrations

- **`20260901002100_phase6_publish.sql`** — `manual_versions.archived_at`; `app.guard_manual_version_update()`
  replaced (adds `archived_at` to the workflow-column set + a redundant PUBLISHED/ARCHIVED frozen
  raise, both `not trusted`-guarded); `app.reject_frozen_manual_version_delete()` BEFORE DELETE
  (ordinary caller cannot delete a PUBLISHED/ARCHIVED row); `app.reject_published_snapshot_mutation()`
  BEFORE UPDATE/DELETE on `published_snapshots` (ordinary caller gets no mutation; trusted cleanup
  bypass); **`public.publish_manual_version(...)`** and **`public.archive_manual_version(...)`** —
  both `SECURITY DEFINER`, `search_path = public`, **`revoke execute … from public, anon, authenticated`**,
  **`grant execute … to service_role` ONLY**.
- **`20260901002200_phase6_publish_guard_bypass.sql`** — reconciles the pre-existing
  `app.guard_published_manual_version()` (`20260901000400`, self-described "light guard now; full
  Phase 6 … later"). It had **no** trusted-caller bypass (blocking the archive RPC + service
  cleanup) and did not cover `ARCHIVED`. Now: trusted bypass for `postgres`/`supabase_admin`/
  `service_role`; UPDATE **and** DELETE blocked for an ordinary caller whenever status is
  `PUBLISHED` **or** `ARCHIVED`. The controlled `PUBLISHED → ARCHIVED` transition happens only
  inside `archive_manual_version` (owner `postgres`), so it lands on the bypass. `01300–02000`
  are **not** modified. (This slice took the DEV list to 23 migrations; slice 7 + the final
  audit correction add `02300` / `02400` → **25 local == 25 remote** final.)

### Publication trust boundary (spec §12)

The privileged transaction is a **SERVICE-ROLE-ONLY RPC** — not reachable from the browser and
not callable by an authenticated user directly (integration-verified: `dev.rpc("publish_manual_version", …)`
errors). The one caller is the server action `publishManualVersion` (`features/manuals/publication-actions.ts`),
which: authenticates the session (`requireActiveOrg`), asserts `manual:publish` (ADMIN-only,
`lib/permissions`), loads the **authoritative persisted `ManualViewModel`**, computes
`manualReviewFingerprint(vm)`, builds the snapshot + `computeSnapshotHash`, runs a leak scan, then
calls `service.rpc("publish_manual_version", { p_actor_id: <session userId>, … })`. The actor id
is the session user, never a request parameter; `render_json` / hashes come only from this trusted
code. The RPC **independently re-verifies** ADMIN (`app.is_admin(org, p_actor_id)`), status =
`APPROVED`, `review_round > 0`, `p_expected_content_hash == submitted_content_hash ==` the
current-round `TECHNICAL`/`APPROVE` and `COMPLIANCE`/`APPROVE` `reviewed_content_hash`, the
**persisted** Phase 5 publish gate, and checklist result-set coherence — before any write.

### Publish / archive command architecture

Both RPCs: `SELECT … FOR UPDATE` the target row → authority → workflow state → (publish only)
review-hash integrity → coherence → gate → conditional `UPDATE manual_versions … WHERE status =
<expected> AND review_round = <expected>` (0 rows ⇒ typed stale error) → (publish only)
`INSERT published_snapshots` (23505 ⇒ typed conflict) → **exactly one** `audit_events` row
(`manual_version:publish` / `manual_version:archive`, safe metadata only — slug, version, snapshot
id, content hash, reviewed hash, `blockingCheckIds: []`; **no** snapshot body) → return metadata.
All mutations are in ONE transaction; any failure rolls everything back. `assertTransition` in the
pure state machine already had both edges — the server commands now realise them.

### Authoritative snapshot projection (spec §5–§9)

`buildPublishedSnapshot(vm, opts)` (`lib/publication/snapshot.ts`) wraps `projectReviewContent({ vm })`
— the **same** resolved-content projection the review fingerprint uses (no second content model)
— and adds `{ snapshotVersion: 1, public: {slug, version}, template: {id, version}, content: <core>,
images: {<assetId>: {id, storageKey, altText, caption}} }`. `content` already carries EA identity +
facts, ordered supported setups, ordered parameter groups with fully-resolved parameter
definitions (default/unit/range/effect/…), ordered sections + active blocks (deep payload),
structured changelog. `render_json` is sufficient to reproduce the documentation later **without**
re-reading `manual_sections` / `manual_blocks` / `parameter_groups` / `ea_parameters` /
`ea_version_setups` / `changelog_entries`.

### Image / signed-URL handling (spec §7–§8)

`projectReviewContent` already excludes signed URLs; the snapshot `images` map carries only
`{ id, storageKey, altText, caption }` — the **stable storage key** (a bucket path, not a URL,
fetched from `image_assets`), never a signed URL / token / expiry. `scanSnapshotForLeaks(json)`
recursively rejects `signedUrl` / `token` / `apiKey` / `authorization` / `secret` / `session` /
`requestId` / `serverTiming` / `updatedAt` / `rowVersion` keys; the server action fails closed if
it ever trips. Unit-verified (9 canonical-hash cases + 3 leak-scan cases) and browser-verified
(stored `render_json` contains no `token=` / `signedUrl`).

### Canonical snapshot hash (spec §9–§10, AC-P6-10)

`computeSnapshotHash(json) = sha256(stableStringify(json))` — reuses the repo's key-sorting
canonical serializer, so object key **insertion order** never changes the digest while array
order **is** significant. Unit tests: repeated build → identical; reversed key order → identical;
section-order / block-content / resolved-parameter / supported-setup / changelog change → different;
signed-URL change / volatile-timestamp / row-version change → **no** change. **Recompute from the
STORED `render_json`** reproduces `published_snapshots.content_hash` byte-stably — asserted in the
integration happy-path and again after source drift.

### Phase 5 publish gate + result-set coherence (spec §13–§17)

Enforced **inside the RPC against persisted rows** (rules not duplicated): (A) any `checklist_results`
row that is `required AND state = 'MISSING'` blocks; (B) any row whose `checklist_items.publish_blocking`
is true and `state = 'WARNING'` blocks — an ordinary `WARNING` does **not**. `NOT_APPLICABLE`
never blocks (scope is already baked into the persisted state). Blocked publish raises
`validation: publication is blocked by unresolved checklist items` with the offending
`check_key`s in the error `DETAIL`; the server action surfaces them as `issues[]`.
Coherence: exactly one `(checklist_template_id, checklist_template_version)` across the set
(else `mixes template versions`), and `count(results) = count(checklist_items for that template)`
(else `does not cover every checklist item`). `CHK-NO-PROHIBITED-CLAIMS` is a real
`publish_blocking` item and its `WARNING` is integration-verified to block.

### Atomic fault injection (spec §22, AC-P6-9)

**No `fail=true` backdoor.** A second manual version already owns `(organization_id, public_slug,
public_version)`; publishing the target runs `UPDATE manual_versions SET status='PUBLISHED'`
first, then the `INSERT published_snapshots` violates the `(organization_id, public_slug,
public_version)` UNIQUE. The whole transaction rolls back: target stays `APPROVED`, `published_at`
NULL, no target snapshot, no target `manual_version:publish` audit row. Integration-verified.

### Published / archived / snapshot immutability (spec §24–§27)

After publish, an authenticated author's `UPDATE`/`DELETE` on `manual_versions` and
`INSERT`/`UPDATE`/`DELETE` on `manual_sections` / `manual_blocks` / `changelog_entries` are **all**
rejected (RLS + the DRAFT-only content guards from `01400`/`01600` + `guard_published_manual_version`).
`published_snapshots` `UPDATE render_json` / `UPDATE content_hash` / `DELETE` by an authenticated
ADMIN are rejected and the row stays byte-identical. The only post-publish mutation is the
controlled `PUBLISHED → ARCHIVED` via `archive_manual_version` (which also sets `archived_at` and
touches nothing else — a simultaneous `ea_version_id` change is impossible: the RPC only writes
`status` + `archived_at`). ARCHIVED is equally frozen. Integration-verified.

### Source drift after publish (spec §53)

Mutating a live `ea_parameters.default_value` after publish leaves the stored `render_json` and
`content_hash` **byte-identical**, and `computeSnapshotHash(stored.render_json)` still equals the
stored hash. The snapshot is a standalone frozen document — it never follows live EA tables.
Integration-verified (fixture restored after).

### Decision / history safety (spec §28)

Publish and archive never touch `reviews` / `review_comments` / review rounds /
`submitted_content_hash` / `manual_version_contributors` / `ai_revisions` / checklist history.
Integration-asserted (`reviews` count unchanged through publish **and** archive).

### Public slug / version (spec §19)

`public_slug` = the existing canonical `ea_products.slug` (no new slug concept);
`public_version` = the Manual Version string. Uniqueness: `published_snapshots (organization_id,
public_slug, public_version)` UNIQUE + `(manual_version_id)` UNIQUE. Phase 7 consumes these.

### UI (spec §33–§39)

`features/manuals/publish-controls.tsx` in the builder topbar (reachable at 375 in the mobile
sub-header — not drawer-bound). ADMIN on `APPROVED` sees **"Terbitkan snapshot"** → a confirm
panel (EA name + version, Manual Version, final `slug/version`, technical + compliance decision
lines, documentation-readiness %, the immutability sentence *"Publikasi membuat snapshot
dokumentasi yang tidak dapat diedit. Perubahan berikutnya memerlukan Manual Version baru."*, and
the internal-decision note *"Keputusan internal Smartin atas dokumentasi, bukan persetujuan
regulator."*) → **"Ya, terbitkan"**. If the persisted gate has blockers the panel shows them
concretely (`CHK-… — <label> (Perlu dilengkapi/ditinjau)`) and **"Ya, terbitkan" is disabled**.
On success the status pill reads **"Diterbitkan"**, the builder is read-only, and the Metadata tab
gains a **"Snapshot publikasi"** section (published timestamp, `slug/version`, full 64-hex hash,
*"Snapshot publik telah dibuat. Halaman publik tersedia pada Phase 7."* — **no public link**).
ADMIN on `PUBLISHED` sees **"Arsipkan versi"** → confirm → **"Diarsipkan"**; the snapshot metadata
persists. A non-admin never sees an actionable control (and a forged server call is rejected).
The internal `APPROVED` state is never rendered as a bare "APPROVED" / regulator-approval.

### Slice 6 tests

- **`tests/unit/publication-snapshot.test.ts`** (12) — canonical hash §40 (repeat / key-order /
  section-order / block / parameter / setup / changelog / signed-URL / timestamp) + leak scan §8.
- **`tests/unit/review-state-machine.test.ts`** — already unit-tests all 8 edges + forged pairs
  (unchanged).
- **`tests/integration/rls.test.ts` → "Phase 6 slice 6 — publication"** (14, Supabase DEV):
  happy publish (PUBLISHED + `published_at` + one snapshot + one audit + stored-hash recompute +
  reviews unchanged); ADMIN-only (dev/reviewer/compliance/outsider rejected, authenticated cannot
  invoke the RPC); every non-APPROVED state rejected; approval precondition (no approval / old
  round / hash mismatch); required-MISSING block (blocker key in `DETAIL`); publish-blocking
  `CHK-NO-PROHIBITED-CLAIMS` WARNING block; non-blocking WARNING allowed; result-set coherence
  (incomplete / mixed versions); atomic fault injection (slug/version conflict → full rollback);
  published immutability (mv/section/block/changelog writes rejected) then ADMIN archive;
  snapshot immutability (UPDATE/DELETE rejected, byte-identical); source-drift freeze; archive
  (non-admin rejected, ADMIN → ARCHIVED + `archived_at` + snapshot intact + one audit, second
  archive rejected, reviews untouched); **all 8 workflow edges through real server commands** +
  forged illegal transitions rejected.

### Slice 6 verification results

- **Integration**: full `tests/integration/rls.test.ts` = **120 passed / 0 failed / 0 skipped**,
  two consecutive clean runs.
- `npm run lint` clean · `npm run typecheck` clean · `npm run test` **392 passed / 120 skipped**
  · `npm run build` compiled successfully.
- **Browser — happy publish** (`admin@`, DEV fixture APPROVED via the real workflow): confirm
  panel renders every required field + both notes; "Ya, terbitkan" → status **"Diterbitkan"**,
  read-only, Metadata "Snapshot publikasi" shows `vmax-ea/9.9.8` + the 64-hex hash
  `bf151e67…` + the Phase 7 message + **no** public link. DB: one snapshot,
  `computeSnapshotHash(render_json) == content_hash`, one `manual_version:publish` audit with safe
  metadata only, `render_json` free of `token=` / `signedUrl`.
- **Browser — blocked publish**: fixture with `CHK-PARAM-COMPLETE = MISSING` → the confirm panel
  shows *"Publikasi belum dapat dilakukan:"* → *"CHK-PARAM-COMPLETE — Semua input EA
  terdokumentasi (Perlu dilengkapi)"* and **"Ya, terbitkan" is disabled**.
- **Browser — archive**: `admin@` on PUBLISHED → "Arsipkan versi" → confirm → status
  **"Diarsipkan"**; the "Snapshot publikasi" metadata persists unchanged.
- **Responsive**: publish button + confirm panel verified at **1440** (full flow),
  **1024/768** (topbar full, panel stacks, no horizontal page scroll, buttons ≥ 44px), and
  **375** — the **"Terbitkan snapshot" button is reachable in the mobile sub-header** (not
  drawer-bound); the panel is `flex-direction: column; width: 100%` and the hash uses
  `word-break: break-all`. The in-app test browser's mobile click-translation flaked on the tap
  (same tooling artefact as slices 2–5); the control is present and correctly sized. Full 375
  whole-app audit remains Slice 7.
- **Regression**: Phase 3 DRAFT edit / autosave / undo-redo intact; Phase 4 AI unchanged in
  DRAFT; Phase 5 31-item validation + submission gate intact and the publish gate reuses the same
  `checklist_results` / `checklist_items` metadata; slice-2 workflow / slice-3 comments / slice-4
  changelog + fingerprint / slice-5 clone (still produces a DRAFT, never a snapshot) — all still
  in the 120/120 run.
- **Console**: a single stale replayed `two children with the same key 70000000-…-70d1` remains
  in the dev server's console buffer from the **slice-5** browser fixture (id no longer exists;
  Turbopack HMR replay — the `docs/PHASE_5.md §14`-class artefact). Current tree is clean:
  `tsc` / `eslint` / `next build` all pass.

### Slice 6 fixture / cleanup

All slice-6 integration rows are dropped in `afterAll` (snapshots first — `published_snapshots`
FK is `ON DELETE RESTRICT` — then status forced to DRAFT to clear the delete guard, then the mv).
The four browser fixtures (three `APPROVED` manuals + one blocked) were deleted after the run and
the one temporarily-changed `ea_parameters.default_value` restored. Regenerated `AGENTS.md` /
`CLAUDE.md` removed. DEV steady state: 2 demo manuals (both DRAFT), 2 EA products,
0 `published_snapshots` / `reviews` / `review_comments` / `changelog_entries`, only the genuine
`manual_version_contributors` row (viqah developer, count 21), `checklist:override_na` QA audit
row intact, no `manual_version:publish` / `:archive` / `:clone` audit rows.

---

## Slice 7 — review history + audit sweep + FINAL phase gate (implemented + verified)

### Migration `20260901002300_phase6_final_audit.sql`

New file after `20260901002200`; `01300–02200` not modified. The product has **no** template- or
member-management UI (`/templates` is a static `SectionPage`, `/settings` is read-only), but the
DB *does* expose the mutation to an ADMIN — `membership_write_admin` and `template_write_admin`
are `for all to authenticated using (app.is_admin(organization_id))`, i.e. an authenticated ADMIN
can `INSERT/UPDATE/DELETE` these rows directly through PostgREST. That real privileged path had no
audit. This migration adds:

- `app.audit_privileged_change()` — SECURITY DEFINER `AFTER INSERT/UPDATE/DELETE … FOR EACH ROW`
  trigger on `memberships` (`member:*`) and `manual_templates` (`template:*`). Fires **only** for
  a non-service authenticated caller (`app.is_service_request()` skip — migrations / seed / RPC
  internals / service jobs are the trusted path). One `audit_events` row per mutated row, actor
  from `auth.uid()` (not client-settable), safe metadata only (op, role, is_active, key, version,
  title, old→new) — never a body. `manual_templates` metadata carries `templateKind: "manual"` to
  distinguish it from a checklist template (§12).
- `app.reject_audit_mutation()` — `BEFORE UPDATE/DELETE ON audit_events`. `audit_events` already
  had **no** UPDATE/DELETE RLS policy and no UPDATE/DELETE grant to `authenticated`; this makes
  append-only explicit with a clear message. **Superseded by `20260901002400` — see below.**

### Migration `20260901002400_phase6_audit_append_only_strict.sql` (final correction)

`20260901002300` left `app.reject_audit_mutation()` with a bypass for
`('postgres', 'supabase_admin', 'service_role')`. **`service_role` is the application/server
credential** (`createSupabaseServiceClient()`), so normal application execution could still
`DELETE` / `UPDATE` audit history — contradicting the append-only invariant AC-P6-13 / PRD-SEC-007
requires. `20260901002400` `create or replace`s the function to bypass **only** an actual
database-owner identity (`postgres` / `supabase_admin`), retained solely because PostgreSQL
ownership/superuser semantics make raw DB maintenance technically possible — that is **outside the
application trust boundary**. `service_role` (application) and `postgres` (DB maintenance
authority) are not equivalent for this rule.

- **INSERT** is unaffected (the triggers are BEFORE UPDATE / BEFORE DELETE only): every SECURITY
  DEFINER workflow / publish / archive RPC, the template/member audit triggers, and the Phase-5
  N/A path still write rows — verified by the full 124/124 exactly-once suite.
- **UPDATE / DELETE** on `audit_events` is now rejected for **every** application identity — `anon`,
  `authenticated`, `ADMIN`, reviewer, developer, **and `service_role`** — raising
  `audit_events is append-only …` (`restrict_violation`).
- **No cascade-delete risk:** `audit_events.entity_id` is a plain `uuid` with **NO foreign key**,
  so deleting an audited `manual_templates` / `memberships` row never removes its audit rows
  (slice-7 template + member tests assert the audit history survives the entity deletion).
  `audit_events.organization_id` is `on delete cascade` — audit history is scoped to the lifetime
  of its **organisation**, not an individual entity; that is intentional and unchanged.

**QA-cleanup policy (from this correction on):** DEV/QA integration runs that create audit rows
**keep them**. Test fixtures use a per-run random `entity_id` so a run's retained rows are
isolated and every count assertion is delta-based (before/after). This mirrors the retained
Phase-5 `checklist:override_na` QA row — the production invariant is never weakened to obtain an
empty DEV database.

DEV migration list = **25 local == 25 remote**.

### Review history route — `/manuals/[manualId]/reviews` (AC-P6-15)

`app/(workspace)/manuals/[manualId]/reviews/page.tsx` (server component, `dynamic = "force-dynamic"`)
+ `features/reviews/getReviewHistory(orgId, manualId, manualVersionId)` + the presentational
`features/reviews/review-history.tsx`.

- **Identity / version selection (§3):** defaults to the lineage's **latest** Manual Version
  (canonical `created_at desc`). If the manual has >1 version a pill row lets you switch
  (`?v=<manualVersionId>`); `getReviewHistory` re-validates `(manualId, manualVersionId)` belong
  to the caller's org, so a stale/foreign id yields `notFound()`. The header always shows the EA
  name, EA Version + platform, and the Manual Version string — history for version A is never
  labelled version B.
- **Content (§4):** *Status saat ini* — workflow status (localised label), review round, both
  reviewer assignments, published/archived timestamps. *Per round* — round number, every
  technical + compliance decision with actor + timestamp + (for Request Changes) the required
  summary, then that round's comments with author, review type, timestamp, resolved state +
  resolver + resolved timestamp, anchor type + label, and a "(blok telah dihapus)" marker when
  the anchored block is soft-deleted. Prior rounds are **not** collapsed into the current one.
- **Comment history (§5):** reuses `listReviewComments` (Slice 3 semantics) — round-1 comments
  stay under Ronde 1 in round 2+, resolved comments stay visible, deleted-block comments stay
  visible; no anchor is mutated.
- **Wording (§6/§7):** "Disetujui reviewer teknis — [actor] · [timestamp]" / "Disetujui reviewer
  kepatuhan — …" / "Perubahan diminta oleh reviewer teknis — [actor] · [timestamp]" + the
  round-1 summary, each with the adjacent note *"Keputusan internal Smartin atas dokumentasi,
  bukan persetujuan regulator."* No "Bappebti Approved" / "Certified" / "Compliant". The internal
  `APPROVED`/`ARCHIVED` enum renders as the localised "Disetujui"/"Diarsipkan", never a bare
  regulator-looking badge.
- **Authorization (§8/§9):** requires `manual:read` in the caller's active org; every query is
  org-scoped (RLS + explicit `.eq("organization_id", …)`); a cross-org manual id → `notFound()`;
  anon never reaches the route (workspace layout redirect). Not the Phase 7 public route — no
  public link anywhere. Returns only actor **display names**, no `profiles` objects, no secrets.
- **Link (§38):** the builder Metadata → Review section renders **"Lihat riwayat review →"** →
  `/manuals/[id]/reviews` (browser-verified). Not a URL-only dead route.

### Audit exactly-once — complete matrix (AC-P6-13 / PRD-SEC-007)

| Action (one user action) | Server path | DB path | `audit_events.action` | Exactly-once tested |
|---|---|---|---|---|
| Assign / reassign reviewers | `assignReviewers` (`features/reviews/actions.ts`) | `assign_reviewers` RPC | `manual_version:assign_reviewers` | slice-2 test 1 (1 row; reassign → +1) |
| Submit for technical review | `submitForTechnicalReview` | `submit_for_technical_review` RPC | `manual_version:submit_review` | slice-2 tests 5/13 |
| Begin revision | `beginRevision` | `begin_revision` RPC | `manual_version:begin_revision` | slice-2 test 13 |
| Technical approve | `technicalDecision` | `record_technical_decision` RPC | `manual_version:technical_approve` | slice-2 tests 5/13 |
| Technical request changes | `technicalDecision` | `record_technical_decision` RPC | `manual_version:technical_request_changes` | slice-2 tests 5/13 |
| Compliance approve | `complianceDecision` | `record_compliance_decision` RPC | `manual_version:compliance_approve` | slice-2 tests 9/13 |
| Compliance request changes | `complianceDecision` | `record_compliance_decision` RPC | `manual_version:compliance_request_changes` | slice-2 tests 10/13 |
| Clone Manual Version | `cloneManualVersion` | `clone_manual_version` RPC (`FOR EACH STATEMENT` semantics — one row per clone even with N sections) | `manual_version:clone` | slice-5 tests 1/5, "clone integrity" tests 2–3 |
| Publish | `publishManualVersion` | `publish_manual_version` RPC (service-role-only) | `manual_version:publish` | slice-6 tests 1/12; slice-6 test 9 (0 rows on rollback) |
| Archive | `archiveManualVersion` | `archive_manual_version` RPC (service-role-only) | `manual_version:archive` | slice-6 test 13 |
| Manual-template mutation (ADMIN, direct PostgREST) | *(no UI)* — RLS `template_write_admin` | `manual_templates_audit` trigger → `app.audit_privileged_change('template')` | `template:insert` / `template:update` / `template:delete` | slice-7 test 2 (1 row each; non-admin + cross-org rejected) |
| Member mutation (ADMIN, direct PostgREST) | *(no UI)* — RLS `membership_write_admin` | `memberships_audit` trigger → `app.audit_privileged_change('member')` | `member:insert` / `member:update` / `member:delete` | slice-7 test 3 (1 row each; non-admin + cross-org rejected; actor from `auth.uid()` — not forgeable) |
| Checklist reviewer N/A override | `overrideChecklistItem` (`features/validation/actions.ts`) | service-role write + `writeAudit` | `checklist:override_na` | Phase-5 evidence (kept 1 row on DEV) |

**Not privileged-audit actions (by design):** ordinary DRAFT content edits (`manual:update`
sections/blocks), changelog CRUD, and **review comments** create/resolve. Comments and changelog
edits are *documentation content*, not workflow/authority actions — they are already immutable
after creation (comment body/anchor guard, `assert_changelog_draft`), fully reconstructable from
their own tables + `manual_version_contributors`, and covered by their slice-3/slice-4 tests.
Adding an `audit_events` row per comment would be per-child-row noise (spec §14). `ai:request` /
`ai:decision` are Phase-4 actions.

**Append-only (§15, strict — `20260901002400`):** `audit_events` has SELECT + INSERT RLS only
(no UPDATE/DELETE policy), `select, insert` grant to `authenticated` only, **and**
`app.reject_audit_mutation()` which — after the final correction — bypasses **only** a
database-owner identity (`postgres` / `supabase_admin`). Slice-7 append-only test: `service_role`
`UPDATE` **and** `DELETE` on `audit_events` are rejected (`… is append-only …`); an authenticated
ADMIN / developer are rejected; anon has no access; the row is byte-for-byte unchanged after every
failed mutation. INSERT of a legitimate privileged audit row still works (the test seeds one via
`assign_reviewers`). **`service_role` (application) is NOT a cleanup bypass** — only real DB-owner
maintenance, which is outside the application trust boundary.

**Metadata safety (§16):** every Phase 6 privileged-action metadata payload is ids / bounded
summary (≤500 chars) / round / old+new status / reviewer ids / check ids / hashes / public
slug+version / role / is_active — asserted free of manual body, block payload, snapshot
`render_json`, comment body, tokens, signed URLs, secrets (slice-2 test 1, slice-6 test 1,
slice-7 tests 2–3 string scans).

**Actor integrity (§17):** RPC audit rows use `p_actor_id` derived from the authenticated server
session (`requireActiveOrg().userId`) and the RPC re-checks `app.is_admin`; the trigger audit
rows use `auth.uid()` directly. There is no client-supplied `actor_id` parameter on any path.
Slice-7 test 3 asserts the trigger audit `actor_id` is the real acting admin.

### Final Global-Invariant matrix (AC-P6-1)

| GI | Verdict | Evidence |
|---|---|---|
| **GI-1** | **PASS** | Source scan (`app/ features/ components/ lib/`): the only "Bappebti approved" / "Compliant" strings are in comments / the AI claim-scanner rule that **forbids** them. Visible `APPROVED` always renders as "Disetujui" (label map) or "Disetujui reviewer teknis/kepatuhan — [name] · [timestamp]" (allowed human-review wording) with the adjacent "…bukan persetujuan regulator." note. Rendered browser scan of the review-history route + publish confirm + status pills — no "Approved"/"Certified"/"Compliant"/"Bappebti Approved" label. Phase-5 computed-output scan still green. |
| **GI-2** | **PASS** | `SupabaseManualDataSource` loads every fact by explicit id from the routed `manualId`; `getReviewHistory` / `getReviewContext` / snapshot queries all `.eq("organization_id", …)` + `.eq("id"/"manual_id", …)`. Slice-2..7 cross-org tests: org B sees zero rows for every Phase 6 entity. Browser: the history header showed only the routed manual's EA + version. |
| **GI-3** | **PASS** | `npm run lint` clean · `npm run typecheck` clean · `npm run build` compiled successfully (all 19 routes incl. `/manuals/[manualId]/reviews`). |
| **GI-4** | **PASS** | Fresh **production** server (`next start`, no HMR): clean load of `/manuals/[id]/reviews` (375/768/1024/1440), `/reviews/technical`, and the builder — `read_console_messages` returned **no errors** and no duplicate-key warning. The slice-2..6 "stale Turbopack replay" note no longer applies (that buffer was the old `next dev` process). |
| **GI-5** | **PASS** | Rendered `document.documentElement.scrollWidth === clientWidth` (no doc horizontal scroll) at **375 / 768 / 1024 / 1440** for the review-history route and the builder; `.builder-grid` centre column has zero non-`overflow:auto` offenders at 375. |
| **GI-6** | **PASS** | "Ya, terbitkan" is `disabled` only with the blocker list visible above it; "Kirim review" carries a `title`/adjacent reason; history-page version pills use `aria-current`. No inert buttons on the Phase 6 surfaces. |
| **GI-7** | **PASS** | Status shown by icon **and** text on the history page (`✓` + "Disetujui reviewer …", `↺` + "Perubahan diminta …", resolved `✓ Selesai`); comment/decision cards also carry a coloured left border **and** a text badge. The drawer close button is 42×42 px; visible focus rings inherited from the base sheet; `prefers-reduced-motion` block in `globals.css` unchanged. |
| **GI-8** | **PASS** | 124/124 live integration includes every Phase 6 cross-org case — workflow, assignments, `reviews`, `review_comments`, `changelog_entries`, `manual_version_contributors`, `published_snapshots`, `clone_manual_version`, history queries, and the new `manual_templates` / `memberships` audit paths (org-B admin cannot touch ORG_A rows). |
| **GI-9** | **PASS** | `lib/supabase/service.ts` is `import "server-only"`; the secret key is read only there + `lib/env.ts`; the two slice-6 service-role RPCs are called only from `"use server"` actions. No new client bundle reference (build clean; `publish-controls.tsx` imports only the action). |
| **GI-10** | **PASS** | Unchanged from Phase 4/5 — `fact-bundle.ts` keeps `setup` `symbol`+`timeframe` paired; the snapshot projection reuses `projectReviewContent`, which emits one `supportedSetups[]` entry per stored `ea_version_setups` row and never crosses symbol×timeframe. No Phase 6 code infers a configuration. |
| **GI-11** | **PASS** | `parameter_groups`/`ea_parameters` FK to `ea_versions` only (schema unchanged); `clone_manual_version` remaps `parameterTable` group ids to the **target EA Version's** groups by name and never copies definitions (slice-5 "target-data ownership" — source `0.01` → target `0.02`); the snapshot freezes the resolved definitions but they still originate from the linked EA Version. |
| **GI-12** | **PASS** | Unchanged — `ea_version_setups.tested_minimum_lot` is still the only lot figure, labelled "Tested Minimum Lot" with the broker-spec note in the editor / Ch.2 / Ch.9 / preview; no Phase 6 surface introduces a universal EA minimum lot; the snapshot carries the setup rows verbatim. |

### Slice 7 tests

- **`tests/integration/rls.test.ts` → "Phase 6 slice 7 — review history + template/member audit"**
  (4, Supabase DEV): two real review rounds (round 1 technical comments manual+block + Request
  Changes with summary; round 2 technical Approve, compliance comment, compliance Approve, then
  publish + archive) → the persisted `reviews` + `review_comments` are exactly the expected
  decisions/comments across both rounds, the block-anchored round-1 comment survives its block
  being soft-deleted, and an org-B user + anon see **zero** rows; ADMIN `manual_templates`
  insert+update → exactly one `template:insert` + one `template:update` audit (safe metadata,
  actor = admin), non-admin + org-B admin rejected; ADMIN `memberships` insert+update → exactly
  one `member:insert` + one `member:update` audit (actor from `auth.uid()`, metadata safe),
  non-admin + org-B admin rejected; an authenticated ADMIN cannot `UPDATE`/`DELETE` an
  `audit_events` row.
- All prior slice tests unchanged and green in the 124/124 run.

### Slice 7 verification results

- **Integration**: full `tests/integration/rls.test.ts` = **124 passed / 0 failed / 0 skipped**,
  one clean full run (a second was not run to stay within Auth rate limits — the slice-7 subset
  + the full run were both clean).
- `npm run lint` clean · `npm run typecheck` clean · `npm run test` **392 passed / 124 skipped**
  · `npm run build` compiled successfully.
- **Browser — review-history route** (fresh production server, `developer@`): the full two-round
  history renders — status ARCHIVED / round 2 / both reviewers / published + archived timestamps;
  Ronde 1 "Perubahan diminta oleh reviewer teknis — Rina Reviewer (DEMO) · …" + summary + 2
  comments (one resolved with resolver + timestamp, "Seluruh manual" anchor; one "Belum selesai",
  "Blok #1 · text · Sampul" anchor); Ronde 2 "✓ Disetujui reviewer teknis / kepatuhan — … · …"
  each with the internal-decision note + 1 compliance comment. No prohibited copy; long
  summaries/comments wrap; no horizontal scroll; clean console.
- **Browser — mobile Inspector / chapter nav (§26/§27 — RESOLVED)**: the prior "375 Inspector
  toggle intermittently unresponsive" note was a **test-harness artefact** (the in-app browser's
  mouse→touch translation selects text instead of firing a click at mobile viewport, and the
  tool call times out with "pane is currently hidden"). Proven on a fresh production server via
  reliable DOM-event dispatch: tapping "Inspector" opens the right-anchored 330 px drawer
  (visible, screenshot-confirmed) with the Validasi / Metadata / Komentar tablist; switching to
  Metadata sets `aria-selected` correctly and renders Produk / Kepemilikan / Review / Snapshot
  publikasi / clone sections; switching to Komentar works; the 42×42 px "X" closes it;
  `.drawer-scrim` tap closes it; "Bab" opens the chapter drawer with 19 chapter buttons,
  selecting one keeps the drawer open (pre-existing Phase-3 behaviour — still dismissible by X /
  scrim, no trapped focus, no inaccessible close). **Not an app bug.**
- **Responsive final (§25)**: review-history + builder verified at 375 / 768 / 1024 / 1440 —
  `scrollWidth === clientWidth`, no nested horizontal scroll in the builder centre column, the
  publish confirm / blocker list / snapshot metadata / archive confirm (slice-6) and the history
  page all wrap and stay contained.
- **Regression (§30–§33)**: Phase 3 DRAFT editing / autosave / undo-redo / block + chapter
  reorder / conflict — unchanged (automated suite green); Phase 4 AI unchanged in DRAFT, no
  review-state mutation, grounding guards green; Phase 5 — 31 items, dynamic denominator, PBK
  suppression, reviewer N/A, submission gate + the new publish gate all reuse the same
  `checklist_results` / `checklist_items`, `CHK-CHANGELOG-VERSI` structured source intact; all
  Phase 6 slice suites (1 state-machine/fingerprint/contributors · 2 assignment/queues/decisions/
  concurrency/self-approval/two-rounds · 3 comments/anchors/resolve · 4 changelog/Pasal 8 · 5
  clone/target-facts/latest-lock/checklist-pinning · 6 publish/rollback/immutability/archive) —
  all in the 124/124 run.

### Slice 7 fixture / cleanup (after the append-only correction)

Slice-7 **relational** fixture rows drop in `afterAll` (manuals / versions / sections / blocks /
reviews / comments / snapshots / checklist_results / the throwaway `manual_templates` +
`memberships` **entity** rows). **`audit_events` rows are NEVER deleted** — not by tests, not by
the service role (`20260901002400`). The `template:*` / `member:*` / workflow audit rows those
runs created are **retained DEV/QA evidence** with safe metadata; fixtures use a per-run random
`entity_id` so retained rows never collide with a later run's assertions (all count checks are
delta-based). Regenerated `AGENTS.md` / `CLAUDE.md` removed. The prod server on :3100 was stopped.

**DEV steady state:** **25 migrations local == remote**; 2 demo manuals (both DRAFT);
0 `published_snapshots` / `reviews` / `review_comments` / `changelog_entries`; `checklist_results`
= 62 (31 per demo manual — legitimate: opening a builder persists that manual's evaluation);
`manual_templates` = 1 (system template — the per-run QA template rows deleted); ORG_A
`memberships` = the 5 seed rows (QA `COMP+DEVELOPER` deleted); `manual_version_contributors` = 1
(viqah developer, count 21).

**Retained DEV/QA `audit_events` (append-only — safe metadata only):**
`manual_version:submit_review` 54, `manual_version:technical_approve` 38,
`manual_version:technical_request_changes` 8, `manual_version:compliance_approve` 27,
`manual_version:compliance_request_changes` 5, `manual_version:begin_revision` 12,
`manual_version:assign_reviewers` 5, `manual_version:publish` 18, `manual_version:archive` 8,
`manual_version:clone` 8, `template:insert` 2, `template:update` 2, `member:insert` 2,
`member:update` 2, `checklist:override_na` 1 (Phase-5). Every payload is ids / op / round /
from+to status / slug+version / snapshot id / content+reviewed hashes / `blockingCheckIds: []` /
role / isActive / targetUserId / templateKind / previous* / bounded title — **no** manual body,
block payload, `render_json`, comment body, token, signed URL, or credential. The `template:*` /
`member:*` rows point to `entity_id`s whose entities have since been deleted — proof that audit
history survives entity lifecycle changes (no cascade).

---

## Acceptance-criteria matrix — Phase 6

**Slices 1–7 are complete.** Every `MUST` criterion (AC-P6-1..6, 8..13, 15, 16) is **PASS** and
the one `SHOULD` (AC-P6-7) plus the `SHOULD`-ish AC-P6-14 are **PASS** — **Phase 6 is READY**.
Commit/push is deferred to the maintainer's final approval.

**FINAL (after slice 7).** Every MUST criterion below is **PASS** — Phase 6 is **READY** (pending
the maintainer's approval before commit/push).

| AC | Verdict (FINAL) | Evidence |
|---|---|---|
| **AC-P6-1** | **PASS** | Full GI matrix above — GI-1..GI-8, GI-10, GI-11, GI-12 all PASS (GI-9 also PASS): source + rendered-browser regulatory-copy scan, cross-org 124/124, lint/typecheck/build clean, **fresh production-server console clean** on the tested routes, `scrollWidth===clientWidth` at 375/768/1024/1440, icon+text status, service key server-only, paired setups + EA-Version-owned params + Tested-Minimum-Lot unchanged. |
| **AC-P6-2** | **PASS** | All **8** edges execute through explicit server-side commands — `submit_for_technical_review`, `record_technical_decision`, `record_compliance_decision`, `begin_revision` (slices 2), and `publish_manual_version`, `archive_manual_version` (slice 6, SERVICE-ROLE-ONLY, ADMIN re-checked in the RPC). Slice-6 integration test 14 walks `DRAFT→TECHNICAL_REVIEW→CHANGES_REQUESTED→DRAFT→TECHNICAL_REVIEW→COMPLIANCE_REVIEW→CHANGES_REQUESTED→…→APPROVED→PUBLISHED→ARCHIVED` and asserts each resulting status; forged direct `UPDATE manual_versions SET status=…` for illegal pairs is rejected at the DB. The pure state-machine module unit-tests all 8 edges + representative forged pairs. No generic `setStatus`. |
| **AC-P6-3** | **PASS** | `assign_reviewers` (ADMIN-only; role + same-org + active enforced by the RPC **and** the `guard_manual_version_update` trigger; reassignment audited) + real `/reviews/technical` + `/reviews/compliance` queues that are assignment-scoped, org-scoped, and admin-sees-all. Slice-2 integration tests 1–4 + DEV browser check. |
| **AC-P6-4** | **PASS** | Reviewers add comments anchored to the **manual / a section / a block** (`create_review_comment`, stage- + assignment-gated); **resolved / unresolved** state with resolver + timestamp, toggled by `set_review_comment_resolved` (assigned reviewer of that type only). Anchor integrity: typed RPC rejection + the `…001300` same-version trigger + composite cross-org FKs. Body/anchor/author/round/type immutable after creation (`app.guard_review_comment_update`). **Persists across rounds** — round-1 comments unchanged through `CHANGES_REQUESTED → revision → resubmit`, round-2 comments under round 2, query returns all. Slice-3 integration tests 1–8 + browser (technical / developer-revision / compliance flows). |
| **AC-P6-5** | **PASS** | `record_technical_decision`: `APPROVE→COMPLIANCE_REVIEW`, `REQUEST_CHANGES→CHANGES_REQUESTED` with a DB-enforced non-empty summary. `record_compliance_decision`: `APPROVE→APPROVED`, and it raises `workflow: compliance review is unreachable without a recorded technical approval for this round` when no current-round `TECHNICAL`/`APPROVE` row exists. Slice-2 integration tests 9–10. |
| **AC-P6-6** | **PASS** | On **APPROVE only** (technical *and* compliance), an actor present in `manual_version_contributors` is rejected with typed `self approval forbidden: …` — not silently skipped; an independent reviewer succeeds; a contributor reviewer may still Request Changes. Durable provenance is the slice-1 trigger + backfill. Slice-2 integration test 8. |
| **AC-P6-7** | **PASS** (SHOULD) | `reviews (manual_version_id, round_number, review_type)` UNIQUE = one technical + one compliance decision per round; two concurrent `record_technical_decision` calls converge to exactly one `reviews` row + one transition + one audit row, loser gets a typed error (slice-2 test 11). No 40001 retry storm (default `raise_exception`). |
| **AC-P6-8** | **PASS** | Resubmission after `CHANGES_REQUESTED` (via `begin_revision` → `submit_for_technical_review`) always re-enters `TECHNICAL_REVIEW`, never `COMPLIANCE_REVIEW`; `review_round` increments (slice-2 test 12). Prior **comment** threads remain visible and byte-identical (`round_number` unchanged, resolved state preserved) across the round boundary, and stay visible to the developer revising in `DRAFT` — slice-3 test 8 + the developer-revision browser flow. |
| **AC-P6-9** | **PASS** | `publish_manual_version` performs status → `PUBLISHED` + `published_at` + exactly one `published_snapshots` row + exactly one `manual_version:publish` audit row in **ONE** transaction. Real fault injection (a pre-existing `(organization_id, public_slug, public_version)` owner ⇒ the snapshot `INSERT` fails AFTER the status `UPDATE`) rolls **everything** back — target stays `APPROVED`, `published_at` NULL, no target snapshot, no target audit (slice-6 integration test 9). One snapshot per version (`manual_version_id` UNIQUE); a second publish fails. No `fail=true` backdoor. |
| **AC-P6-10** | **PASS** | `snapshotHash = sha256(stableStringify(render_json))` — key-order-insensitive, content-order-sensitive. Re-running the canonical serialize+SHA-256 **against the stored `render_json`** reproduces `published_snapshots.content_hash` byte-stably (slice-6 integration happy-path + after source drift; `tests/unit/publication-snapshot.test.ts` 12 cases incl. signed-URL / timestamp / row-version → no change). Before publish the server recomputes `manualReviewFingerprint(currentVm)` and the RPC rejects unless it equals `submitted_content_hash` **and** both current-round approval `reviewed_content_hash` values — no silent refresh, no re-approval. Published + archived content is DB-immutable (mv / sections / blocks / changelog writes rejected); `published_snapshots` `UPDATE`/`DELETE` by an authenticated ADMIN rejected and byte-identical; the only carve-out is `PUBLISHED → ARCHIVED` via `archive_manual_version` (status + `archived_at` only). |
| **AC-P6-11** | **PASS** | `clone_manual_version` requires the source to be the lineage's **current latest Manual Version** (canonical `created_at desc` semantics, checked under a `manuals` `FOR UPDATE` lock so concurrent clones serialise and the loser is rejected as stale) and clones its **sections, blocks, manual-template scaffold, and structured changelog** into a fresh `DRAFT` linked to the **chosen target EA Version** with a new unique version string; the source is unchanged. It does **not** clone `parameter_groups` / `ea_parameters` / `ea_version_setups` — `parameterTable` blocks are **remapped by group name** (whole clone rolls back and names the group if any is missing), and the VM/render resolves target params + setups (source default `0.01` → target `0.02` proven). The **checklist-template version** is resolved from the source's `checklist_results` (mixed → integrity error; none → active-template fallback), returned by the RPC, and the app-side `refreshValidation` pins the new version's **fresh** evaluation to it (no states/evidence/overrides copied; browser-verified: source on checklist v1 → clone's 31 results all v1 while active is v2). One atomic transaction; concurrency-safe; one `manual_version:clone` audit row (`checklistTemplateVersion` recorded). Slice-5 integration tests 1–6 + "clone integrity" tests 1–6 + developer happy-path / missing-group / v1-vs-v2 browser flows. |
| **AC-P6-12** | **PASS** | Two gates on the same Phase 5 model. Submit: `submitForTechnicalReview` → `refreshValidation`, `NOT_READY` + `blockingReasons` while any required in-scope `MISSING` (slice-2). Publish: `publish_manual_version` inspects the **persisted** `checklist_results` + `checklist_items` — (A) required `MISSING` blocks, (B) `publish_blocking` item at `WARNING` blocks, an ordinary `WARNING` does **not**, `NOT_APPLICABLE` never does; plus result-set coherence (one template version, full item coverage). `CHK-NO-PROHIBITED-CLAIMS` WARNING integration-verified to block; a non-publish-blocking WARNING integration-verified to publish. Blocker `check_key`s returned in the error `DETAIL` and shown in the UI confirm panel (button disabled). Slice-6 integration tests 5–8 + DEV browser blocked flow. |
| **AC-P6-13** | **PASS** | See the **audit complete matrix** above. Every privileged action writes **exactly one** append-only `audit_events` row (actor / action / entity type+id / safe metadata / timestamp): assignment, submit, begin-revision, technical + compliance decisions, clone, publish, archive (slices 2/5/6), **and** — via `20260901002300` DB triggers on the only real ADMIN mutation path that lacked audit — `manual_templates` + `memberships` changes (`template:*` / `member:*`, slice-7 tests: one row per row-change, actor from `auth.uid()` not forgeable, metadata body-free, non-admin + cross-org rejected). **`audit_events` is STRICTLY append-only** (`20260901002400`): `UPDATE` / `DELETE` are rejected for `anon`, `authenticated`, `ADMIN`, reviewer, developer, **and `service_role`** (only a DB-owner identity — `postgres` / `supabase_admin` — can, outside the application trust boundary); slice-7 append-only test proves the service-role `UPDATE` **and** `DELETE` both fail and the row is byte-identical. Entity deletion does **not** cascade-delete audit history (`entity_id` has no FK) — slice-7 template + member tests delete the entity and assert the audit rows remain. Legitimate audit INSERT still works (124/124 exactly-once suite). No template/member **UI**; comments & changelog content edits are deliberately not privileged-audit actions (documented in the matrix). |
| **AC-P6-14** | **PASS** | A feature-change changelog entry (`is_feature_change`, set explicitly by the developer — never inferred) surfaces the Perba 12/2022 Pasal 8 operational reminder (client approval + report to Kepala Bappebti) **only** when `pbkScope = IN_SCOPE`; an OUT_OF_SCOPE EA shows a neutral note, not the obligation. The tool performs **no** filing / submission / approval and stores **no** regulatory-completion field (§9). Structured CRUD is DRAFT-only, contributor-attributed, source-EA-version-lineage-guarded, BREAKING-impact-enforced, and part of the authoritative `manualReviewFingerprint`. Slice-4 integration tests 1–8 + `changelog.test.ts` + the developer / reviewer / OUT_OF_SCOPE browser flows. Decision recorded (PRD-OQ-010, above). |
| **AC-P6-15** | **PASS** | `/manuals/[manualId]/reviews` (server component + `getReviewHistory`): defaults to the lineage's latest Manual Version (canonical `created_at desc`, version-switch pills when >1), shows current status / round / both assignments / published+archived timestamps, and **every round** with its technical + compliance decisions (actor + timestamp + Request-Changes summary, not collapsed) and its comments (author, review type, timestamp, resolved + resolver + timestamp, anchor label, soft-deleted-block marker). Wording is "Disetujui reviewer teknis/kepatuhan — [name] · [timestamp]" + the internal-decision note, never a regulator badge. Org-scoped (RLS + explicit `.eq`), cross-org → `notFound()`, anon blocked, only actor display names returned. Reachable from the builder Metadata → "Lihat riwayat review →". Slice-7 integration test 1 (two real rounds + org isolation + anon) + DEV browser (1440 + 375/768/1024, clean console). |
| **AC-P6-16** | **PASS** | PRD-OQ-007 (ADMIN-only publishing) and PRD-OQ-010 (record + Pasal 8 reminder only) have recorded decisions here, in `docs/PRD.md`, and in `docs/REQUIREMENTS_TRACEABILITY.md`. |

---

## Known limitations / follow-ups

- **`audit_events` is strictly append-only for ALL application code, `service_role` included**
  (`20260901002400`). Trusted server jobs may INSERT audit rows but never UPDATE/DELETE them; the
  only bypass is a real DB-owner identity (`postgres` / `supabase_admin`), which is DB
  maintenance authority outside the application trust boundary. Consequence: DEV/QA integration
  runs accumulate safe-metadata audit rows that cannot be cleaned — this is intentional (the
  Phase-5 `checklist:override_na` QA row is the same). Fixtures use per-run random `entity_id`s +
  delta-based assertions so accumulation is harmless.
- **Slice 7 — no template / member management UI.** `/templates` is a static page and `/settings`
  is read-only, so the only template/member mutation path is an authenticated ADMIN calling
  PostgREST directly (RLS `template_write_admin` / `membership_write_admin`). AC-P6-13 is
  satisfied for that real path via DB audit triggers (`20260901002300`). Building an actual admin
  UI for templates/members is out of Phase 6 scope; when one is added it should rely on the
  existing `app.audit_privileged_change()` triggers for the audit row (not add its own
  `writeAudit`, which would double-log), matching how the workflow RPCs own their audit writes.
- **Slice 7 — the mobile chapter-nav drawer stays open after selecting a chapter** (pre-existing
  Phase-3 behaviour). It is still dismissible via the X button or the scrim; no trapped focus.
  The Inspector drawer *does* close on the relevant navigation actions. Not a Phase 6 regression.
- **Slice 7 — the in-app test browser cannot reliably fire a tap at mobile viewport** (it selects
  text and the tool times out). The 375 Inspector / chapter-nav interactions were therefore
  verified on a fresh production server via dispatched DOM events + screenshots, not synthetic
  taps. The app behaviour is correct; this is a harness constraint.
- **Slice 6 — publish/archive are SERVICE-ROLE-ONLY RPCs.** They are the first Phase 6 RPCs not
  granted to `authenticated`. This is deliberate (spec §12): a caller-supplied `render_json` /
  hash path must not be browser-reachable. The server action is the sole caller and passes the
  authenticated session's user id as `p_actor_id`; the RPC still re-checks `app.is_admin`.
- **Slice 6 — `render_json` trust.** The snapshot bytes are built by trusted server code from the
  persisted VM; the RPC does not re-derive them (that would need a second content model in SQL,
  which the spec forbids). Integrity rests on the RPC being unreachable from the browser + the
  review-fingerprint precondition + `scanSnapshotForLeaks`. A future hardening could have the RPC
  recompute a cheap structural digest of `render_json`, but it is not required by the ACs.
- **Slice 6 — `20260901002200` reconciles the pre-existing `app.guard_published_manual_version()`**
  (`20260901000400`, self-described "light guard … full Phase 6 later"): it had no trusted-caller
  bypass and did not cover `ARCHIVED`. `01300–02000` were **not** modified; the fix is a small
  `create or replace` follow-up (sanctioned by spec §56). The slice-6 `guard_manual_version_update`
  frozen block + `reject_frozen_manual_version_delete` trigger are now redundant defence-in-depth.
- **Slice 6 — no public route / asset copy / PDF.** Phase 6 only *freezes* `published_snapshots`.
  `/manual/[eaSlug]/[version]`, the public TOC / search / version switcher, PDF generation, the
  Playwright print job, signed print routes and public asset serving are **Phase 7** and were not
  started. The builder's success UI explicitly says "Halaman publik tersedia pada Phase 7" and
  shows **no** public link.
- **Slice 6 — readiness % shows "—" when every required item is `NOT_APPLICABLE`** (`score.percent`
  is `null` by design — 0/0). The publish gate still runs against the persisted rows, so this is
  cosmetic.
- **Slice 6 — 375 publish surface.** The "Terbitkan snapshot" / "Arsipkan versi" control is in the
  builder **topbar sub-header** and *is* reachable at 375 (not drawer-bound), but the in-app test
  browser's mobile tap-translation flaked on the confirm click (same tooling artefact as slices
  2–5). The full 375 whole-app audit is Slice 7.
- The contributor backfill cannot reconstruct editors the old schema never captured; documented
  above. DEV backfill = 0 rows.
- Cloning is allowed **into the same EA Version** (a documentation-only re-version). The RPC and
  the PRD permit it; the UI just marks that option "(versi EA saat ini)". If a stricter rule is
  ever wanted it belongs in source-of-truth first.
- The clone's Phase 5 refresh is a separate application-side call after the atomic DB clone (the
  evaluator is not SQL). On a refresh failure the DRAFT exists and the UI offers a retry — it is
  never presented as part of the clone transaction.
- After a clone the source manual version is no longer the one the `/manuals/[id]/edit` route
  renders (it always shows the latest). Source review history is intact; there is no dedicated
  "edit an older version" route (out of scope for Phase 6). Cloning from a now-stale source is a
  hard server error (`STALE`), not a silent sibling.
- `20260901001800` was reverted + re-pushed once on DEV during slice-5 development (same
  uncommitted slice) to fix a PL/pgSQL `SELECT … INTO` stale-variable bug in the group-remap
  loop; the fixed version is deployed and pinned by slice-5 test 3.
- The slice-5 final correction adds `20260901001900` (latest-source lock + checklist-version
  resolution) and `20260901002000` (fixes `min(uuid)` — no such aggregate in Postgres; splits it
  into a `count(distinct version)` guard + a single-row read). `…001800` was **not** rewritten.
  All three are `create or replace` of `clone_manual_version`; DEV migration list = 21 local ==
  21 remote.
- The clone's checklist refresh is pinned to the **source's** checklist-template version, not the
  active one. If a source has never been evaluated the clone uses the current active template
  (documented fallback) — a source cannot be cloned into a "fake" historical checklist version.
- `reviews` DELETE has a service-request carve-out (for cascade / infra cleanup); slice 6
  revisits the exact immutability surface once publish/archive triggers land.
- New-table write policies: `reviews` (slice 2), `review_comments` (slice 3), and
  `changelog_entries` (slice 4) rows are written **only** by their SECURITY DEFINER RPCs (still no
  client `INSERT/UPDATE/DELETE` policy — the RPC runs as `postgres`); `published_snapshots`
  (slice 6) remains SELECT-only for members until then.
- `app.assert_changelog_draft` (like `app.assert_manual_version_draft`) is SECURITY INVOKER with
  a `postgres` / `supabase_admin` / `service_role` early-return, so it fires for the
  `authenticated` role (a forged direct client write) but not for the RPCs or service/cascade
  cleanup. Since RLS already denies every client write, the trigger is genuine defence-in-depth
  (it would still enforce DRAFT-only if a client write policy were ever added). Slice-4 test 6
  shows the forged client write blocked; the isolated trigger-fires-for-`authenticated` path is
  not separately reachable today.
- `source_ea_version_id` stays nullable (schema unchanged). The authoring UI defaults it to the
  linked EA version and offers only same-lineage options, but does not force a non-null value —
  matching the current schema/PRD.
- Slice-4 `open_position_impact` is only *required* for `BREAKING`; it is stored for any type if
  provided but the UI only shows the field for `BREAKING`.
- Comment resolve/reopen has **no status/round gate** — the assigned reviewer of a comment's type
  may resolve/reopen it in any later stage. This is the intended reading of §8 ("the assigned
  … reviewer for that Manual Version may resolve/reopen"); §10's "read-only outside the active
  stage" is applied to *content* and to *other actors*, not to the assigned reviewer's own
  resolution metadata.
- Block anchor "focus" is scroll-into-view + a 1.8 s flash on the block's `[data-block-id]`
  wrapper (there is no per-block route). A soft-deleted target block keeps the comment; the panel
  labels it and its "Lihat" falls back to the section.
- Slice 2 has **no** `APPROVED→PUBLISHED` / `PUBLISHED→ARCHIVED` command yet (slice 6). The
  builder topbar shows a status pill, not an action, for `APPROVED` / `PUBLISHED` / `ARCHIVED`.
- The full decision **click-through** in the browser is not yet exercised end to end (needs a
  Phase-5-ready fixture manual on DEV); the workflow itself is covered by the 14 slice-2
  integration tests + a standalone end-to-end script. Slice 7 does the six-scenario browser pass.
- Slice-2 integration runs are sensitive to Supabase Auth `/token` **sign-in rate-limiting** when
  many full suites run back-to-back — an infra ceiling, not a code defect. Four clean 77/77 runs
  were obtained; two interleaved runs failed only on that rate limit.
