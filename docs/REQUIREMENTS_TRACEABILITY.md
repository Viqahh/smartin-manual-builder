# Requirements Traceability Matrix — Smartin Manual Builder

> Maps every requirement in `docs/PRD.md` to its source, owner, UI surface, data entity, delivery phase, current status, and how it will be verified. Use it to check whether a requirement was actually implemented.
>
> **Status values:** `Planned` (in a future phase), `Mocked` (present in Phase 1 UI only, no real behaviour), `Partial` (some real behaviour), `Done` (implemented + verified per its acceptance evidence), `Blocked` (waiting on an Open Question or external process).
> **Priority:** `P0` must-have for the MVP (through Phase 6), `P1` important, `P2` nice-to-have / later.
> **Phase:** the phase where the requirement becomes real (0–8 per `docs/IMPLEMENTATION_PLAN.md`).
> **Sources:** `ARCH` = `docs/ARCHITECTURE.md`, `DM` = `docs/DATA_MODEL.md`, `RC` = `docs/ROUTES_AND_COMPONENTS.md`, `DEP` = `docs/DEPENDENCIES.md`, `IP` = `docs/IMPLEMENTATION_PLAN.md`, `P1R` = `docs/PHASE_1.md`, `DS` = `design-system/…/MASTER.md`, `CG` = `Panduan_Manual_Book_EA_Kontributor.pdf`, `PBK` = Perba Bappebti 12/2022 (via CG), `SAS` = `User Manual SAS SMARTBOT 2024 update.pdf`, `CR` = `docs/CONTENT_REQUIREMENTS.md`, `COMP` = `docs/COMPLIANCE_REQUIREMENTS.md`.

---

## 1. EA products and versions

| Requirement ID | Requirement | Source | Priority | User | UI / Page | Data Entity | Phase | Status | Acceptance Evidence |
|---|---|---|---|---|---|---|---|---|---|
| PRD-EA-001 | Create EA Product (org, owner, name, unique slug/org, description) | ARCH, DM | P0 | Developer, Admin | `/ea-products`, wizard step 1 (new) | `ea_products` | 2 | Mocked | Create a product; row appears; duplicate slug rejected inline (AC-P2). |
| PRD-EA-002 | Archive EA Product (soft, timestamped), hidden from default lists | DM | P1 | Admin | `/ea-products`, `/ea-products/[productId]` | `ea_products.archived_at` | 2 | Planned | Archive; product leaves default list, still reachable by id. |
| PRD-EA-003 | EA Version (semver, platform MT4/MT5, release date, requirements, support) | DM, CG §4.1 | P0 | Developer, Admin | `/ea-products/[productId]` | `ea_versions` | 2 | Mocked | Create a version; fields persisted; shown under product. |
| PRD-EA-004 | EA Version unique per product **and platform** | DM | P0 | Developer, Admin | `/ea-products/[productId]` | `ea_versions` unique(product, platform, version) | 2 | Planned | MT4 1.0.0 and MT5 1.0.0 coexist; duplicate (same platform) rejected. |
| PRD-EA-005 | Version requirements: symbols, timeframes, account type, min lot, testing deposit, broker reqs, VPS/DLL/WebRequest, indicator deps | CG §4.3, wizard step 3 | P0 | Developer | wizard step 3, `/ea-products/[productId]`, builder Ch.2 | `ea_versions.requirements` (JSON) | 2 | Mocked | All fields captured + rendered into Ch.2. |
| PRD-EA-006 | Multiple explicit supported symbol/timeframe **setups** per version | CG §4.3/§4.10, SAS | P0 | Developer | `/ea-products/[productId]`, builder Ch.2/Ch.9 | setup records (child of `ea_versions`) | 2 (data) / 3 (UI) | Planned | Version with XAUUSD@M15 + XAUUSD@H1 renders both rows (AC-P3, PRD-SUCC-008). |
| PRD-EA-007 | New EA Version does not auto-fill version-specific data unless explicitly copied | DM | P1 | Developer | `/ea-products/[productId]` | `ea_versions`, `ea_parameters` | 2 | Planned | New version starts empty; "copy from vX" is an explicit action. |
| PRD-EA-008 | `/ea-products` list + `/ea-products/[productId]` detail | RC | P0 | Developer, Admin | `/ea-products`, `/ea-products/[productId]` | `ea_products`, `ea_versions` | 1 (list mock) / 2 (real + detail) | Mocked (list) | List shows org products; detail route exists and shows versions. |

---

## 2. Manuals and manual versions

