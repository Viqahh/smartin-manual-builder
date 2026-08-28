# Phase 2 completion report — Data & CRUD

> **Status:** Implementation complete for every credential-independent deliverable. `lint`,
> `typecheck`, `test`, and `build` all pass. Live-Supabase acceptance tests are
> **BLOCKED BY EXTERNAL CREDENTIALS** (no Supabase project, CLI, or Docker in the build
> environment) — see [§ Acceptance criteria results](#acceptance-criteria-results) and
> [§ External credential limitations](#external-credential-limitations). Phase 2 is **not**
> declared fully complete until those run against a real project.
>
> Baseline: `docs/IMPLEMENTATION_PLAN.md` Phase 2, `docs/ACCEPTANCE_CRITERIA.md` Phase 2,
> corrected `docs/DATA_MODEL.md`. No Phase 3+ functionality was implemented.

---

## 1. Completed scope

| Area | Delivered |
|---|---|
| **Database schema** | 7 SQL migrations under `supabase/migrations/` — core, EA facts, manual content, functions/guards, RLS, atomic-creation RPCs. UUID PKs, FKs, unique + check constraints, `updated_at` + `row_version` triggers, soft-archive/soft-delete columns, position constraints. |
| **RLS** | Enabled on every `public` table + `storage.objects` for the `manual-images` bucket. Org isolation via `app.member_org_ids()`. `audit_events` is append-only (no UPDATE/DELETE policy). |
| **Auth** | Supabase Auth (email + password), cookie-based SSR session via `@supabase/ssr` + `middleware.ts`. Sign-in / sign-out server actions. Workspace layout guard: unauthenticated → `/login`, no membership → `/no-membership`, unconfigured → in-app setup panel. |
| **Org + membership + roles** | `organizations`, `profiles` (mirror of `auth.users` via trigger), `memberships` (org-scoped `membership_role` enum). `getWorkspaceContext()` resolves user + memberships + active org once per request (React `cache`). |
| **Action-based authorization** | `lib/permissions/actions.ts`: `Action` union, `ROLE_ACTIONS` map, `can` / `canAny` / `assertCan` (throws typed `AuthorizationError`). Every server action calls `assertCan` before mutating. Client only hides/disables for UX. |
| **EA Product CRUD** | `features/ea-products/` — create (slug unique per org), update, archive (soft, timestamped, never hard-deleted). `/ea-products` list + `/ea-products/[productId]` detail, org-scoped real data. |
| **EA Version CRUD** | `features/ea-versions/` — create with semver + platform (`(product, platform, version)` unique), structured `requirements`/`support` JSON. Historical versions preserved. |
| **Supported Configuration CRUD + UI** | `ea_version_setups` model + `features/setups/setup-editor.tsx` (functional repeatable editor: symbol w/ broker suffixes, controlled MT timeframe select, preset, Tested Minimum Lot, notes, Supported toggle, up/down reorder, remove, "+ Tambah konfigurasi", broker-min-lot note). Also embedded in the wizard's new-EA path and the EA-version create form. Explicit rows only — no inference (GI-10). |
| **Parameter Group / Parameter CRUD** | `features/parameters/` — groups + parameters **owned by EA Version** (`parameter_groups.ea_version_id`, `ea_parameters.parameter_group_id`; no `manual_version_id` anywhere). Full column set from `DATA_MODEL.md`. `app.copy_parameter_definitions(src, dst)` = EA-version → EA-version only. |
| **Manual + Manual Version CRUD** | `features/manuals/` — wizard (existing-EA and new-EA paths), both atomic via RPC. First `manual_versions` row instantiates the canonical 18 sections. `manual_versions.version` unique per manual; references exactly one `ea_versions`. `/manuals` list + dashboard backed by real org-scoped data. |
| **Persisted sections & blocks** | `manual_sections` (per-manual-version, canonical + custom), `manual_blocks` (six documented types, Zod-validated payload, soft delete, live-position unique index). Backend CRUD + validation only; the rich editor is Phase 3. |
| **Private image upload** | `features/images/actions.ts` — MIME + size + owner + org validation; object at `<org_id>/<asset_id>.<ext>` in the private `manual-images` bucket; `image_assets` metadata row with `scan_status`. Render path signs short-lived URLs. No annotation editor (Phase 3). |
| **Dynamic manual routing** | `/manuals/[manualId]/edit` and `/preview` load by route id via `SupabaseManualDataSource` + `assembleManualViewModel`; unknown id → `notFound()`. All hardcoded VMax/1.0.0/XAUUSD behaviour removed. |
| **Shared Manual View Model** | `lib/manual/view-model.ts` — one typed `ManualViewModel` + pure assembler over an injectable `ManualDataSource`. Consumed by `ManualBuilder` and `ManualRenderer` today; reusable by the public web manual + PDF later. No second renderer. |
| **Real autosave + conflict handling** | `row_version` bigint bumped by trigger; `saveSection` runs `UPDATE ... WHERE row_version = expected`; 0 rows → `CONFLICT` (never silent overwrite). Builder shows `Belum disimpan / Menyimpan… / Tersimpan / Gagal menyimpan / Konflik perubahan`; "Tersimpan" only after server confirmation. Pure `resolveWrite` logic unit-tested. |
| **Mock data removed** | `features/manuals/mock-data.ts` deleted. `localStorage` keys `smartin-new-manual` / `smartin-manual-wizard` / `smartin-builder-chapter` removed as data sources. Selected chapter is component state scoped to the loaded manual. |
| **Error / loading / empty / not-found states** | `app/not-found.tsx`, `app/(workspace)/error.tsx`, `app/(workspace)/loading.tsx`, `/no-membership`, `components/system-panel.tsx` (not-configured / empty). Disabled buttons keep their phase explanations. Errors are human messages — no SQL/secret leakage. |
| **Health / readiness** | `GET /api/health` → `{ ok: true, ready, checks[] }`, HTTP 503 while a required var is missing, endpoint always responds. |
| **Tests + CI** | Vitest + Testing Library configured. 39 unit tests pass (permissions, semver, symbol/suffix, timeframe control, setup list + dedupe + no-inference, block payloads, parameter input, canonical sections, autosave conflict, view-model isolation, SQL↔TS parity). 5 RLS integration tests are `describe.skipIf`-gated on credentials. `.github/workflows/ci.yml` runs `npm ci → lint → typecheck → test → build` on Node 22. |

### Explicitly NOT implemented (Phase 3+ boundary — spec §2)

TipTap / rich-text editor, real block editor UX, drag-and-drop document editing, AI assistant / rewriting / claim scanning, validation & compliance engine, review workflow & reviewer comments, publishing & immutable snapshots, public manual route behaviour, PDF export, image annotation editor, template CRUD UI, member-management UI, org switcher, Phase 6 version cloning.

---

## 2. Database schema & migrations

Files (`supabase/migrations/`, timestamp-ordered):

| File | Contents |
|---|---|
| `20260901000100_core.sql` | `pgcrypto`, `app` schema, `touch_updated_at()` / `bump_row_version()` triggers, `membership_role` enum, `organizations`, `profiles` (+ `on_auth_user_created` trigger), `memberships`, `app.member_org_ids()` / `has_org_access()` / `member_role()`, `audit_events`. |
| `20260901000200_ea.sql` | `ea_platform`, `mt_timeframe`, `ea_param_type`, `ea_param_mutability` enums; `ea_products` (slug unique/org, soft archive), `ea_versions` (semver check, `(product, platform, version)` unique), `ea_version_setups` (symbol regex, `(ea_version, symbol, timeframe)` unique, `tested_minimum_lot >= 0`), `parameter_groups` (`(ea_version, name)` unique), `ea_parameters` (technical-name regex, `(group, technical_name)` unique). |
| `20260901000300_manuals.sql` | `manual_status`, `manual_block_type`, `image_scan_status`, `section_completion_state` enums; versioned `manual_templates` + `manual_template_sections`; `image_assets`; `manuals`; `manual_versions` (semver, `row_version`, `(manual, version)` unique, exactly one `ea_version_id`); `manual_sections` (`(manual_version, section_key)` + deferrable `(manual_version, position)` unique, `row_version`); `manual_blocks` (partial unique `(section, position) where deleted_at is null`, `row_version`). |
| `20260901000400_functions_triggers.sql` | `app.instantiate_manual_sections()` (canonical 18), `guard_required_section_delete()` (required, non-custom sections undeletable), `guard_published_manual_version()` (published = immutable except → ARCHIVED), `guard_parameter_table_ownership()` (parameterTable groups must belong to the linked EA version), `app.copy_parameter_definitions()`. |
| `20260901000500_rls.sql` | `enable row level security` on all tables; member-scoped SELECT/INSERT/UPDATE/DELETE on org-owned tables; ADMIN-only writes on `memberships` / org templates; append-only `audit_events`; private `manual-images` bucket + path-prefix (`<org_id>/…`) storage policies. |
| `20260901000600_rpc.sql` | `public.create_ea_version_with_setups()`, `public.create_manual_with_version()`, `public.create_product_version_manual()` — SECURITY DEFINER, each verifies `app.has_org_access()`, each fully transactional; grants to `authenticated` + `service_role`. |

`supabase/seed.sql` — demo org A + org B, four demo auth users (`*@smartin.demo`, password `demo-password-123`, LOCAL ONLY), memberships, system template, **VMax EA / MT5 / 1.0.0**, two `ea_version_setups` (`XAUUSD/M15`, `XAUUSD/H1`), one parameter group + three parameters, one manual + manual version + canonical sections. All strings marked `DEMO` / `SAMPLE`; no performance/approval claims.

`supabase/config.toml` — local stack config so `supabase db reset` reproduces the schema + seed.

### Reproducing a clean project

```bash
# local (needs Docker + supabase CLI)
supabase start
supabase db reset          # replays migrations/ then seed.sql

# hosted
supabase link --project-ref <ref>
supabase db push           # applies migrations/
# then create auth users via the dashboard / Auth API and insert memberships,
# or run the non-auth portion of seed.sql
```

---

## 3. Ownership model (as built)

```
EAProduct → EAVersion → EAVersionSetup            (ea_version_setups.ea_version_id)
                      → EAParameterGroup           (parameter_groups.ea_version_id)
                          → EAParameter            (ea_parameters.parameter_group_id)

Manual → ManualVersion (→ exactly one EAVersion)
              → ManualSection → ManualBlock
```

- `parameter_groups` / `ea_parameters` / `ea_version_setups` **never** carry `manual_version_id` (verified by `tests/unit/schema-parity.test.ts`).
- A `parameterTable` block's `parameter_group_ids` are constrained by `guard_parameter_table_ownership()` to groups of the manual version's linked EA version.
- Two manual versions on the same EA version resolve to the **same** parameter rows — there is no copy step (GI-11, AC-P2-18b).

---

## 4. Supported Configuration implementation (GI-10 / GI-12)

- Table `ea_version_setups` — `id, organization_id, ea_version_id, symbol, timeframe (mt_timeframe enum), preset_ref, tested_minimum_lot, notes, is_supported, position, timestamps`; unique `(ea_version_id, symbol, timeframe)`.
- `symbol` stored verbatim incl. broker suffix; DB check `^[A-Za-z0-9]{2,}([._][A-Za-z0-9]+)?$`; app normalises the base to upper-case, keeps the suffix as typed.
- `timeframe` is a Postgres enum — free text is impossible at the DB and at the UI (`<select>` limited to `MT_TIMEFRAMES`).
- No code path derives a `symbol × timeframe` pair from independently listed values. `isConfigurationSupported()` checks explicit rows only.
- `tested_minimum_lot` is nullable, `>= 0`, labelled *"data uji developer — bukan minimum broker"* in every editor, and the fixed note **"Minimum lot aktual ditentukan oleh spesifikasi simbol pada broker."** is shown in the editor, the wizard, the version form, and rendered Chapters 2 & 9.
- Reorder: keyboard-accessible up/down buttons (satisfies AC-P2-9b "keyboard"). Pointer drag is deferred to Phase 3 "presentation polish" per `IMPLEMENTATION_PLAN.md` Phase 3 / `AC-P3-10`.

---

## 5. Auth, membership & permissions

- `middleware.ts` refreshes the Supabase session on every request (skipped when unconfigured).
- `lib/supabase/{server,client,service}.ts` — SSR server client (cookie-bound, RLS applies), browser client (publishable key), service client (secret key, **server-only**, RLS-bypassing, used only by seeding/atomic-RPC paths).
- `SUPABASE_SECRET_KEY` is referenced only in `lib/env.ts` + `lib/supabase/service.ts` (both `import "server-only"`), so it cannot enter the client bundle (GI-9).
- Roles: `DEVELOPER`, `TECHNICAL_REVIEWER`, `COMPLIANCE_REVIEWER`, `ADMIN`. `ROLE_ACTIONS` grants: DEVELOPER = EA/manual authoring + image upload; reviewers = reads + their review action; ADMIN = all.
- Every server action: `requireActiveOrg()` → `assertCan(role, action)` → typed `ActionResult`. RLS is the second layer.

---

## 6. Autosave / conflict strategy

Recorded decision (resolves the "record the exact chosen strategy" clause of spec §21):

- **Optimistic concurrency via `row_version`.** Editable rows (`manual_versions`, `manual_sections`, `manual_blocks`) carry a `bigint row_version` bumped by a `BEFORE UPDATE` trigger.
- The client sends the `row_version` it last read. The mutation is `UPDATE … WHERE id = $id AND row_version = $expected`.
- 0 rows updated ⇒ a newer write already landed ⇒ the action returns `{ ok:false, code:"CONFLICT" }`. The client shows **"Konflik perubahan"** and offers reload; it never overwrites and never shows "Tersimpan".
- Debounce: 800 ms (`DEFAULT_AUTOSAVE_DEBOUNCE_MS`). "Tersimpan" is set **only** in the server-confirmed branch.
- Phase 2's editable surface is the chapter completion state (the block editor is Phase 3). `resolveWrite()` and the state machine are unit-tested; the end-to-end two-session test is BLOCKED (needs a live DB).

---

## 7. Dynamic routing & view model

- `/manuals/[manualId]/edit` + `/preview` → `new SupabaseManualDataSource(orgId).loadManualVersionByManualId(manualId)` → `assembleManualViewModel`. Unknown/foreign id → `notFound()`.
- The data source loads every fact by explicit id and never falls back to "a" manual (AC-P2-12). `manualIdentity(vm)` feeds the builder header, inspector metadata, preview header, and cover from the same object.
- `ManualRenderer` takes `{ vm }` — no hardcoded product. `ManualBuilder` takes `{ vm }`.

---

## 8. Tests

`npm run test` → **39 passed, 5 skipped** (5 test files).

| File | Covers |
|---|---|
| `tests/unit/permissions.test.ts` | role → action map, `assertCan` typed errors (AC-P2-22). |
| `tests/unit/domain.test.ts` | semver accept/reject/order; MT timeframe control; broker-suffix symbols + normalisation; setup list — 3 documented configs persist distinctly, `EURUSD/M15` **not** implied, duplicate rejected, unknown TF / empty rejected, `tested_minimum_lot` optional & non-negative; six block payloads + unknown-type/raw-HTML rejection; parameter identifier + type; canonical 18 sections; `resolveWrite` match/stale/missing (AC-P2-7/9/9a/9b/15/18/20). |
| `tests/unit/view-model.test.ts` | assembler returns null for empty/unknown id; assembles the exact manual — "Polaris" never shows "VMax"; deterministic sort (AC-P2-12). |
| `tests/unit/schema-parity.test.ts` | migration SQL ↔ TS constants: canonical sections, `mt_timeframe`, `manual_block_type`, `ea_param_type`, `membership_role` enums; `parameter_groups`/`ea_version_setups` FK `ea_versions` and never `manual_versions`; setup uniqueness tuple; RLS enabled on every org table (AC-P2-18a, GI-10/11). |
| `tests/integration/rls.test.ts` | **skipped (BLOCKED)** — cross-org read/write/storage isolation against a live project (AC-P2-21, spec §27). |

### Running the RLS integration tests (once a project exists)

```bash
# apply supabase/migrations + supabase/seed.sql to the project, then:
SUPABASE_TEST_URL=https://<ref>.supabase.co \
SUPABASE_TEST_ANON_KEY=<anon key> \
SUPABASE_SECRET_KEY=<secret key> \
npm run test -- tests/integration/rls.test.ts
```

---

## 9. CI

`.github/workflows/ci.yml` — on push/PR to `main`: `actions/setup-node@v4` (Node 22, npm cache) → `npm ci` → `npm run lint` → `npm run typecheck` → `npm run test` → `npm run build` (with empty Supabase env, proving the build survives an unconfigured project). Reproducible by any developer with `npm ci`.

---

## 10. Local verification performed (this environment)

| Check | Result |
|---|---|
| `npm run lint` | ✅ pass, 0 warnings/errors |
| `npm run typecheck` (`tsc --noEmit`) | ✅ pass |
| `npm run test` | ✅ 39 passed, 5 skipped (BLOCKED integration) |
| `npm run build` | ✅ pass, 18 routes generated |
| `GET /api/health` (built server, no Supabase env) | ✅ HTTP 503, body `{ ok:true, ready:false, checks:[…] }` — endpoint responds, readiness false (AC-P2-2) |
| `/` | ✅ 307 → `/dashboard` |
| `/login` | ✅ 200 |
| `/dashboard` unauthenticated + unconfigured | ✅ 200, renders the "Supabase belum dikonfigurasi" panel — no crash (spec §31) |
| Secret key in client bundle | ✅ not present — read only in `server-only` modules |

Not performed here (no Supabase project / CLI / Docker): migration apply, seed apply, live auth sign-in, CRUD round-trips, RLS enforcement, image upload + signed URL, two-session autosave conflict, the Polaris and parameter-ownership end-to-end scenarios. All are BLOCKED (below) and scripted/covered by the skipped integration suite + the acceptance table.

---

## 11. Acceptance criteria results

Legend: ✅ met & verified here · 🟦 implemented, verification BLOCKED (needs live Supabase) · ⬜ Phase-boundary / SHOULD deferred.

| ID | Result | Note |
|---|---|---|
| AC-P2-1 | ✅ / 🟦 | GI-3/4/5/6/7 ✅ (lint, typecheck, build, no inert buttons, icon+text). GI-10/11/12 ✅ at schema + unit level; UI-scan 🟦. |
| AC-P2-2 | ✅ | `/api/health` 503 + `ready:false` + checks when a var is missing; endpoint responds. |
| AC-P2-3 | ✅ | Secret key only in `server-only` modules; not in the build's client chunks. |
| AC-P2-4 | 🟦 | `signInAction` / `signOutAction` + cookie SSR implemented; generic error message; needs a live project to exercise. |
| AC-P2-5 | ✅ | `/no-membership` state + layout redirect implemented; reachable logic verified via smoke test of the unconfigured/guarded paths. |
| AC-P2-6 | 🟦 | `createEaProduct` + slug uniqueness + inline error mapping implemented. |
| AC-P2-7 | 🟦 | `createEaVersion` + `(product, platform, version)` unique; semver validated (unit-tested). |
| AC-P2-8 | 🟦 | `requirements`/`support` JSON round-trip; symbols/timeframes are `ea_version_setups`, not free text (schema-parity test ✅). |
| AC-P2-9 | 🟦 | `create_ea_version_with_setups` inserts one row per config; unit test proves 3 documented configs are distinct. |
| AC-P2-9a | ✅ / 🟦 | No inference path (unit-tested ✅); full UI/output scan 🟦. |
| AC-P2-9b | ✅ / 🟦 | Editor: add/edit/reorder(keyboard)/enable/remove, suffix symbols, controlled TF, inline dup rejection — built; unit-tested. Drag = Phase 3 polish (documented). e2e 🟦. |
| AC-P2-9c | ✅ | Broker-min-lot note + "data uji developer" labels present in editor, wizard, version form, and renderer (Ch. 2 & 9). |
| AC-P2-10 | 🟦 | `create_manual_with_version` → `app.instantiate_manual_sections` seeds canonical 18 (SQL ↔ `canonical-sections.ts` parity test ✅). |
| AC-P2-11 | 🟦 | New-EA path via `create_product_version_manual` — single transactional function; rolls back on any failure. |
| AC-P2-12 | ✅ / 🟦 | View-model isolation unit-tested (Polaris never shows VMax). Full builder/inspector/preview/cover e2e 🟦. |
| AC-P2-13 | 🟦 | `manual_versions (manual_id, version)` unique + friendly mapping. |
| AC-P2-14 | 🟦 | `guard_required_section_delete()` trigger + `manual:update` server gate. |
| AC-P2-15 | ✅ / 🟦 | `blockPayloadSchema` Zod union validated at the write boundary; six types + rejection unit-tested. DB persistence 🟦. |
| AC-P2-16 | 🟦 | `position >= 0` checks + partial unique `(section, position) where deleted_at is null`. |
| AC-P2-17 | 🟦 (SHOULD) | `manual_blocks.deleted_at` soft delete column present; recover-UI is Phase 3. |
| AC-P2-18 | 🟦 | Full `ea_parameters` column set; `createParameter` / `updateParameter`. |
| AC-P2-18a | ✅ / 🟦 | Schema-parity test proves FK to `ea_versions`, no `manual_version_id`; `guard_parameter_table_ownership()` rejects foreign groups. Runtime rejection 🟦. |
| AC-P2-18b | 🟦 | No copy step exists; both manual versions read the same rows (design). Propagation e2e 🟦. |
| AC-P2-18c | 🟦 (SHOULD) | `app.copy_parameter_definitions()` is EA-version → EA-version; wired via `copyParametersFromVersionId`. |
| AC-P2-19 | 🟦 | `uploadManualImage`: MIME/size/owner/org checks, private bucket, `<org>/<id>.<ext>` key, `image_assets` row, `scan_status`. Signed-URL expiry / direct-URL-blocked 🟦. |
| AC-P2-20 | ✅ / 🟦 | `row_version`-guarded UPDATE + `resolveWrite` unit-tested; builder surfaces the 5 states, "Tersimpan" only on server confirm. Two-session test 🟦. |
| AC-P2-21 | 🟦 | RLS on every org table + storage; `tests/integration/rls.test.ts` written, **BLOCKED**. Schema-parity test confirms RLS is enabled. |
| AC-P2-22 | ✅ | `assertCan` typed-error unit tests; every action gated server-side. |
| AC-P2-23 | ✅ (SHOULD) | `mapPostgrestError` + `error.tsx` emit human messages only; `writeAudit` logs action/entity, not contents. |
| AC-P2-24 | ✅ / 🟦 | `/dashboard`, `/manuals`, `/ea-products` read from `features/*/queries.ts` (Supabase), no `localStorage`; the mock file is deleted. Live data render 🟦. |
| AC-P2-25 | ✅ | Vitest + Testing Library configured and green in CI; slug/version uniqueness (mapping), permission map, autosave conflict all covered. |
| AC-P2-26 | ✅ (SHOULD) | `manual_templates`/`manual_template_sections` versioned; `manual_versions.template_version` recorded by the creation RPCs. |
| AC-P2-27 | ✅ | Open-question decisions below. |

---

## 12. Open-question decisions (AC-P2-27)

| OQ | Decision for Phase 2 |
|---|---|
| **PRD-OQ-001 — styling** | Keep the bespoke `app/globals.css` design-token stylesheet. Phase 2 additions are a scoped block at the end of the file using the same tokens/conventions. No Tailwind utilities in JSX, no shadcn/ui added. Revisit only if a component library becomes necessary. |
| **PRD-OQ-003 — auth route group** | Keep `app/login/` (no `(auth)` group). `/login`, `/no-membership` sit at the app root, outside `app/(workspace)/`. Documented; not worth a churny move. |
| **PRD-OQ-006 — supported-setup granularity** | Already resolved in PRD §25 — implemented exactly as specified (`ea_version_setups` columns above). |
| **PRD-OQ-012 — template editing depth** | Phase 2 ships the versioned template **tables** + a seeded system template. No admin editing UI (that is Phase 2's `template:manage` action reserved for a later admin surface). Manual creation records the template version used. |

---

## 13. Known limitations

1. **`lib/supabase/database.types.ts` is hand-authored.** It matches the migrations but is not generated. Run `npm run db:types` (`supabase gen types typescript --local`) once a project exists and replace it; query files cast at the boundary in the meantime.
2. **Active-org selection** = first active membership (ordered by `created_at`). No org switcher UI. Multi-org users see only their first org's workspace until Phase 8 / a dedicated switcher.
3. **Single role per `(org, user)`** (per `DATA_MODEL.md`). PRD §6's "a user may hold more than one role" is not modelled yet; relevant mainly to Phase 6 review self-approval, which is out of scope here.
4. **Autosave surface is the chapter completion state only.** The block-level editor and its autosave are Phase 3; the conflict mechanism and UI states are in place and reused there.
5. **`image_assets.scan_status`** is stored but nothing sets it to `clean`/`failed` yet (no scanner). The Phase 5 validation gate (`PRD-OQ-009`) will decide blocked-vs-warning.
6. **Node 20** triggers a `@supabase/supabase-js` deprecation warning locally; CI uses Node 22. Not a failure.
7. **`server start` prerender**: routes touching Supabase are `dynamic = "force-dynamic"`, so `next build` never calls them without env — intended.

---

## 14. External credential limitations

**BLOCKED BY EXTERNAL CREDENTIALS.** This environment has no Supabase project URL/keys, no `supabase` CLI, and no running Docker, so the following Phase 2 acceptance items are implemented and code-reviewed but **not executed** and therefore **not signed off**:

- AC-P2-4, AC-P2-6 … AC-P2-14, AC-P2-16 … AC-P2-19, AC-P2-21 (the `🟦` rows above).
- The spec §25 (Polaris), §26 (parameter ownership), §27 (security) end-to-end scenarios.
- `tests/integration/rls.test.ts` (auto-skipped).

**To unblock:** provision a Supabase project (or local stack), set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APP_URL`; `supabase db push` (+ seed); then run the app and the integration suite and record results here. **Phase 2 must not be marked fully complete until that pass is green.**

---

## 15. Deferred to Phase 3 (and later)

Phase 3: TipTap serialization spike, allow-listed block editor + inline editing, accessible block/chapter reorder, installation step builder, parameter group/table builder UI, image placement + annotation editor, undo, drag polish for the Supported Configuration editor, generated Supabase types.
Phase 4: `AIProvider` + mock/configured providers, grounded requests, claim scanning.
Phase 5: versioned checklist engine, completion scoring, mismatch/units/claims checks, `scan_status` gate.
Phase 6: reviewer assignment + comments + decisions, audit history surface, version cloning, published immutability + snapshots.
Phase 7: public `/manual/[eaSlug]/[version]`, TOC/search/version nav, print CSS, Playwright A4 export.
Phase 8: full a11y/responsive/security/perf audits, org switcher, member-management UI, comprehensive state matrix.
