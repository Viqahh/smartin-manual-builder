# Acceptance Criteria — Smartin Manual Builder

> Objective pass/fail criteria for each phase of `docs/IMPLEMENTATION_PLAN.md`. A phase is **accepted** only when every `MUST` criterion passes and the phase-gate checks (run app, lint, typecheck, build, browser workflow, console, responsive) are recorded in that phase's report. `SHOULD` criteria are tracked; a miss is documented, not silently dropped.
>
> Format: each criterion is a single verifiable statement. IDs are `AC-P<phase>-<n>`. Cross-references point to `docs/REQUIREMENTS_TRACEABILITY.md` requirement IDs.
>
> **Global invariants** — must hold at the end of **every** phase from the phase where they first apply:
> - **GI-1** No screen, PDF, log, or API response labels any computed value or Smartin reviewer decision as "Approved", "Bappebti Approved", "Certified", "Compliant", or equivalent. Only "ready for compliance review" / "documentation checklist completed" / "compliance reviewer: approved (name, timestamp)".
> - **GI-2** Creating an EA/manual named X never displays another EA's data (no "VMax" bleed). Every builder/inspector/preview/cover value is for the manual in the route.
> - **GI-3** `npm run lint`, `npm run typecheck`, and `next build` pass with zero errors.
> - **GI-4** Browser console is free of errors and warnings on the main workflow.
> - **GI-5** No document-level horizontal scroll and no nested horizontal scroll in the builder centre column at 375 / 768 / 1024 / 1440 px.
> - **GI-6** Every disabled control has a visible reason (title or adjacent text). No inert buttons.
> - **GI-7** Status is always conveyed by icon **and** text, never colour alone; visible focus rings; 44px touch targets; `prefers-reduced-motion` respected.
> - **GI-8** From Phase 2 on: a member of Organisation A cannot list, read, or mutate any entity of Organisation B.
> - **GI-9** From Phase 2 on: the Supabase service/secret key is absent from the browser bundle.
> - **GI-10** From Phase 2 on: a supported `symbol × timeframe` combination exists only as an explicit stored `ea_version_setups` row. No UI, output, validation, or AI path ever infers a combination from independently listed symbols and timeframes (e.g. `EURUSD` + `M15` present separately never yields "supports `EURUSD / M15`").
> - **GI-11** From Phase 2 on: EA technical parameter definitions (`parameter_groups` → `ea_parameters`) are owned by `ea_versions`, never by `manual_versions`. A `parameterTable` block references groups of its manual version's single linked EA Version; two manual versions of the same EA Version resolve to identical definitions.
> - **GI-12** From Phase 2 on: any "minimum lot" figure is labelled *Tested Minimum Lot* (developer test data) and is accompanied by the statement that the actual minimum lot comes from the broker's symbol specification. No surface presents an EA-controlled universal minimum lot.

---

## Phase 1 — UI foundation  *(status: ACCEPTED, `docs/PHASE_1.md`, 28 Aug 2026)*

| ID | Criterion | Type | Verify |
|---|---|---|---|
| AC-P1-1 | `npm run lint` passes with zero warnings/errors. | MUST | CI / terminal. |
| AC-P1-2 | `npm run typecheck` passes. | MUST | terminal. |
| AC-P1-3 | `next build` succeeds and generates the expected route set (dashboard, ea-products, manuals, manuals/new, manuals/[id]/edit, manuals/[id]/preview, templates, reviews/technical, reviews/compliance, resources/guide, resources/compliance, settings, login, `/`). | MUST | build output. |
| AC-P1-4 | The main browser workflow completes: dashboard → manuals → filter → wizard (5 steps, validation, error summary) → builder → chapter navigation → inspector → preview. | MUST | Playwright / manual. |
| AC-P1-5 | Browser console shows zero errors/warnings on that workflow. | MUST | devtools. |
| AC-P1-6 | Layout is correct at 375, 768, 1024, and 1440 px; below 1024 the builder chapter list and inspector are drawers and the editor stays primary; tables become card rows below 768. | MUST | responsive check. |
| AC-P1-7 | The builder desktop grid is ~250 / ~642 / ~300 px at 1440 px with exactly one "current chapter" indicator. | MUST | measurement. |
| AC-P1-8 | The screenshot block loads with non-zero natural width and descriptive alt text; the parameter table scrolls inside a contained region on small screens, not the page. | MUST | devtools. |
| AC-P1-9 | Keyboard: skip link is focusable and targets `#main-content`; all controls are labelled; form errors appear inline **and** in a focusable summary. | MUST | keyboard pass. |
| AC-P1-10 | `prefers-reduced-motion: reduce` removes non-essential transition/animation durations. | MUST | emulation. |
| AC-P1-11 | Wizard draft, the created mock manual, and the selected builder chapter persist across reloads (local storage in Phase 1). | MUST | reload test. |
| AC-P1-12 | The preview route's "Ekspor PDF" button is present, disabled, and has a `title` explaining it arrives in Phase 7. (GI-6) | MUST | inspect. |
| AC-P1-13 | The builder inspector shows the note "Skor ini mengukur kelengkapan dokumentasi, bukan persetujuan hukum atau regulator." and no surface shows approval language. (GI-1) | MUST | copy scan. |
| AC-P1-14 | Both EA version and manual version strings are visible and never conflated on the list, builder metadata, and cover. (PRD-VER-001) | MUST | inspect. |
| AC-P1-15 | Icons are Lucide only; no emoji used as an icon anywhere. | MUST | grep + visual. |
| AC-P1-16 | No backend, auth, upload, AI, checklist engine, review transition, publishing, or PDF generation is present (scope boundary held). | MUST | code review. |