| Requirement ID | Requirement | Source | Priority | User | UI / Page | Data Entity | Phase | Status | Acceptance Evidence |
|---|---|---|---|---|---|---|---|---|---|
| PRD-MAN-001 | Manual = stable lineage per EA Product (template origin, locale) | DM | P0 | Developer | `/manuals`, wizard | `manuals` | 2 | Mocked | Manual row created with template + locale recorded. |
| PRD-MAN-002 | Manual Version per EA Version (own version string, status, completion, timestamps) | DM, ARCH | P0 | Developer | `/manuals`, builder metadata | `manual_versions` | 2 | Mocked | Version links to one `ea_versions`; status + timestamps persisted. |
| PRD-MAN-003 | Manual version string unique per Manual | DM | P0 | Developer | wizard, clone flow | `manual_versions` unique(manual, version) | 2 | Planned | Duplicate manual version string rejected. |
| PRD-MAN-004 | Create-manual wizard captures reusable EA facts + creates Manual + first Version from template | RC, P1R | P0 | Developer, Admin | `/manuals/new` | `manuals`, `manual_versions`, `manual_sections` | 1 (mock) / 2 (real) | Mocked | 5-step wizard; on submit real records created (AC-P2). |
| PRD-MAN-005 | Wizard "use existing" / "create new" paths; no silent data loss on back/cancel | RC, P1R | P0 | Developer | `/manuals/new` | — | 1 (mock) / 2 | Mocked | Back/cancel keep state; cancel confirms; draft restored on return. |
| PRD-MAN-006 | Manual Version instantiates canonical 18-chapter structure (key, title, required, custom, position, completion) | CR, DM | P0 | Developer | builder LEFT panel | `manual_sections` | 1 (mock chapters) / 2 (persisted) | Mocked | 18 sections created with correct keys + required flags per CR. |
| PRD-MAN-007 | Required template sections undeletable; only app SQL functions clone/instantiate | DM | P0 | — | builder LEFT panel | `manual_sections`, SQL functions | 2 | Planned | Attempt to delete a required section fails (DB + server). |
| PRD-MAN-008 | Add custom (non-required) chapter; reorder with drag **and** keyboard/buttons | RC, ARCH, DS | P1 | Developer | builder LEFT panel | `manual_sections.custom`, `.position` | 3 | Mocked (disabled btn) | Add custom chapter; reorder via keyboard works; positions stay unique. |
| PRD-MAN-009 | Ordered blocks with discriminated type + validated JSON: text, steps, image, callout, parameterTable, faq | DM, CR | P0 | Developer | builder CENTER | `manual_blocks` | 1 (mock render) / 3 (editable) | Mocked | Each block type renders; Phase 3: editable with Zod validation at write. |
| PRD-MAN-010 | Block positions non-negative + unique per chapter after reorder txn | DM | P0 | — | builder CENTER | `manual_blocks.position` | 2 (constraint) / 3 (UI) | Planned | Reorder transaction leaves a valid contiguous ordering. |
| PRD-MAN-011 | Block delete is recoverable (soft-delete metadata) | DM | P1 | Developer | builder CENTER | `manual_blocks.deleted_at` | 2 / 3 | Planned | Delete a block; recover it within the session/history. |
| PRD-MAN-012 | Debounced autosave with conflict handling (no silent overwrite) | IP, ARCH | P0 | Developer | builder topbar `save-state` | `manual_versions`, version token | 2 | Mocked (static "Saved") | Concurrent edit surfaces a conflict notice, not an overwrite (AC-P2). |
| PRD-MAN-013 | "Create manual for new version" clones to a fresh DRAFT; never edits the published one | ARCH, IP | P0 | Developer, Admin | `/manuals`, builder | `manual_versions` (clone) | 6 | Planned | Published version unchanged; new DRAFT created + editable (AC-P6). |
| PRD-MAN-014 | Builder renders the manual for the route param; "Polaris EA" never shows "VMax EA" data | ARCH, P1R gap | P0 | Developer | `/manuals/[manualId]/edit`, preview | `manual_versions` by id | 2 | Mocked (always VMax) | Create Polaris; builder/inspector/preview/cover show only Polaris (AC-P2, PRD-SUCC-007). |

---

## 3. Structured content: setups, installation, screenshots, parameters, risk

| Requirement ID | Requirement | Source | Priority | User | UI / Page | Data Entity | Phase | Status | Acceptance Evidence |
|---|---|---|---|---|---|---|---|---|---|
| PRD-CNT-001 | Supported setups edited as `{symbol, timeframe, note}` list; rendered in Ch.2/Ch.9 | CR ch.2/9 | P0 | Developer | builder Ch.2/Ch.9 | setup records | 2 (data) / 3 (UI) | Planned | Add 2 setups; both render as discrete rows. |
| PRD-CNT-002 | Installation authored as ordered step list (title, instruction, menu path, image ref) | CG §4.5, CR ch.4 | P0 | Developer | builder Ch.4 | `manual_blocks` (steps) | 1 (mock) / 3 (builder) | Mocked | ≥ 5 ordered steps with menu paths; reorder works (AC-P3). |
| PRD-CNT-003 | Upload image to private storage → `image_assets` (mime, dims, caption, alt, annotations, scan status) | ARCH, DM | P0 | Developer | builder CENTER (image block) | `image_assets` | 2 | Planned | Upload; object is private; record has metadata + `scan_status` (AC-P2). |
| PRD-CNT-004 | Images private while unpublished; signed URLs; publish-safe path on publish | ARCH, DM | P0 | Developer, Public | builder, public route | `image_assets`, storage | 2 (private) / 7 (publish path) | Planned | Unauth direct URL fails; published web shows image via safe path (AC-P2, AC-P7). |
| PRD-CNT-005 | `image` block references `image_assets` id + optional caption; alt text required for completion | DM, CR appendix A | P0 | Developer | builder CENTER, inspector | `manual_blocks` (image) | 3 (block) / 5 (validation) | Mocked | Chapter with an image without alt text cannot be marked complete (AC-P5). |
| PRD-CNT-006 | Parameter groups (ordered) + EA parameters (display/technical name, type, default, unit, range, options, description, order effect, mutability, notes, required, position) | CG §4.8, SAS | P0 | Developer | builder Ch.7 | `parameter_groups`, `ea_parameters` | 2 (data) / 3 (builder) | Mocked | All columns captured; grouped; persisted. |
| PRD-CNT-007 | `parameterTable` block references group id(s); renders heading + columns (Param, Type, Default, Safe range, Effect) | CG §4.8, P1R | P0 | Developer, Public | builder Ch.7, preview, public | `manual_blocks` (parameterTable) | 1 (mock) / 3 (block) | Mocked | Table renders from referenced group; edits to a parameter propagate. |
| PRD-CNT-008 | Units explicit (points vs pips, `_Point`); validation flags mixed usage without a definition | CG §4.8 | P1 | Developer | builder Ch.7, inspector | check `CHK-UNITS-DEFINED` | 5 | Planned | A manual using "200" without a points/pips definition gets a WARNING. |
| PRD-CNT-009 | Risk chapter: verbal lot formula, floor/step/below-min behaviour; danger modes get a top warning callout | CG §4.9, CR ch.8 | P0 | Developer | builder Ch.8 | `manual_blocks` (text, callout) | 3 (authoring) / 5 (validation) | Mocked | Danger-mode EA without a top warning callout gets `MISSING` on `CHK-DANGER-MODE-WARN`. |

---

## 4. Validation and checklist

| Requirement ID | Requirement | Source | Priority | User | UI / Page | Data Entity | Phase | Status | Acceptance Evidence |
|---|---|---|---|---|---|---|---|---|---|
| PRD-VAL-001 | Completion score = required chapters with sufficient content; per-chapter state | IP, RC, P1R | P0 | Developer | builder inspector, `/manuals` | derived from `manual_sections`, `checklist_results` | 1 (mock) / 5 (engine) | Mocked (82%) | Score changes as required chapters gain content (AC-P5). |
| PRD-VAL-002 | Versioned checklist template → one `checklist_result` per item per manual version, state PASS/WARNING/MISSING/NOT_APPLICABLE + evidence + evaluator + timestamp | DM, COMP | P0 | Developer, Compliance | builder inspector, `/reviews/compliance` | `checklist_items`, `checklist_results` | 5 | Mocked ("/ 26") | Each item has a state + evidence link; template version recorded (AC-P5). |
| PRD-VAL-003 | Automated checks: missing fields, missing parameters, version mismatch, missing disclaimer sentence, missing 24/7 contact, risky phrases | IP, COMP | P0 | Developer | builder inspector | `checklist_results` | 5 | Planned | Each named check fires on a crafted failing fixture (AC-P5). |
| PRD-VAL-004 | All wording "ready for review" / "documentation checklist completed"; never "approved"/"Bappebti approved" | DS, COMP §0 | P0 | All | every surface incl. PDF/public | copy | 1 (copy) / 5 (engine) / 7 (output) | Done (Phase 1 copy) | Grep of UI/PDF/public strings finds no "Approved"/"Bappebti Approved" (AC-P1/P5/P7). |
| PRD-VAL-005 | Cannot submit for technical review while any required, in-scope chapter is `MISSING`; `WARNING` does not block | COMP §10 | P0 | Developer | builder "Kirim review" | server precondition | 5 / 6 | Mocked (btn disabled) | Submit blocked with a listed reason; allowed once `MISSING`→`PASS`/`WARNING` (AC-P6). |

---

## 5. Reviews and workflow

| Requirement ID | Requirement | Source | Priority | User | UI / Page | Data Entity | Phase | Status | Acceptance Evidence |
|---|---|---|---|---|---|---|---|---|---|
| PRD-REV-001 | States DRAFT→TECHNICAL_REVIEW→COMPLIANCE_REVIEW→APPROVED→PUBLISHED; CHANGES_REQUESTED from either review → DRAFT; PUBLISHED→ARCHIVED | ARCH | P0 | All | builder topbar, review pages | `manual_versions.status` | 6 | Mocked (enum only) | Each transition is a server command with preconditions (AC-P6). |
| PRD-REV-002 | Transitions are server-side commands; client never decides authorization | ARCH | P0 | — | server | — | 6 | Planned | Forged client transition request is rejected server-side. |
| PRD-REV-003 | Admin assigns a technical + a compliance reviewer per manual version | IP | P0 | Admin | `/settings`, review pages | `reviews` / assignment | 6 | Planned | Assignment persisted; queues scoped to assignee. |
| PRD-REV-004 | Comments target section / block / manual; resolved metadata | ARCH, IP | P0 | Reviewer | `/manuals/[manualId]/reviews`, builder read mode | `review_comments` | 6 | Planned | Comment anchored to a block; resolve/unresolve tracked. |
| PRD-REV-005 | Technical decision approve→compliance / request changes; compliance decision approve→APPROVED / request changes; with summary | ARCH, IP | P0 | Reviewer | review pages | `reviews.decision` | 6 | Mocked (queues) | Decisions move status + record a summary (AC-P6). |
| PRD-REV-006 | No self-approval (actor ≠ author/editor) | ARCH | P0 | Reviewer | review pages | server check on `reviews` | 6 | Planned | Author's approve attempt rejected with a typed error (AC-P6, PRD-SUCC-006). |
| PRD-REV-007 | One active technical + one active compliance decision per round | DM | P1 | — | server | `reviews` constraint | 6 | Planned | Second concurrent decision in a round is rejected. |
| PRD-REV-008 | After CHANGES_REQUESTED, revise in DRAFT + resubmit; threads persist across rounds | IP | P0 | Developer | builder, review pages | `review_comments` | 6 | Planned | Resubmit re-enters technical review; old threads still visible. |
| PRD-REV-009 | `/reviews/technical`, `/reviews/compliance` role-scoped queues; `/manuals/[manualId]/reviews` history | RC | P0 | Reviewer | review pages | `reviews`, `review_comments` | 1 (mock) / 6 (real) | Mocked | Queues show only in-scope versions; history route lists decisions + comments. |

---

## 6. AI assistant