---

## Phase 2 — Data and CRUD

**Goal:** Supabase migrations/RLS, auth adapter, organisation + role model, EA/manual/section/block/parameter CRUD, private image uploads, typed server mutations, debounced autosave with conflict handling.

| ID | Criterion | Type | Verify |
|---|---|---|---|
| AC-P2-1 | GI-3, GI-4, GI-5, GI-6, GI-7, GI-10, GI-11, GI-12 hold. | MUST | phase-gate checks. |
| AC-P2-2 | The app fails readiness when a required env var (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APP_URL`) is missing; the health endpoint still responds. (PRD-PLT-003) | MUST | remove a var; hit health + readiness. |
| AC-P2-3 | GI-9: a production bundle analysis shows no occurrence of the secret key; only server code references it. | MUST | bundle scan. |
| AC-P2-4 | Sign-in via Supabase Auth sets a cookie session; wrong credentials show a non-field error and keep the email value; sign-out clears the session and returns to `/login`. (PRD-PLT-001) | MUST | manual + test. |
| AC-P2-5 | A signed-in user with no membership sees an explanatory state, not the workspace. | MUST | test. |
| AC-P2-6 | A developer can create an EA Product; the slug is unique per organisation; a duplicate slug is rejected with an inline error. (PRD-EA-001) | MUST | test. |
| AC-P2-7 | A developer can create an EA Version with semver + platform; `(product, platform, version)` is unique; an MT4 and MT5 `1.0.0` for the same product both succeed; a second MT5 `1.0.0` is rejected. (PRD-EA-003, PRD-EA-004) | MUST | test. |
| AC-P2-8 | EA Version requirements (account type, testing deposit, broker requirements, VPS/DLL/WebRequest, indicator dependencies, optional broker/account volume constraints) persist and reload unchanged. **Symbols and timeframes are not stored here as free text** — they are `ea_version_setups` rows (AC-P2-9). (PRD-EA-005) | MUST | round-trip test. |
| AC-P2-9 | **(Correction 4A)** A developer creates supported configurations `XAUUSD / M15`, `XAUUSD / H1`, and `EURUSD / H1`; all three persist as **separate** `ea_version_setups` rows tied to the EA Version, each with its own `position`. (PRD-EA-009, PRD-SUCC-008) | MUST | DB inspection + reload. |
| AC-P2-9a | **(Correction 4B / GI-10)** After AC-P2-9, no UI screen, rendered Chapter 2/9 output, validation result, or AI fact bundle indicates that `EURUSD / M15` is supported; there is no code path that derives a combination from the distinct symbol and timeframe values. (PRD-EA-006, PRD-EA-009) | MUST | UI assertion + code review + fixture. |
| AC-P2-9b | **(PRD-SUCC-011)** The Supported Configuration editor is functional in Phase 2: add, edit, reorder (drag **and** keyboard), enable/disable, and remove rows all work and persist. `symbol` accepts broker suffixes — `XAUUSD`, `XAUUSD.m`, `EURUSD.pro` all save; `timeframe` is a controlled select limited to `M1,M5,M15,M30,H1,H4,D1,W1,MN1` (free text rejected); `(symbol, timeframe)` duplicates within a version are rejected inline. Phase 3 does **not** introduce this editor. (PRD-EA-009, IMPLEMENTATION_PLAN Phase 2) | MUST | e2e test. |
| AC-P2-9c | **(Correction 4C / GI-12)** In the editor, the version detail, and rendered Chapter 2/9, the per-configuration lot value is labelled *Tested Minimum Lot* / "tested data", and the statement "The actual minimum lot is determined by the broker's symbol specification." is visible. No surface labels it "Minimum Lot" as an EA-controlled universal value; a separately documented broker/account volume constraint does not overwrite or contradict the tested value. (PRD-EA-010) | MUST | UI + output scan. |
| AC-P2-10 | Creating a manual via the wizard (existing-EA path) creates a `manuals` row, a first `manual_versions` row linked to the chosen EA Version, and the full canonical `manual_sections` set from the active template version. (PRD-MAN-004, PRD-MAN-006) | MUST | DB inspection. |
| AC-P2-11 | Creating a manual via the new-EA path creates the EA Product + EA Version **and** the Manual atomically; if EA creation fails, no manual row exists. (PRD-EA-001, transactional) | MUST | fault-injection test. |
| AC-P2-12 | **GI-2 / PRD-MAN-014:** create "Polaris EA"; the builder, inspector metadata, preview, and cover show only Polaris values — never "VMax EA". | MUST | end-to-end assertion. |
| AC-P2-13 | Manual version string is unique per manual; a duplicate is rejected. (PRD-MAN-003) | MUST | test. |
| AC-P2-14 | A required template section cannot be deleted (server rejects; DB constraint/trigger backs it). (PRD-MAN-007) | MUST | test. |
| AC-P2-15 | Block CRUD works for all six types with Zod validation at the write boundary; an invalid payload is rejected with a typed field error, not stored. (PRD-MAN-009) | MUST | test per type. |
| AC-P2-16 | Block positions remain non-negative and unique within a section after a reorder transaction. (PRD-MAN-010) | MUST | reorder test. |
| AC-P2-17 | Deleting a block is recoverable within the editing session (soft-delete). (PRD-MAN-011) | SHOULD | test. |
| AC-P2-18 | Parameter groups and EA parameters persist with all columns (display/technical name, type, default, unit, range, options, description, order effect, mutability, notes, required, position). (PRD-CNT-006) | MUST | round-trip test. |
| AC-P2-18a | **(Correction 4D / GI-11)** `parameter_groups` and `ea_parameters` have a foreign key to `ea_versions`, **not** to `manual_versions`. The migration is written this way from the start — there is no `manual_version_id` on either table. A `parameterTable` block may only reference groups belonging to its manual version's linked EA Version; referencing another EA Version's group is rejected. (PRD-CNT-010) | MUST | schema inspection + test. |
| AC-P2-18b | **(Correction 4E / GI-11)** Given EA Version `1.0.0` with Manual Version `1.0.0` and Manual Version `1.0.1` both linked to it: editing an `ea_parameter` (e.g. changing a default) is immediately reflected in the `parameterTable` output of **both** manual versions; there are no per-manual-version copies of the parameter definitions. (PRD-CNT-010, PRD-SUCC-012) | MUST | propagation test. |
| AC-P2-18c | The optional "copy parameter definitions from version…" action on EA Version create copies groups/parameters from a **prior EA Version** into the **new EA Version** (EA-version-to-EA-version), never from or into a manual version. (PRD-EA-007, PRD-CNT-010) | SHOULD | test. |
| AC-P2-19 | Uploading an image creates a **private** storage object with an organisation-scoped key and an `image_assets` row with MIME, dimensions, caption, alt text, annotations JSON, and `scan_status`; the object is not reachable without a signed URL; a signed URL expires. (PRD-CNT-003, PRD-CNT-004, PRD-SEC-004) | MUST | direct-URL test + expiry test. |
| AC-P2-20 | Debounced autosave persists draft edits within ~1s; a concurrent edit from a second session produces a visible conflict notice and does **not** silently overwrite. (PRD-MAN-012) | MUST | two-session test. |
| AC-P2-21 | **GI-8:** an Organisation A user receives no rows and cannot mutate when targeting Organisation B's products, EA versions, `ea_version_setups`, parameter groups/parameters, manuals, sections, blocks, or images — enforced by both the server action check and RLS (verified with the service path disabled). (PRD-SEC-002) | MUST | role/RLS test. |
| AC-P2-22 | Authorisation is checked by action (`manual:update`, `template:manage`, `member:manage`, …); a role lacking the action is refused server-side with a typed error even if the client sends the request. (PRD-SEC-003) | MUST | test. |
| AC-P2-23 | Server logs use a request id and contain no manual contents, tokens, source code, or signed URLs. (PRD-NFR-007, PRD-SEC-009) | SHOULD | log inspection on an error path. |
| AC-P2-24 | `/dashboard`, `/manuals`, `/ea-products` render from org-scoped real data (no `localStorage` fallback in the shipped path). (PRD-PLT-007) | MUST | inspect + network. |
| AC-P2-25 | Vitest + Testing Library are configured and run in CI; domain logic (slug uniqueness, version uniqueness, permission map, autosave conflict) has unit coverage. (PRD-NFR-009) | MUST | CI. |
| AC-P2-26 | The manual template and checklist template are versioned; each manual version records the template version that instantiated it. (PRD-VER-008) | SHOULD | DB inspection. |
| AC-P2-27 | Open Questions `PRD-OQ-001` (styling), `PRD-OQ-003` (auth route group), `PRD-OQ-012` (template editing depth) have recorded decisions before the work that depends on them lands. (`PRD-OQ-006` supported-setup granularity is already **resolved** — see PRD §25 / `PRD-EA-009`.) | MUST | decision log in the phase report. |

---

## Phase 3 — Document editor

**Goal:** TipTap after a serialization spike; allowlisted custom blocks, image placement, accessible reordering, installation step builder, parameter group/table builder, undo.

| ID | Criterion | Type | Verify |
|---|---|---|---|
| AC-P3-1 | GI-1..GI-7, GI-10, GI-11, GI-12 hold. | MUST | phase-gate. |
| AC-P3-2 | A serialization spike is recorded (round-trips the six block types through TipTap JSON without loss or unsafe HTML). | MUST | spike doc. |
| AC-P3-3 | The editor persists content as structured JSON; a payload containing raw `<script>` or arbitrary HTML is neither stored as HTML nor rendered — the allowlisted renderer drops/escapes it. (PRD-SEC-010) | MUST | injection test. |
| AC-P3-4 | A developer can add, edit inline, move, duplicate, and delete each block type; an unknown/invalid block type is refused. (PRD-MAN-009) | MUST | test per type. |
| AC-P3-5 | Chapter and block reordering work by drag **and** by keyboard/up-down controls; focus stays on the moved item; the final order is contiguous and unique. (PRD-MAN-008, PRD-MAN-010, GI-7) | MUST | keyboard + pointer test. |
| AC-P3-6 | A developer can add a custom (non-required) chapter after the canonical set; required chapters cannot be removed. (PRD-MAN-008, PRD-MAN-007) | MUST | test. |
| AC-P3-7 | The installation step builder produces an ordered `steps` block where each step has a title, instruction, optional menu path, and optional image reference; ≥ 5 steps render in Chapter 4. (PRD-CNT-002) | MUST | test. |
| AC-P3-8 | The parameter builder edits the **EA Version's** groups and parameters (`parameter_groups`/`ea_parameters` on `ea_versions`, per GI-11); a `parameterTable` block references group ids of the linked EA Version and renders the group heading + columns; editing a parameter updates **every** table in **every** manual version referencing that group (no copy drift). Editing requires `ea_version:update`. (PRD-CNT-006, PRD-CNT-007, PRD-CNT-010) | MUST | propagation test across two manual versions. |
| AC-P3-9 | An `image` block references an `image_assets` id; the chapter cannot be marked "complete" while alt text is empty. (PRD-CNT-005) | MUST | test. |
| AC-P3-10 | Phase 3 **improves the presentation** of the Supported Configuration editor (e.g. inline in the builder, drag polish); it is **not** the first phase configurations can be entered — that shipped in Phase 2 (AC-P2-9/9b). Chapter 2 and Chapter 9 render the explicit configuration rows with no free-text ambiguity and no inferred combinations (GI-10). (PRD-EA-009, PRD-SUCC-008) | MUST | render test + confirm P2 entry path unchanged. |
| AC-P3-11 | The risk chapter supports a top-of-chapter `warning` callout; a manual for an EA Version that declares a danger mode without that callout is detectably incomplete (surfaced now, enforced in Phase 5). (PRD-CNT-009) | SHOULD | test. |
| AC-P3-12 | Undo restores the previous editor state for text, block add/remove, and reorder. | MUST | test. |
| AC-P3-13 | `@dnd-kit` is added **only** if native controls cannot meet the reorder UX; the decision is recorded. (PRD dependency policy) | MUST | phase report. |
| AC-P3-14 | Open Question `PRD-OQ-002` (inspector tabs) has a recorded decision. | SHOULD | decision log. |

---

## Phase 4 — AI assistant

**Goal:** `AIProvider`, mock + configured providers, grounded fact bundles, explicit missing-information results, before/after proposals, caption generation, claim scanning. No automatic overwrite.

| ID | Criterion | Type | Verify |
|---|---|---|---|
| AC-P4-1 | GI-1..GI-7, GI-10, GI-11, GI-12 hold. | MUST | phase-gate. |
| AC-P4-2 | The `AIProvider` interface exposes `improveText`, `simplifyText`, `technicalRewrite`, `generateSteps`, `generateCaption`, `detectClaims`; both a mock and a configured provider implement it. (PRD-AI-001) | MUST | test. |
| AC-P4-3 | With no `AI_PROVIDER`/`AI_API_KEY`, the mock provider is used and the UI makes this **unmistakable** (explicit label/badge, not silent). (PRD-AI-002) | MUST | inspect. |
| AC-P4-4 | Each provider request payload contains only `{ selectedText, factBundle, locale, operation }`; a test asserts no other database context (org data, other manuals, tokens) is included. (PRD-AI-003, PRD-SEC-006) | MUST | payload assertion. |
| AC-P4-5 | When the fact bundle is insufficient, the provider returns `ADDITIONAL_INFORMATION_REQUIRED` and the UI prompts the developer for the missing fact instead of generating prose. (PRD-AI-004) | MUST | fixture test. |
| AC-P4-6 | An AI result is shown as a before/after proposal; nothing is written to the block until the developer clicks Accept; Reject discards it. (PRD-AI-004) | MUST | test. |
| AC-P4-7 | Given a fact bundle without a symbol/timeframe/number, no accepted proposal introduces one; an injected fabricated claim in a proposal is caught by `detectClaims`. (PRD-AI-005) | MUST | fixture test. |
| AC-P4-8 | `detectClaims` returns findings for each prohibited category in `docs/COMPLIANCE_REQUIREMENTS.md` §4 on a crafted manual; findings are advisory and never auto-edit. (PRD-AI-006, PRD-COMP-004) | MUST | fixture test. |
| AC-P4-9 | Every proposal and its Accept/Reject outcome is recorded in `ai_revisions` (actor, operation, input hash, grounded fact ids, proposed output, provider metadata, decision timestamp); no raw credential is stored. (PRD-AI-007) | MUST | DB inspection. |
| AC-P4-10 | AI jobs are idempotent: re-issuing the same `GroundedRequest` does not create duplicate pending revisions or double-write. (PRD-OUT-006) | SHOULD | test. |
| AC-P4-11 | The builder inspector's AI section is now active (was "available in Phase 4"); no other phase's disabled affordances were enabled by mistake. | MUST | inspect. |

---

## Phase 5 — Validation and compliance

**Goal:** versioned checklist templates/results, completion scoring, missing field/parameter detection, risky-phrase review, EA/manual version mismatch detection. Wording stays "ready for review".

| ID | Criterion | Type | Verify |
|---|---|---|---|
| AC-P5-1 | GI-1 (now also for computed checklist output), GI-2..GI-7, GI-10, GI-11, GI-12 hold. | MUST | phase-gate. |
| AC-P5-2 | A versioned checklist template produces exactly one `checklist_result` per item per manual version; each result's state is one of `PASS`, `WARNING`, `MISSING`, `NOT_APPLICABLE` and carries evidence, an evaluator, and a reviewed timestamp. (PRD-VAL-002, PRD-COMP-006) | MUST | DB inspection. |
| AC-P5-3 | The completion score = required, in-scope items in `PASS` ÷ required, in-scope items; `NOT_APPLICABLE` is excluded from both; the score updates when content changes. (PRD-VAL-001) | MUST | fixture test. |
| AC-P5-4 | Each of these checks fires on a crafted failing fixture and clears on a passing one: missing required chapter, missing EA input in parameter tables (`CHK-PARAM-COMPLETE`), default mismatch (`CHK-PARAM-DEFAULT-MATCH`), missing Pasal 5(5)d disclaimer sentence (`CHK-DISCLAIMER-5-5-D`), missing 24/7 contact (`CHK-KONTAK`), points/pips undefined (`CHK-UNITS-DEFINED`), EA/manual version mismatch (`CHK-VERSI-MATCH`), unconditioned performance figure (`CHK-PERFORMANCE-KONDISI`), missing danger-mode warning (`CHK-DANGER-MODE-WARN`). (PRD-VAL-003, PRD-COMP-002/003/008, PRD-VER-003, PRD-CNT-008) | MUST | fixture matrix. |
| AC-P5-5 | The claim aggregate check (`CHK-NO-PROHIBITED-CLAIMS`) turns `WARNING` when any §4 category is present and `PASS` when clean; publish-blocking categories are marked as such. (PRD-COMP-004) | MUST | fixture test. |
| AC-P5-6 | A manual **cannot** be submitted for technical review while any required, in-scope chapter has a `MISSING` result; a `WARNING` does **not** block submission. (PRD-VAL-005, PRD-COMP-006) | MUST | test both directions. |
| AC-P5-7 | Scope rules set Bappebti-only items to `NOT_APPLICABLE` for an EA marked out of Indonesian PBK scope (no false `MISSING`). (PRD-COMP-005, `PRD-OQ-011`) | MUST | scoped fixture. |
| AC-P5-8 | `NOT_APPLICABLE` set by a reviewer requires a recorded reason and is audited; a developer cannot self-set it to bypass a check. (PRD-COMP-006) | MUST | test. |
| AC-P5-9 | **GI-1 for computed output:** nowhere does a score or checklist state render as "Approved"/"Bappebti Approved"/"Certified"/"Compliant"; only "documentation checklist completed" / "ready for compliance review". A string scan of rendered output confirms it. (PRD-VAL-004, PRD-COMP-001) | MUST | output scan. |
| AC-P5-10 | The checklist panel (documentation readiness) and any review decision control are visually and structurally separate — not merged into one badge. (PRD-COMP-007) | MUST | inspect. |
| AC-P5-11 | Each `checklist_result` set records the checklist template version used. (PRD-VER-008) | MUST | DB inspection. |
| AC-P5-12 | Evidence stored with a result never contains credentials, signed URLs, or source code. (PRD-SEC-009) | MUST | inspection. |
| AC-P5-13 | Open Questions `PRD-OQ-004` (item set), `PRD-OQ-005` (required chapters), `PRD-OQ-009` (scan gate), `PRD-OQ-011` (non-Bappebti suppression) have recorded decisions. | MUST | decision log. |

---

## Phase 6 — Reviews and versioning

**Goal:** reviewer assignment, block/chapter/general comments, approval/request-changes commands, audit history, version cloning, published-version immutability.

| ID | Criterion | Type | Verify |
|---|---|---|---|
| AC-P6-1 | GI-1..GI-8, GI-10, GI-11, GI-12 hold. | MUST | phase-gate. |
| AC-P6-2 | Workflow transitions are server-side commands with preconditions; a forged client transition request is rejected. The state machine matches: `DRAFT→TECHNICAL_REVIEW→COMPLIANCE_REVIEW→APPROVED→PUBLISHED`, `*_REVIEW→CHANGES_REQUESTED→DRAFT`, `PUBLISHED→ARCHIVED`. (PRD-REV-001, PRD-REV-002) | MUST | test each edge + a forged request. |
| AC-P6-3 | An admin assigns a technical reviewer and a compliance reviewer per manual version; the `/reviews/technical` and `/reviews/compliance` queues show only versions assigned to the current user (admin sees all), org-scoped. (PRD-REV-003, PRD-REV-009) | MUST | test. |
| AC-P6-4 | Reviewers add comments anchored to a section, a block, or the manual; comments have resolved/unresolved state that persists across review rounds. (PRD-REV-004, PRD-REV-008) | MUST | test. |
| AC-P6-5 | A technical **approve** moves the version to `COMPLIANCE_REVIEW`; **request changes** moves it to `CHANGES_REQUESTED` with a required summary. A compliance **approve** moves it to `APPROVED`. Compliance is unreachable without a recorded technical approval. (PRD-REV-005) | MUST | test. |
| AC-P6-6 | **PRD-SUCC-006:** a reviewer who authored or edited the manual version cannot approve it — the attempt is rejected with a typed error, not silently skipped. (PRD-REV-006) | MUST | test. |
| AC-P6-7 | Only one active technical decision and one active compliance decision exist per review round. (PRD-REV-007) | SHOULD | concurrency test. |
| AC-P6-8 | A resubmission after `CHANGES_REQUESTED` re-enters `TECHNICAL_REVIEW` (never straight to compliance); prior comment threads remain visible. (PRD-REV-008) | MUST | test. |
| AC-P6-9 | Publishing an `APPROVED` version creates a `published_snapshots` row (render JSON, content hash, public slug, public version, published timestamp), sets the version to `PUBLISHED`, and writes an `audit_events` row — all in one DB transaction; a fault mid-transaction leaves no partial state. (PRD-OUT-002, PRD-NFR-003) | MUST | fault-injection test. |
| AC-P6-10 | **PRD-SUCC-004:** an update or delete against a `PUBLISHED` manual version (other than controlled archive metadata) is rejected at the database; re-rendering the snapshot reproduces the stored content hash byte-stably. (PRD-OUT-003, PRD-VER-004) | MUST | trigger test + hash recompute. |
| AC-P6-11 | "Create manual for new version" clones the latest manual version's **sections, blocks, checklist scaffold, and changelog** into a fresh `DRAFT` linked to the chosen EA Version, with a new unique manual version string; the published version is unchanged. It does **not** clone `parameter_groups`/`ea_parameters` or `ea_version_setups` (those stay owned by the EA Version); the clone's `parameterTable` blocks reference the linked EA Version's groups. (PRD-MAN-013, PRD-CNT-010, GI-11) | MUST | test. |
| AC-P6-12 | Publish is blocked while any required, in-scope `MISSING` remains or a publish-blocking claim `WARNING` is unresolved; the block lists the reasons. (PRD-MOUT-008) | MUST | test. |
| AC-P6-13 | Every privileged action (assignment, decision, publish, archive, template change, member change) writes exactly one append-only `audit_events` row with actor, action, entity type/id, safe metadata, timestamp. (PRD-SEC-007) | MUST | DB inspection. |
| AC-P6-14 | A feature-change changelog entry surfaces the Perba 12/2022 Pasal 8 obligation reminder (client approval + report to Kepala Bappebti); the tool does not perform any filing. (PRD-VER-007) | SHOULD | inspect (per `PRD-OQ-010` decision). |
| AC-P6-15 | `/manuals/[manualId]/reviews` shows the decision + comment history for the version. (PRD-REV-009) | MUST | inspect. |
| AC-P6-16 | Open Questions `PRD-OQ-007` (publishing authority), `PRD-OQ-010` (changelog ↔ Pasal 8 depth) have recorded decisions. | MUST | decision log. |

---

## Phase 7 — Output

**Goal:** finalise the shared renderer, public published route, TOC/search/version navigation, print CSS, Playwright A4 export with visual-regression fixtures.

| ID | Criterion | Type | Verify |
|---|---|---|---|
| AC-P7-1 | GI-1..GI-8, GI-10, GI-11, GI-12 hold. | MUST | phase-gate. |
| AC-P7-2 | `/manual/[eaSlug]/[version]` serves only a `PUBLISHED` snapshot; an unknown or non-published slug/version returns 404; the route has no code path to draft or private tables. (PRD-OUT-004, PRD-SEC-005) | MUST | route + code review. |
| AC-P7-3 | The public manual shows a table of contents, working in-page search, and a version switcher listing all published versions; older version URLs still resolve. (PRD-POUT-002, PRD-VER-005) | MUST | test. |
| AC-P7-4 | **PRD-SUCC-005:** for a given version, the web render and the PDF render contain the same chapters, blocks, and parameter values — verified by a visual-regression fixture within tolerance and a content-model diff that is empty. (PRD-OUT-001, PRD-POUT-001) | MUST | visual regression + diff. |
| AC-P7-5 | The A4 PDF repeats long-table headers across page breaks, honours per-block page-break preferences, keeps captions with their images, and waits for fonts/images before export. (PRD-POUT-003) | MUST | PDF fixture inspection. |
| AC-P7-6 | PDF generation runs server-side via Playwright against a **signed** print route; the job is idempotent (re-run → identical output) and shows a visible retry state on failure. (PRD-OUT-005, PRD-POUT-005) | MUST | test. |
| AC-P7-7 | The generated PDF file name matches `Manual_<EAName>_v<X.Y.Z>.pdf`. (PRD-POUT-004) | SHOULD | inspect. |
| AC-P7-8 | Published images are served from a publish-safe path or a controlled signed URL; the public page issues no request for a private draft object. (PRD-CNT-004, PRD-SEC-004) | MUST | network inspection. |
| AC-P7-9 | The preview route's "Export PDF" is now enabled and triggers the job with visible progress; the workspace preview and the public route use the same renderer. (PRD-OUT-007) | MUST | test. |
| AC-P7-10 | GI-1 for output: the public web page and the PDF contain no "Approved"/"Bappebti Approved"/"Certified"/"Compliant" label anywhere (headings, footers, watermarks). (PRD-COMP-001) | MUST | string scan of both outputs. |

---

## Phase 8 — Quality

**Goal:** accessibility, responsive, security and performance audits; comprehensive empty/loading/error states; TypeScript cleanup; dependency review; end-to-end coverage of permission and publishing boundaries.

| ID | Criterion | Type | Verify |
|---|---|---|---|
| AC-P8-1 | GI-1..GI-12 hold across the whole app. | MUST | full pass. |
| AC-P8-2 | Every route has a defined loading state, an empty state with a clear next action, and an error state with retry; a matrix documents each. (PRD-NFR-002, general) | MUST | route matrix. |
| AC-P8-3 | An accessibility audit (automated + manual) shows WCAG 2.1 AA conformance: contrast ≥ 4.5:1, visible focus, 44px targets, icon+text status, keyboard alternatives for every drag, `prefers-reduced-motion`, correct landmarks and headings, labelled controls, inline + summary form errors. (PRD-NFR-004) | MUST | audit report. |
| AC-P8-4 | A responsive audit passes at 375 / 768 / 1024 / 1440 px on every route; no document-level horizontal scroll; the builder centre column never nests horizontal scroll. (PRD-NFR-005) | MUST | audit report. |
| AC-P8-5 | **PRD-SUCC-009:** a role/RLS test suite proves an Organisation A member cannot list, read, or mutate any Organisation B entity across every table and every action, with the service path disabled. (PRD-SEC-002, PRD-SEC-003) | MUST | test suite. |
| AC-P8-6 | A security review confirms: secret key absent from the bundle (GI-9), public routes read only published snapshots, AI payloads carry only the grounded bundle, private buckets reject unsigned access, `audit_events` append-only, logs scrubbed. (PRD-SEC-001/005/006/007/009) | MUST | review report. |
| AC-P8-7 | A performance pass: list/dashboard routes render server-side; builder chapter switch and block edit feel immediate; autosave debounce ≤ ~1s; large parameter tables scroll within a contained region. (PRD-NFR-002) | SHOULD | measurements. |
| AC-P8-8 | End-to-end tests cover the full permission and publishing boundary: developer cannot review, reviewer cannot edit, no self-approval, non-admin cannot publish (per `PRD-OQ-007` decision), published immutability, cross-org isolation. | MUST | e2e suite. |
| AC-P8-9 | `tsc --noEmit` is clean with no suppressions added since Phase 2; dependency review shows only the phase-approved packages and a reproducible `npm ci`. (PRD-NFR-001, PRD-NFR-010) | MUST | CI + review. |
| AC-P8-10 | All remaining Open Questions from `docs/PRD.md` §25 are closed or explicitly deferred with an owner and a date. | MUST | decision log. |

---

## Appendix — how to run a phase gate

For every phase (per `docs/IMPLEMENTATION_PLAN.md` "Phase gate policy"):

1. `npm run dev` — app boots, main workflow usable.
2. `npm run lint` — zero errors/warnings.
3. `npm run typecheck` — clean.
4. `next build` — succeeds.
5. Playwright: the phase's main workflow passes.
6. Browser console: zero errors/warnings on that workflow.
7. Responsive pass at 375 / 768 / 1024 / 1440 where UI changed.
8. Record results, decisions on that phase's Open Questions, and any deferred `SHOULD` items in `docs/PHASE_<n>.md`.
9. Obtain explicit product-owner approval before starting the next phase.