| Requirement ID | Requirement | Source | Priority | User | UI / Page | Data Entity | Phase | Status | Acceptance Evidence |
|---|---|---|---|---|---|---|---|---|---|
| PRD-AI-001 | `AIProvider`: improveText, simplifyText, technicalRewrite, generateSteps, generateCaption, detectClaims | ARCH | P0 | Developer | builder inspector | — (adapter) | 4 | Mocked (disabled) | Each method callable via mock + configured provider. |
| PRD-AI-002 | Mock provider default when no credential; configured only with `AI_PROVIDER`+`AI_API_KEY`; mock is unmistakable in UI | ARCH, DEP | P0 | Developer | builder inspector | env | 4 | Mocked | With no env, UI clearly shows the mock provider (AC-P4). |
| PRD-AI-003 | Every request is a `GroundedRequest` (selected text + permitted fact bundle + locale + operation); no raw DB context | ARCH | P0 | — | server | — | 4 | Planned | Provider payload contains only the bundle; test asserts no extra data. |
| PRD-AI-004 | Provider returns `RevisionProposal` or `ADDITIONAL_INFORMATION_REQUIRED`; UI never auto-applies; accept/reject a diff | ARCH | P0 | Developer | builder inspector | `ai_revisions` | 4 | Planned | Proposal shown as before/after; no write until Accept (AC-P4). |
| PRD-AI-005 | AI must not introduce facts/numbers/symbols/timeframes/performance absent from the bundle | ARCH, PBK §2.4 | P0 | — | server + claim scanner | `ai_revisions`, `checklist_results` | 4 / 5 | Planned | Fixture: bundle lacks a symbol; proposal never adds one; scanner catches an injected claim (AC-P4). |
| PRD-AI-006 | `detectClaims` → `ClaimFinding[]` for profit/win-rate/risk-free/profit-sharing/on-behalf/MLM/dev-margin | ARCH, COMP §4 | P0 | Developer, Compliance | builder inspector, `/reviews/compliance` | `checklist_results` (claim items) | 4 / 5 | Planned | Each category flagged on a crafted manual; advisory only, no auto-edit. |
| PRD-AI-007 | Every accepted/rejected AI revision recorded in `ai_revisions` (no raw credentials) | DM | P1 | — | — | `ai_revisions` | 4 | Planned | Row written per proposal with operation, input hash, fact ids, decision timestamp. |

---

## 7. Output: web and PDF

| Requirement ID | Requirement | Source | Priority | User | UI / Page | Data Entity | Phase | Status | Acceptance Evidence |
|---|---|---|---|---|---|---|---|---|---|
| PRD-OUT-001 | One `ManualViewModel` feeds editor preview, public web, print CSS, PDF; no second PDF model | ARCH, P1R | P0 | All | builder canvas, preview, public, PDF | view model query | 1 (renderer) / 7 (final) | Partial (shared renderer in P1) | Web and PDF of a version show identical chapters/blocks/values (AC-P7, PRD-SUCC-005). |
| PRD-OUT-002 | Publish creates immutable `published_snapshots` (render JSON, content hash, slug, version, timestamp) in a DB txn with the status change + audit | DM, ARCH | P0 | Admin | publish action | `published_snapshots`, `audit_events` | 6 | Planned | Snapshot + status + audit committed together; failure rolls back (AC-P6). |
| PRD-OUT-003 | `PUBLISHED` versions rejected by update/delete triggers except archive metadata | DM | P0 | — | server / DB | triggers | 6 | Planned | Update to a published version fails at the DB (AC-P6, PRD-SUCC-004). |
| PRD-OUT-004 | `/manual/[eaSlug]/[version]` serves only PUBLISHED, with TOC, in-page search, version nav | RC, IP | P0 | Public | `/manual/[eaSlug]/[version]` | `published_snapshots` | 7 | Planned | Public URL renders the snapshot; non-published slug → 404 (AC-P7). |
| PRD-OUT-005 | Server-side Playwright A4 export: repeated table headers, block page-break prefs, caption+image grouping | ARCH, DEP | P0 | Public | preview / public "Download PDF" | job | 7 | Planned | PDF fixture matches the web render within tolerance (AC-P7). |
| PRD-OUT-006 | PDF/AI operations are idempotent jobs with visible retry states | ARCH | P1 | Developer | preview, inspector | job records | 7 (PDF) / 4 (AI) | Planned | Re-running a job produces the same output; UI shows retry state. |
| PRD-OUT-007 | Preview route uses the same renderer; PDF disabled with an explanation until Phase 7 | RC, P1R | P0 | Developer | `/manuals/[manualId]/preview` | view model | 1 (mock) / 7 (enabled) | Done (disabled + reason in P1) | Export button present, disabled, `title` explains Phase 7 (AC-P1). |

---

## 8. Platform, auth, templates, settings

| Requirement ID | Requirement | Source | Priority | User | UI / Page | Data Entity | Phase | Status | Acceptance Evidence |
|---|---|---|---|---|---|---|---|---|---|
| PRD-PLT-001 | Supabase Auth cookie SSR sessions; `/login` real sign-in replaces the mock role switcher | DEP, ARCH | P0 | All | `/login` | `users` (auth) | 2 | Mocked | Sign in sets a session cookie; wrong credentials show an error (AC-P2). |
| PRD-PLT-002 | Organisation + membership + role model backs every authz decision | ARCH, DM | P0 | All | server, `/settings` | `organizations`, `memberships` | 2 | Mocked | Role resolved from membership; nav + actions filtered by permitted action. |
| PRD-PLT-003 | Env vars validated at startup; missing required config fails readiness | DEP | P0 | — | health/readiness | `lib/env.ts` | 2 | Planned | App refuses readiness without `SUPABASE_*`; health still reports (AC-P2). |
| PRD-PLT-004 | Admin manages versioned manual + checklist templates at `/templates` | RC, DM | P0 | Admin | `/templates` | `manuals` templates, `checklist_items` | 2 (CRUD) / 5 (eval) | Mocked | Edit a template → new version; new manuals use the active version (AC-P2/P5). |
| PRD-PLT-005 | `/settings` shows real profile + org settings | RC | P1 | All, Admin | `/settings` | `users`, `memberships`, `organizations` | 2 | Mocked | Profile edit persists; membership management is Admin-only + audited. |
| PRD-PLT-006 | `/resources/guide` + `/resources/compliance` static guidance; compliance page never claims regulator approval | RC, COMP | P1 | All | `/resources/*` | static | 1 | Done | Pages render; compliance page states "tidak sama dengan persetujuan regulator" (AC-P1). |
| PRD-PLT-007 | `/dashboard` summarises org portfolio, completion, review queue | RC | P0 | All | `/dashboard` | aggregates | 1 (mock) / 2 (real) | Mocked | Metrics + tables reflect org-scoped real data in Phase 2. |

---

## 9. Non-functional

| Requirement ID | Requirement | Source | Priority | User | UI / Page | Data Entity | Phase | Status | Acceptance Evidence |
|---|---|---|---|---|---|---|---|---|---|
| PRD-NFR-001 | Stack fidelity: Next.js modular monolith + Supabase; deps per DEP phase table; lockfile authoritative; no Prisma initially | ARCH, DEP | P0 | — | repo | — | 0–8 | Partial | Each phase adds only its listed deps; `npm ci` reproduces the lockfile. |
| PRD-NFR-002 | Performance: SSR lists; immediate builder interactions; autosave debounce ≤ ~1s; contained table scroll | ARCH, DS | P1 | All | all | — | 2–8 | Planned | Lighthouse/interaction checks in Phase 8; no page-level horizontal scroll. |
| PRD-NFR-003 | Reliability: publish in a DB txn; PDF/AI idempotent + retryable | ARCH | P0 | Admin, Developer | publish, preview, inspector | — | 6 (publish) / 7 (PDF) / 4 (AI) | Planned | Kill a publish mid-way → no partial state (AC-P6). |
| PRD-NFR-004 | Accessibility WCAG 2.1 AA (contrast, focus, 44px, icon+text status, keyboard drag alt, reduced motion, skip link, labelled fields, inline+summary errors) | DS, P1R | P0 | All | all | — | 1–8 | Partial (P1 verified) | Phase 1 a11y checks pass (P1R); full audit in Phase 8 (AC-P8). |
| PRD-NFR-005 | Responsive at 375/768/1024/1440; builder 280/minmax(560,1fr)/320; drawers <1024; card rows <768; no nested h-scroll in builder centre | DS, RC, P1R | P0 | All | all | — | 1–8 | Partial (P1 verified) | Phase 1 responsive checks pass at all 4 widths (P1R); re-verified each phase. |
| PRD-NFR-006 | Design-system conformance (tokens, fonts, radius, motion, no marketing hero, Lucide only) | DS | P0 | All | all | — | 1–8 | Partial (P1) | Pre-delivery checklist in MASTER.md satisfied each phase. |
| PRD-NFR-007 | Observability: request-id logs excluding manual contents/tokens/source/signed URLs; typed mutation errors; health + readiness | ARCH | P1 | — | server | logs | 2 | Planned | Log inspection shows no sensitive fields; mutations return typed errors. |
| PRD-NFR-008 | i18n: UI + manuals default Bahasa Indonesia; platform terms in terminal language; ID/EN manuals separate | DS, CG §5.1 | P1 | All | all | `manuals.locale` | 2 | Partial (P1 ID copy) | UI is Indonesian; EN track is a separate manual, not mixed. |
| PRD-NFR-009 | Testability: Vitest + Testing Library from Phase 2; Playwright for acceptance + Phase 7 PDF/visual regression | DEP, IP | P0 | — | CI | — | 2 (unit) / 7 (visual) | Planned | Test suites run in CI; each phase's AC has automated coverage where feasible. |
| PRD-NFR-010 | Maintainability: feature folders; logic outside components; Zod at write boundaries; allowlisted renderer, no raw HTML | ARCH | P1 | — | repo | — | 2–3 | Partial | Block writes validated; renderer rejects unknown block types. |

---

## 10. Security and privacy

| Requirement ID | Requirement | Source | Priority | User | UI / Page | Data Entity | Phase | Status | Acceptance Evidence |
|---|---|---|---|---|---|---|---|---|---|
| PRD-SEC-001 | Service/secret key server-only, never in the browser bundle | ARCH | P0 | — | server | env | 2 | Planned | Bundle analysis shows no secret key; only trusted server jobs use it (AC-P2/P8). |
| PRD-SEC-002 | `organization_id` on owned tables; server checks + RLS enforce isolation; cross-org impossible for non-service callers | ARCH, DM | P0 | — | server / DB | all owned tables | 2 | Planned | Org A user cannot read/mutate any Org B entity (AC-P2/P8, PRD-SUCC-009). |
| PRD-SEC-003 | Action-based authz (`manual:update`, `review:technical`, `review:compliance`, `manual:publish`, `template:manage`, `member:manage`); client never decides | ARCH | P0 | — | server | permission map | 2 | Planned | Each action gated by a policy function; role tests by permitted action. |
| PRD-SEC-004 | Draft images private; short-lived signed URLs; published served via controlled signed URLs / publish-safe copy | ARCH, DM | P0 | Developer, Public | builder, public | `image_assets`, storage | 2 / 7 | Planned | Direct unsigned object URL fails; signed URL expires (AC-P2). |
| PRD-SEC-005 | Public routes read only immutable PUBLISHED snapshots — no draft/private/working data | ARCH | P0 | Public | `/manual/[eaSlug]/[version]` | `published_snapshots` | 7 | Planned | Public route has no code path to draft tables (AC-P7). |
| PRD-SEC-006 | AI requests carry only the permitted bundle + selected text + locale + operation; credentials never persisted | ARCH, DM | P0 | — | server | `ai_revisions` | 4 | Planned | Payload assertion test; `ai_revisions` has no credential field. |
| PRD-SEC-007 | `audit_events` append-only; records actor/action/entity/safe metadata/timestamp for all privileged actions | DM | P0 | Admin | (audit) | `audit_events` | 6 | Planned | Assignment, decision, publish, template + member changes each write one row. |
| PRD-SEC-008 | Images carry `scan_status`; unscanned/failed image blocks completion + excluded at publish | DM | P1 | Developer | builder, publish | `image_assets.scan_status` | 2 (field) / 5 (gate) | Planned (rule TBD, PRD-OQ-009) | Chapter with an unscanned image cannot be completed; not in the snapshot. |
| PRD-SEC-009 | Logs/error payloads never contain manual contents, source, credentials, signed URLs | ARCH | P1 | — | server | logs | 2 | Planned | Log scrubbing test on a mutation error path. |
| PRD-SEC-010 | Rich text stored as JSON, rendered via allowlist; arbitrary HTML never trusted/injected | ARCH | P0 | — | renderer | `manual_blocks` | 3 | Planned | Injected `<script>`/raw HTML in a payload is not rendered (AC-P3). |

---

## 11. Document and versioning

| Requirement ID | Requirement | Source | Priority | User | UI / Page | Data Entity | Phase | Status | Acceptance Evidence |
|---|---|---|---|---|---|---|---|---|---|
| PRD-VER-001 | EA Version and Manual Version distinct + separately displayed everywhere | CR ch.0, RC | P0 | All | list, builder, cover, preview | `ea_versions`, `manual_versions` | 1 (shown) / 2 (real) | Done (P1 shows both) | Both strings visible and never conflated (AC-P1/P2). |
| PRD-VER-002 | Manual Version references exactly one EA Version; shown together | DM, CR | P0 | All | cover, metadata | FK `manual_versions.ea_version_id` | 2 | Mocked | Cover + metadata show the paired EA version. |
| PRD-VER-003 | Manual must not describe a different EA version than referenced (version-mismatch check) | CG §1.2, COMP | P0 | Developer | builder inspector | check `CHK-VERSI-MATCH` | 5 | Planned | Crafted mismatch → `MISSING`/`WARNING` on the check (AC-P5). |
| PRD-VER-004 | Publication snapshots immutable + content-hashed; re-publish = new Manual Version | ARCH, DM | P0 | Admin | publish, `/manuals` | `published_snapshots.content_hash` | 6 | Planned | Re-render reproduces the hash; editing requires a new version (AC-P6, PRD-SUCC-004). |
| PRD-VER-005 | Every published version addressable at `/manual/[eaSlug]/[version]`; older navigable from newer | RC, IP | P0 | Public | `/manual/[eaSlug]/[version]` | `published_snapshots` | 7 | Planned | Version switcher lists all published versions; old URLs still resolve (AC-P7). |
| PRD-VER-006 | `changelog_entries` per Manual Version (ordered text, source EA version); breaking entry states open-position impact | DM, CG §4.13, CR ch.14 | P0 | Developer | builder Ch.14 | `changelog_entries` | 3 (authoring) / 5 (check) | Mocked | Breaking entry without impact text → `MISSING` on `CHK-CHANGELOG-VERSI`. |
| PRD-VER-007 | Feature/behaviour changes → changelog entry + flag the Pasal 8 obligation (client approval + report to Kepala Bappebti); tool does not file | PBK Pasal 8, COMP §13 | P1 | Developer, Compliance | builder Ch.14, review | `changelog_entries` | 6 | Blocked (PRD-OQ-010) | Feature-change entry shows a Pasal 8 reminder; no filing performed. |
| PRD-VER-008 | Templates versioned; manual version records template + checklist template versions used | DM | P1 | Admin | `/templates`, builder metadata | template versions | 2 (template) / 5 (checklist) | Planned | Manual version row stores both template version ids. |

---

## 12. Compliance-assistance

| Requirement ID | Requirement | Source | Priority | User | UI / Page | Data Entity | Phase | Status | Acceptance Evidence |
|---|---|---|---|---|---|---|---|---|---|
| PRD-COMP-001 | Documentation-completeness assistance only; no automated result labelled "Bappebti Approved"/"Approved"/"Certified" | COMP §0, DS | P0 | All | every surface incl. PDF/public | copy + `checklist_results` | 1 (copy) / 5 (engine) / 7 (output) | Done (P1 copy) | String scan of UI/PDF/public finds none of the forbidden labels (AC-P1/P5/P7, PRD-SUCC-003 partly). |
| PRD-COMP-002 | Checks map to the 4 mandatory manual elements (cara kerja, instalasi, setting, kontak) | PBK Pasal 4(3)n / 5(4)b, COMP §2.1 | P0 | Developer, Compliance | builder inspector, `/reviews/compliance` | `checklist_items` | 5 | Planned | `CHK-CARA-KERJA/INSTALASI/SETTING/KONTAK` each present + evaluated (AC-P5). |
| PRD-COMP-003 | Enforce the Pasal 5(5)d disclaimer sentence in the Disclaimer chapter (not a footnote) | PBK Pasal 5(5)d, CR ch.15 | P0 | Developer | builder Ch.15, inspector | check `CHK-DISCLAIMER-5-5-D` | 5 | Planned | Missing sentence → `MISSING`; present in body → `PASS` with evidence span (AC-P5). |
| PRD-COMP-004 | Claim scanner flags Pasal 5(3) / CG §2.4 prohibited categories | PBK Pasal 5(3), CG §2.4, COMP §4 | P0 | Developer, Compliance | builder inspector, `/reviews/compliance` | `checklist_results` (claim), `ai_revisions` | 4 (scan) / 5 (aggregate) | Planned | Each category fires on a crafted manual; publish-blocking ones block compliance approval (AC-P4/P5). |
| PRD-COMP-005 | Checklist references (as items) disclosure statement + video (Pasal 9), Rp50m margin (Pasal 5(7)), developer legality (Pasal 5(4)a/6), algorithm transparency + effective period (Pasal 5(4)c / 5(6)) | PBK, COMP §2 | P1 | Developer, Compliance | builder inspector | `checklist_items` | 5 | Planned | `CHK-DISCLOSURE-REF`, `CHK-ONBOARDING-MARGIN`, `CHK-DEV-LEGAL`, `CHK-TRANSPARANSI`, `CHK-PERIODE-EFEKTIF` present (AC-P5). |
| PRD-COMP-006 | States exactly PASS/WARNING/MISSING/NOT_APPLICABLE; WARNING never blocks submission, MISSING on a required item does | COMP §10 | P0 | Developer, Compliance | builder inspector | `checklist_results.state` | 5 | Mocked | Enum restricted to 4 values; submission gate honours the rule (AC-P5/P6). |
| PRD-COMP-007 | Automated checks and human review visually + structurally separate (no merged "approved" badge) | COMP §0/§13 | P0 | All | builder inspector, review pages | UI | 5 / 6 | Done (P1 inspector note) | Inspector shows the "not approval" note; review decision is a distinct control with actor + time (AC-P5/P6). |
| PRD-COMP-008 | Backtest/performance shown only with test conditions; never a guarantee | PBK Pasal 5(4)e, CG §7, CR ch.11 | P0 | Developer, Compliance | builder Ch.11, inspector | check `CHK-PERFORMANCE-KONDISI` | 5 | Planned | A metric without conditions → `WARNING`/`MISSING`; caveat required (AC-P5). |

---

## 13. Manual + PDF/web output content

| Requirement ID | Requirement | Source | Priority | User | UI / Page | Data Entity | Phase | Status | Acceptance Evidence |
|---|---|---|---|---|---|---|---|---|---|
| PRD-MOUT-001 | Canonical 18-chapter structure with required/optional/conditional flags | CR | P0 | Developer | builder, template | `manual_sections`, template | 1 (mock) / 2 (template) | Mocked | Template instantiates exactly the CR structure. |
| PRD-MOUT-002 | Semantic HTML output: cover with identity + versions + "Sample/Demo" marking; paged sections with running header/footer; chapter kicker + heading; blocks per type | P1R, ARCH | P0 | All | preview, public, PDF | view model | 1 (renderer) / 7 (final) | Done (P1 renderer) | Renderer output matches this structure (AC-P1/P7). |
| PRD-MOUT-003 | Long text within 65–75 char measure; A4 preview keeps real proportions | DS | P1 | All | builder centre, preview | CSS | 1 | Done (P1) | Measured column width; A4 aspect ratio retained (AC-P1). |
| PRD-MOUT-004 | Parameter tables render group headings + standard columns; contained scroll on small screens | CG §4.8, P1R | P0 | All | Ch.7, preview, public | `manual_blocks` (parameterTable) | 1 (mock) / 3 | Done (P1 mock) | Table scrolls inside `manual-table-wrap`, not the page (AC-P1). |
| PRD-MOUT-005 | Images as figure+figcaption; caption describes content; uploader masks account/balance/broker (guidance) | CG §5.2, CR ch.10/11 | P1 | Developer | builder image block, preview | `image_assets` | 3 (block) / 5 (guidance) | Mocked | Figure/figcaption render; upload flow shows the masking guidance. |
| PRD-MOUT-006 | Callouts render icon + label for warning/info/tip | P1R, CR appendix A | P1 | All | builder, preview, public | `manual_blocks` (callout) | 1 | Done (P1) | Three tones render distinctly with icon + text (AC-P1). |
| PRD-MOUT-007 | Manual states server time for clock values; defines points vs pips | CG §4.8/§5.1, CR ch.6/7 | P1 | Developer | builder Ch.6/7, inspector | check `CHK-UNITS-DEFINED` | 5 | Planned | Missing definition → WARNING (AC-P5). |
| PRD-MOUT-008 | No prohibited claim language at publish; publish gated on zero unresolved required `MISSING` (+ Phase 6 compliance approval) | COMP §4/§10 | P0 | Admin | publish | server precondition | 5 / 6 | Planned | Publish blocked with a listed reason until clean (AC-P6). |
| PRD-POUT-001 | Web + PDF from the same view model + print CSS; content never forks | ARCH | P0 | All | preview, public, PDF | view model | 7 | Planned | Diff of web vs PDF content model = empty (AC-P7, PRD-SUCC-005). |
| PRD-POUT-002 | Public web: TOC, in-page search, version nav, immutable, no private assets | RC | P0 | Public | `/manual/[eaSlug]/[version]` | `published_snapshots` | 7 | Planned | All three nav features work; no private asset requests (AC-P7). |
| PRD-POUT-003 | PDF: A4, repeated long-table headers, per-block page-break pref, caption+image grouping, assets loaded before export | ARCH | P0 | Public | PDF | job | 7 | Planned | PDF fixture inspection (AC-P7). |
| PRD-POUT-004 | PDF filename `Manual_<EAName>_v<X.Y.Z>.pdf` | CG §8 | P2 | Public | PDF download | job | 7 | Planned | Generated file name matches the pattern. |
| PRD-POUT-005 | PDF via server-side Playwright against a signed print route; idempotent + visible retry | ARCH, DEP | P1 | Developer | preview, public | job | 7 | Planned | Re-run → same file; failure shows retry (AC-P7). |
| PRD-POUT-006 | Until Phase 7, preview "Export PDF" present but disabled with a phase explanation | RC, P1R | P1 | Developer | `/manuals/[manualId]/preview` | — | 1 | Done | Disabled button + `title` (AC-P1). |

---

## 14. Success criteria (from PRD §20)

| Requirement ID | Criterion | Verified in phase | Status | Acceptance Evidence |
|---|---|---|---|---|
| PRD-SUCC-001 | New contributor reaches a valid preview without editing JSON or reading code | 5–6 | Planned | Blind-user walkthrough (CG §alur "uji buta"). |
| PRD-SUCC-002 | 100% of EA inputs appear in a parameter table for a completed manual | 5 | Planned | `CHK-PARAM-COMPLETE` diff = empty. |
| PRD-SUCC-003 | Zero published manuals contain prohibited claim language | 5–7 | Planned | Claim scan + compliance review + publish gate. |
| PRD-SUCC-004 | Every published version has an immutable, content-hashed snapshot at its public URL; re-render reproduces the hash | 6–7 | Planned | Hash recomputation test; update trigger test. |
| PRD-SUCC-005 | Web and PDF of a version show the same chapters/blocks/values | 7 | Planned | Visual regression fixtures. |
| PRD-SUCC-006 | No approval recorded against the manual's own author/editor | 6 | Planned | Self-approval attempt → typed error. |
| PRD-SUCC-007 | Creating "Polaris EA" shows only Polaris data everywhere | 2 | Planned | Builder/inspector/preview/cover assertions. |
| PRD-SUCC-008 | EA version with two setups renders both in Ch.2 and Ch.9 | 3 | Planned | Setup fixture render check. |
| PRD-SUCC-009 | Org A member cannot list/read/mutate any Org B entity | 2 / 8 | Planned | RLS + action-check role tests. |
| PRD-SUCC-010 | Each phase passes its `ACCEPTANCE_CRITERIA.md` criteria before the next begins | 0–8 | Partial (P0, P1 done) | Phase gate sign-off recorded in the phase report. |

---

## 15. Open questions (from PRD §25) — tracked to a decision

| Requirement ID | Question | Needed by phase | Status |
|---|---|---|---|
| PRD-OQ-001 | Styling approach: bespoke CSS vs Tailwind utilities vs shadcn/ui | 2 | Open |
| PRD-OQ-002 | Inspector tabs: 2 (shipped) vs 3 (RC) | 3–5 | Open |
| PRD-OQ-003 | Auth route group `app/(auth)/login/` vs `app/login/` (shipped) | 2 | Open |
| PRD-OQ-004 | Exact checklist item set + rule keys (v1) | 5 | Open (draft in COMP §12) |
| PRD-OQ-005 | Which chapters are truly `required` (15 in mock vs 13 in copy vs CR table) | 2 / 5 | Open (proposal in CR chapter map) |
| PRD-OQ-006 | Supported-setup granularity (`{symbol,timeframe}` only vs + preset/account/spread) | 2 | Open |
| PRD-OQ-007 | Publishing authority: admin-only vs compliance-reviewer-with-`manual:publish` | 6 | Open |
| PRD-OQ-008 | Locale strategy: separate `manuals` rows vs per-locale versions | 2 (schema) | Open |
| PRD-OQ-009 | Image `scan_status` mechanism; unscanned = blocked vs warning | 2 / 5 | Open |
| PRD-OQ-010 | Changelog ↔ Pasal 8: record only vs also produce client-approval artefact + reminder task | 6 | Open |
| PRD-OQ-011 | Non-Bappebti EAs: which chapters/checks suppressed | 5 | Open |
| PRD-OQ-012 | Template editing depth in v1 (titles/help only vs full chapter CRUD + required flags) | 2 | Open |

---

## 16. Phase coverage summary

| Phase | Primary requirement IDs | Gate |
|---|---|---|
| **0 — Architecture** | (all docs) NFR-001 baseline | Done — `docs/` committed, no app code (IP). |
| **1 — UI foundation** | PRD-PLT-006, PRD-OUT-007/POUT-006, PRD-MOUT-002/003/004/006, PRD-VAL-004 (copy), PRD-COMP-001/007 (copy), PRD-VER-001, PRD-NFR-004/005/006 (initial) | Done — `docs/PHASE_1.md`. |
| **2 — Data & CRUD** | PRD-EA-001..008, PRD-MAN-001..007/010/012/014, PRD-CNT-003/004/006, PRD-PLT-001..005/007, PRD-SEC-001..004/009, PRD-VER-002/008, PRD-NFR-007/009 | AC-P2. |
| **3 — Document editor** | PRD-MAN-008/009/011, PRD-CNT-001/002/005/007/009, PRD-SEC-010, PRD-VER-006, PRD-MOUT-005 | AC-P3. |
| **4 — AI assistant** | PRD-AI-001..007, PRD-COMP-004 (scan), PRD-SEC-006 | AC-P4. |
| **5 — Validation & compliance** | PRD-VAL-001..005, PRD-CNT-008, PRD-COMP-002..008, PRD-VER-003, PRD-MOUT-007/008, PRD-SEC-008 | AC-P5. |
| **6 — Reviews & versioning** | PRD-REV-001..009, PRD-MAN-013, PRD-OUT-002/003, PRD-VER-004/007, PRD-SEC-007, PRD-NFR-003 | AC-P6. |
| **7 — Output** | PRD-OUT-001/004/005/006, PRD-POUT-001..006, PRD-VER-005, PRD-SEC-005, PRD-SUCC-005 | AC-P7. |
| **8 — Quality** | PRD-NFR-002/004/005/006 (full audits), PRD-SEC-002/003 (role tests), PRD-SUCC-009, comprehensive empty/loading/error | AC-P8. |
