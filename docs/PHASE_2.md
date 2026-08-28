# Phase 2 completion report — Data & CRUD

> **Status: corrections applied after a failed review.** All ten review findings are addressed
> in the implementation (not by editing docs). `lint`, `typecheck`, `test`, and `build` pass.
>
> **Credential state:** app-runtime Supabase credentials are now present (`.env.local`, provided
> by the reviewer — gitignored, never committed). The project is reachable and `/api/health`
> returns `ready:true`. However the **database schema has not been applied** to that project and
> cannot be from this environment (no DB connection string / `SUPABASE_ACCESS_TOKEN` — only the
> `sb_publishable_` / `sb_secret_` API keys, which cannot run DDL). So the live integration
> suite still cannot run. Schema-dependent acceptance criteria remain **BLOCKED** and are not
> marked passed. See [§14](#14-external-credential-limitations).
>
> Baseline: `docs/IMPLEMENTATION_PLAN.md` Phase 2, `docs/ACCEPTANCE_CRITERIA.md` Phase 2,
> corrected `docs/DATA_MODEL.md`. No Phase 3+ functionality was implemented.

---

## 0. Review findings — how each was fixed

| # | Finding | Fix |
|---|---|---|
| **1** | RLS gave every member full write access; reviewers could bypass server actions | `20260901000500_rls.sql` rewritten: content-table `INSERT/UPDATE/DELETE` gated on `app.can_author(org)` (DEVELOPER or ADMIN); `TECHNICAL_REVIEWER` / `COMPLIANCE_REVIEWER` get `SELECT` only. `memberships` / org / templates writes gated on `app.is_admin(org)`. Storage writes gated on `can_author`, reads on membership. New integration tests: reviewer cannot `UPDATE manual_sections`, cannot `INSERT/UPDATE ea_parameters`, cannot `INSERT manual_blocks`; developer cannot write `memberships` / `manual_template_sections`. |
| **2** | SECURITY DEFINER RPCs checked membership but not role; cross-org copy possible | New `app.assert_author(org)` (membership **+** `can_author`) is called first in every public RPC (`create_ea_version_with_setups`, `create_manual_with_version`, `create_product_version_manual`, `replace_ea_version_setups`, `reorder_*`). `app.copy_parameter_definitions` now requires **source org == target org** and `can_author(target)`. `app.instantiate_sections_from_template` requires `can_author(org)`. `EXECUTE` on the privileged `app.*` helpers is **revoked from `public`** (kept for `service_role`; the public SECURITY DEFINER RPCs still call them as owner). Trusted backend sessions (`auth.uid()` NULL: service_role, seed, migrations) skip the role gate — they already bypass RLS. New integration tests: reviewer + cross-org RPC calls all rejected; cross-org `copy_parameter_definitions` rejected. |
| **3** | AC-P2-15 needs real Block CRUD, not just Zod schemas | New `features/blocks/actions.ts`: `createBlock`, `updateBlock` (row_version-guarded → CONFLICT), `softDeleteBlock`, `restoreBlock` (restores to end), `reorderBlocks` (transactional via `public.reorder_manual_blocks`). Every payload passes `blockPayloadSchema` at the write boundary; `parameter_group_ids` derived from the `parameterTable` payload feeds the ownership trigger; positions stay non-negative and unique among live blocks (partial unique index). Integration test does the full insert → transactional reorder → soft-delete round-trip. |
| **4** | Manual creation used a permanently-hardcoded 18-row source instead of the template tables | New migration `20260901000350_system_template.sql` installs the canonical system template (`manual_templates` v1, `organization_id NULL`) **and** its 18 `manual_template_sections`. `app.instantiate_sections_from_template(manual_version_id, template_id)` reads that table. `public.create_manual_with_version` resolves the **active** system template, records `manuals.template_id` + `manual_versions.template_version`, and instantiates from that exact version. No caller passes a null template. Integration test proves the instantiated section set equals the template's. |
| **5** | AC-P2-9b needs pointer drag; `replaceSupportedSetups` was non-atomic | `setup-editor.tsx` now has an HTML5 drag handle (`draggable` grip, `onDragStart/Over/Drop`) **and** keeps keyboard up/down buttons. `replaceSupportedSetups` delegates to the new atomic RPC `public.replace_ea_version_setups` (DELETE + re-INSERT in one function body). Integration test: a replace that violates the unique constraint rolls back and leaves the previous list intact. |
| **6** | AC-P2-19 requires image dimensions | New dependency-free `lib/domain/image-dimensions.ts` parses PNG / JPEG / GIF / WebP headers. `uploadManualImage` reads the file bytes, extracts `width`/`height`, rejects an unreadable header, and persists both to `image_assets`. Accepted formats validated against `DATA_MODEL.md` + the bucket config. Unit tests for all four formats + corrupt input. |
| **7** | Parameter CRUD incomplete | `features/parameters/actions.ts` now has: group `create` / `rename` / `reorder` (`reorder_parameter_groups` RPC) / `delete` (refused while a `parameterTable` block references it); parameter `create` (auto-position) / `read` / `update` / `reorder` (`reorder_ea_parameters` RPC) / `delete`. New `features/parameters/parameter-manager.tsx` is a minimal functional management surface on `/ea-products/[productId]` so the CRUD is exercisable from the app (not the Phase 3 editor). |
| **8** | Multi-role contradiction was only a "known limitation" | **Implemented.** `memberships` unique is now `(organization_id, user_id, role)` — normalised, one auditable row per role. New helpers `app.member_roles()`, `app.has_role()`, `app.can_author()`, `app.is_admin()`. `getWorkspaceContext` returns `activeOrg.roles: OrgRole[]`; `requireActiveOrg()` returns `roles`; every server action calls `assertCan(roles, action)` (already array-aware). App shell / settings show all roles. Seed gives the demo developer both `DEVELOPER` and could hold reviewer roles. Unit tests cover multi-role authoring + admin-only gating. |
| **9** | Expand the integration suite; don't mark credential-gated tests passed | `tests/integration/rls.test.ts` rewritten into 9 `describe.skipIf`-gated groups: cross-org isolation, reviewer direct-mutation denial, privileged-RPC denial, cross-org `copy_parameter_definitions` denial, developer-vs-admin, required-section protection, atomic setup replacement, block CRUD round-trip, template instantiation, parameter-ownership propagation, private-image access. **All still skipped** (schema not applied) and reported as BLOCKED, never passed. |
| **10** | Documentation accuracy | This file rewritten. The acceptance table below marks a MUST ✅ only where it is actually implemented **and** verified at the stated level; everything needing a live schema is 🟦 BLOCKED. |

---

## 1. Completed scope (post-corrections)

| Area | Delivered |
|---|---|
| **Schema** | 8 migrations (`supabase/migrations/`): core + multi-role helpers, EA facts, manual content, **system template + sections**, functions/guards, **role-aware RLS**, atomic-creation + reorder + atomic-replace RPCs. |
| **RLS** | Role-aware. Content: members read, `can_author` writes. Admin: memberships/org/templates. Append-only `audit_events`. Storage: members read, `can_author` write. Cross-org impossible for every role. |
| **RPC security** | `app.assert_author` in every public RPC; `app.*` helpers `EXECUTE`-revoked from `public`; `copy_parameter_definitions` cross-org guard; `instantiate_sections_from_template` author guard. |
| **Auth / org / roles** | Supabase Auth cookie SSR; multi-role `memberships`; `getWorkspaceContext` → user + memberships (roles[]) + active org; `/login`, `/no-membership`, not-configured states; `/api/health` readiness. |
| **Action authz** | `lib/permissions/actions.ts` — `Action` union, `ROLE_ACTIONS`, `canAny` / `assertCan(roles, action)` in every mutation. |
| **EA Product CRUD** | create (slug unique/org), update, archive (soft). `/ea-products` list + `/ea-products/[productId]` detail. |
| **EA Version CRUD** | create (semver, `(product,platform,version)` unique, structured `requirements`/`support`); historical versions preserved. |
| **Supported Configuration** | `ea_version_setups`; functional editor with **drag + keyboard reorder**; atomic replace via RPC; broker-suffix symbols; controlled MT timeframe; Tested Minimum Lot labelled + broker-spec note (GI-10/12). |
| **Parameter CRUD** | Groups: create/rename/reorder/delete. Parameters: create/read/update/reorder/delete. Owned by EA Version. Minimal management UI. |
| **Manual + Manual Version** | wizard (existing-EA, new-EA atomic); first version instantiated from the **active template version**, recorded on the manual version. `(manual,version)` unique; one `ea_version` FK. |
| **Sections & Blocks** | canonical sections from the template; full block CRUD + soft delete + restore + transactional reorder; Zod payload validation at every write; ownership trigger for `parameterTable`. |
| **Image upload** | private bucket, `<org>/<id>.<ext>` key, `image_assets` with mime/size/**width/height**/scan_status; render path signs short-lived URLs. |
| **Dynamic routing** | `/manuals/[manualId]/edit` + `/preview` via `SupabaseManualDataSource` + typed `ManualViewModel`; unknown id → `notFound()`; no hardcoded VMax. |
| **Autosave** | `row_version`-guarded UPDATE → CONFLICT never silent overwrite; 5 UI states. |
| **Mock removal** | `mock-data.ts` deleted; `localStorage` not a data source. |
| **Tests + CI** | 56 unit tests, 19 skipped (BLOCKED) integration; `.github/workflows/ci.yml` npm ci → lint → typecheck → test → build on Node 22. |

### Explicitly NOT implemented (Phase 3+ boundary)

TipTap / visual editor, drag-drop *document* editing, AI, validation/compliance engine, review workflow & comments, publishing & snapshots, public route behaviour, PDF export, image annotation editor, admin template-editing UI, member-management UI, org switcher, Phase 6 version cloning.

---

## 2. Database schema & migrations

| File | Contents |
|---|---|
| `…100_core.sql` | `pgcrypto`, `app` schema, `touch_updated_at()` / `bump_row_version()`; `membership_role` enum; `organizations`; `profiles` (+ `on_auth_user_created`); `memberships` **unique `(organization_id, user_id, role)`**; helpers `member_org_ids`, `has_org_access`, `member_roles`, `has_role`, `can_author`, `is_admin`; `audit_events`. |
| `…200_ea.sql` | `ea_platform`, `mt_timeframe`, `ea_param_type`, `ea_param_mutability`; `ea_products`, `ea_versions`, `ea_version_setups`, `parameter_groups`, `ea_parameters` — parameters/setups FK `ea_versions`, never `manual_versions`. |
| `…300_manuals.sql` | `manual_status`, `manual_block_type`, `image_scan_status`, `section_completion_state`; `manual_templates` + `manual_template_sections`; `image_assets` (width/height columns); `manuals`; `manual_versions` (`row_version`, one `ea_version` FK); `manual_sections`; `manual_blocks` (partial unique live-position, `row_version`). |
| `…350_system_template.sql` | **System template v1 (`organization_id NULL`) + its 18 sections.** Structural, not demo seed. |
| `…400_functions_triggers.sql` | `instantiate_sections_from_template` (reads the template table, author-guarded) + `instantiate_manual_sections` shim; `guard_required_section_delete`; `guard_published_manual_version`; `guard_parameter_table_ownership`; `copy_parameter_definitions` (same-org + author guard). |
| `…500_rls.sql` | RLS on all tables; **role-aware** content policies (`can_author` writes), admin policies (`is_admin`), append-only audit, `can_author` storage writes. |
| `…600_rpc.sql` | `app.assert_author`; `create_ea_version_with_setups`, `replace_ea_version_setups` (atomic), `create_manual_with_version` (template-resolving), `create_product_version_manual` (atomic), `reorder_manual_blocks`, `reorder_parameter_groups`, `reorder_ea_parameters`. Grants: public RPCs → `authenticated` + `service_role`; `app.*` privileged helpers → `service_role` only (`EXECUTE` revoked from `public`). |

`supabase/seed.sql` — demo org A + org B, 4 demo auth users (`*@smartin.demo` / `demo-password-123`, LOCAL ONLY), multi-role memberships (`on conflict (organization_id, user_id, role)`), VMax EA / MT5 / 1.0.0, two setups, one parameter group + three parameters, one manual + version + sections (from the system template).

### Reproducing a clean project

```bash
# local (Docker + supabase CLI)
supabase start && supabase db reset      # migrations/ then seed.sql

# hosted — REQUIRES a DB admin credential (not just the API keys):
supabase link --project-ref <ref>        # needs SUPABASE_ACCESS_TOKEN
supabase db push                          # applies migrations/
#   then create auth users + run the non-auth part of seed.sql
```

---

## 3. Ownership model (as built)

```
EAProduct → EAVersion → EAVersionSetup            (ea_version_setups.ea_version_id)
                      → EAParameterGroup           (parameter_groups.ea_version_id)
                          → EAParameter            (ea_parameters.parameter_group_id)
Manual → ManualVersion (→ one EAVersion) → ManualSection → ManualBlock
```

Parameter definitions and setups **never** carry `manual_version_id`. `guard_parameter_table_ownership` restricts a `parameterTable` block to groups of its manual version's linked EA version. Two manual versions on one EA version share the same rows (no copy step). Verified by `tests/unit/schema-parity.test.ts`; runtime propagation verified by the (blocked) integration test.

---

## 4. Supported Configuration (GI-10 / GI-12)

`ea_version_setups`: `symbol` (verbatim, broker-suffix regex), `timeframe` (`mt_timeframe` enum — free text impossible at DB and UI), `preset_ref?`, `tested_minimum_lot?` (`>= 0`, nullable, independent of broker rules), `notes?`, `is_supported`, `position`; unique `(ea_version_id, symbol, timeframe)`. No code path infers a `symbol × timeframe` pair. Editor: drag handle + keyboard up/down; the note **"Minimum lot aktual ditentukan oleh spesifikasi simbol pada broker."** and "data uji developer" label appear in the editor, wizard, version form, and rendered Chapters 2 & 9. Replace is atomic (`replace_ea_version_setups`).

---

## 5. Auth, membership & multi-role permissions

- `middleware.ts` refreshes the SSR session (no-op when unconfigured). *(Next 16 prints a `middleware`→`proxy` rename notice; `middleware.ts` still works and the build passes. Renaming is a follow-up housekeeping item.)*
- `lib/supabase/{server,client,service}.ts` — cookie-bound server client (RLS applies), browser client (publishable key), **server-only** service client (secret key; RLS-bypassing; seeding / atomic RPC paths).
- `SUPABASE_SECRET_KEY` is read only in `lib/env.ts` + `lib/supabase/service.ts` (`import "server-only"`). Verified absent from `.next/static` with the real key (AC-P2-3 ✅).
- **Multi-role:** `activeOrg.roles: OrgRole[]`; `assertCan(roles, action)` = permitted if any held role grants it. DB `app.can_author` / `app.is_admin` mirror the map for RLS.

---

## 6. Autosave / conflict strategy

`row_version` bigint bumped by a `BEFORE UPDATE` trigger on `manual_versions` / `manual_sections` / `manual_blocks`. Mutations run `UPDATE … WHERE id = $id AND row_version = $expected`; 0 rows ⇒ `{ ok:false, code:"CONFLICT" }`; UI shows **"Konflik perubahan"**, never overwrites, never shows "Tersimpan" without server confirmation. Debounce 800 ms. `resolveWrite()` + the state machine are unit-tested; the two-session test is BLOCKED.

---

## 7. Dynamic routing & view model

`SupabaseManualDataSource(orgId).loadManualVersionByManualId(id)` loads every fact by explicit id; unknown/foreign id → `notFound()`. `manualIdentity(vm)` feeds builder header, inspector, preview header, and cover from one object. `ManualRenderer` + `ManualBuilder` take `{ vm }` — no hardcoded product.

---

## 8. Tests

`npm run test` → **56 passed, 19 skipped** (7 files).

| File | Covers |
|---|---|
| `tests/unit/permissions.test.ts` | role→action map; `assertCan` typed errors; **multi-role** authoring + admin-only gating (AC-P2-22, PRD §6). |
| `tests/unit/domain.test.ts` | semver; MT timeframe control; broker-suffix symbols + normalisation; setup list (3 configs distinct, `EURUSD/M15` not implied, dup rejected, unknown TF/empty rejected, `tested_minimum_lot` optional/≥0); 6 block payloads + unknown-type/raw-HTML rejection; parameter identifier/type; canonical 18 sections; `resolveWrite` match/stale/missing. |
| `tests/unit/view-model.test.ts` | assembler null-safety; Polaris never shows VMax; deterministic sort. |
| `tests/unit/positions.test.ts` | `nextPosition`, `validateReorder` (count/dup/unknown). |
| `tests/unit/image-dimensions.test.ts` | PNG/JPEG/GIF/WebP header parsing + corrupt input (AC-P2-19). |
| `tests/unit/schema-parity.test.ts` | SQL↔TS enums; parameter/setup FK & uniqueness; **system template = canonical sections & read from the table**; **RLS write policies require `can_author`, no blanket member write**; **multi-role unique tuple**; **every RPC calls `assert_author`**; **`app.*` helper `EXECUTE` revoked from `public`**; **cross-org `copy_parameter_definitions` guard**; **`instantiate_sections_from_template` author guard**; **atomic `replace` uses the RPC**; **`uploadManualImage` persists width/height**; **block CRUD actions exist + validate payloads**. |
| `tests/integration/rls.test.ts` | **skipped (BLOCKED)** — 9 groups: cross-org isolation; reviewer direct-mutation denial; privileged-RPC denial; cross-org copy denial; dev-vs-admin; required-section protection; atomic setup replace; block CRUD round-trip; template instantiation; parameter propagation; private-image access. |

### Running the integration tests (needs the schema applied)

```bash
# apply supabase/migrations + supabase/seed.sql to the project, then:
SUPABASE_TEST_URL=https://<ref>.supabase.co \
SUPABASE_TEST_ANON_KEY=<sb_publishable_...> \
SUPABASE_SECRET_KEY=<sb_secret_...> \
npm run test -- tests/integration/rls.test.ts
```

---

## 9. CI

`.github/workflows/ci.yml` — Node 22: `npm ci → lint → typecheck → test → build` (build runs with empty Supabase env to prove it survives an unconfigured project).

---

## 10. Local verification performed

| Check | Result |
|---|---|
| `npm run lint` | ✅ 0 warnings/errors |
| `npm run typecheck` | ✅ pass |
| `npm run test` | ✅ 56 passed, 19 skipped (BLOCKED integration) |
| `npm run build` | ✅ pass, 18 routes |
| `GET /api/health` — no env | ✅ 503, `ready:false`, per-var checks false |
| `GET /api/health` — all env (real `.env.local`) | ✅ 200, `ready:true`, all checks true → **AC-P2-2 fully verified** |
| Secret key in client bundle (real `sb_secret_` key) | ✅ **0 occurrences** in `.next/static` → **AC-P2-3 verified** |
| `/` / `/login` / `/dashboard` (configured, no session) | ✅ 307→/login (guard) / 200 / 307→/login |

**Not performed** (schema not applied to the live project — see §14): migration/seed apply, auth sign-in, every CRUD round-trip, RLS/role enforcement, RPC denial, image signed-URL, two-session autosave, and the Polaris / parameter-ownership / cross-org end-to-end scenarios.

---

## 11. Acceptance criteria results

Legend: ✅ implemented & verified at the stated level · 🟦 implemented, verification BLOCKED (needs the schema applied) · ⬜ SHOULD / Phase boundary.

| ID | Result | Note |
|---|---|---|
| AC-P2-1 | ✅ / 🟦 | GI-3/4/5/6/7 ✅. GI-10/11/12 ✅ at schema + unit level; runtime UI-scan 🟦. |
| AC-P2-2 | ✅ | Verified both directions against the real project. |
| AC-P2-3 | ✅ | `sb_secret_` key absent from `.next/static` (real key). |
| AC-P2-4 | 🟦 | Sign-in/out + generic error + cookie SSR implemented; needs the schema (profiles/memberships) to exercise. |
| AC-P2-5 | ✅ | `/no-membership` guard verified via the configured-no-session redirect path. |
| AC-P2-6 | 🟦 | `createEaProduct` + slug uniqueness + inline mapping. |
| AC-P2-7 | 🟦 | `createEaVersion` + `(product,platform,version)` unique; semver unit-tested. |
| AC-P2-8 | 🟦 | `requirements`/`support` JSON round-trip; symbols/timeframes are `ea_version_setups` (parity test ✅). |
| AC-P2-9 | 🟦 | `create_ea_version_with_setups` one row per config; 3-config distinctness unit-tested. |
| AC-P2-9a | ✅ / 🟦 | No inference path (unit-tested); full output scan 🟦. |
| AC-P2-9b | ✅ / 🟦 | Editor now has **pointer drag + keyboard** reorder, suffix symbols, controlled TF, inline dup rejection — built + unit-tested; e2e 🟦. |
| AC-P2-9c | ✅ | Broker-min-lot note + "data uji developer" labels present in editor, wizard, version form, renderer. |
| AC-P2-10 | ✅ / 🟦 | Section set now comes from the **versioned template table** (parity test: template = canonical set, instantiation reads the table). Runtime instantiation 🟦. |
| AC-P2-11 | 🟦 | New-EA path is one transactional RPC (`create_product_version_manual`). |
| AC-P2-12 | ✅ / 🟦 | View-model isolation unit-tested (Polaris ≠ VMax); full e2e 🟦. |
| AC-P2-13 | 🟦 | `(manual_id, version)` unique + friendly mapping. |
| AC-P2-14 | 🟦 | `guard_required_section_delete` trigger + `manual:update` gate + integration test written. |
| AC-P2-15 | ✅ / 🟦 | **Block CRUD server actions** (`createBlock`/`updateBlock`/`softDeleteBlock`/`restoreBlock`/`reorderBlocks`) with `blockPayloadSchema` at the write boundary — built + parity-tested + payload unit-tested. DB round-trip 🟦. |
| AC-P2-16 | ✅ / 🟦 | Non-negative + partial-unique live-position index; `validateReorder` + `reorder_manual_blocks` two-phase RPC — unit-tested; DB 🟦. |
| AC-P2-17 | ✅ / 🟦 | `softDeleteBlock` + `restoreBlock` (restore-to-end) implemented; unit/parity-tested; DB 🟦. |
| AC-P2-18 | 🟦 | Full `ea_parameters` column set; create/update. |
| AC-P2-18a | ✅ / 🟦 | Parity test: FK `ea_versions`, no `manual_version_id`; `guard_parameter_table_ownership` rejects foreign groups. Runtime 🟦. |
| AC-P2-18b | 🟦 | No copy step; integration propagation test written. |
| AC-P2-18c | 🟦 | `copy_parameter_definitions` is EA-version→EA-version, **now same-org + author guarded** (parity test); cross-org denial integration test written. |
| AC-P2-19 | ✅ / 🟦 | `width`/`height` extracted from the header and persisted (parity test + 4 format unit tests). Private storage round-trip / signed-URL expiry 🟦. |
| AC-P2-20 | ✅ / 🟦 | `row_version`-guarded UPDATE + `resolveWrite` unit-tested; 5 UI states. Two-session test 🟦. |
| AC-P2-21 | ✅ (schema-level) / 🟦 (runtime) | **RLS is now role-aware** (parity test: `can_author` writes, no blanket member write, `is_admin` for admin tables). Runtime cross-org + reviewer-denial in the (blocked) integration suite. |
| AC-P2-22 | ✅ | `assertCan(roles, …)` typed-error unit tests, incl. multi-role. |
| AC-P2-23 | ✅ | `mapPostgrestError` + `error.tsx` emit human messages; `writeAudit` logs action/entity, not contents. |
| AC-P2-24 | ✅ / 🟦 | Pages read from `features/*/queries.ts`; `mock-data.ts` deleted. Live data render 🟦. |
| AC-P2-25 | ✅ | Vitest + Testing Library green in CI; slug/version mapping, permission map, autosave conflict, reorder, image dims all covered. |
| AC-P2-26 | ✅ / 🟦 | `manual_templates`/`_sections` versioned + seeded by migration; `create_manual_with_version` records `template_id` + `template_version`. Runtime 🟦. |
| AC-P2-27 | ✅ | Decisions in §12; the multi-role question resolved by implementing it. |

**No MUST is marked ✅ solely on the strength of a Zod schema or a code path that a live DB has not exercised.**

---

## 12. Open-question decisions (AC-P2-27)

| OQ | Decision |
|---|---|
| **PRD-OQ-001 — styling** | Keep the bespoke `app/globals.css` token stylesheet; Phase 2 additions are a scoped block using the same tokens. No Tailwind utilities / shadcn. |
| **PRD-OQ-003 — auth route group** | Keep `app/login/` (no `(auth)` group); `/login` + `/no-membership` at app root. |
| **PRD-OQ-006** | Already resolved in the PRD; implemented as specified. |
| **PRD-OQ-012 — template editing depth** | Phase 2 ships versioned template **tables** + the seeded system template + version-recording on manual creation. No admin editing UI (a later admin surface owns `template:manage`). |
| **Multi-role model** (review finding 8 — was a "known limitation", not a numbered OQ) | **Implemented**: normalised `memberships` unique `(org, user, role)`, `app.can_author`/`is_admin`, `roles[]` through `getWorkspaceContext` / `assertCan`. `docs/DATA_MODEL.md` updated to match. |

---

## 13. Known limitations

1. `lib/supabase/database.types.ts` is hand-authored (matches the migrations); run `npm run db:types` against a real project once the schema exists and replace it. Query files cast at the boundary meanwhile.
2. Active org = first membership by `created_at`; no org switcher.
3. Autosave's editable surface is the chapter completion state; the block editor UI is Phase 3 (the block **data** CRUD + conflict mechanism exist now).
4. `image_assets.scan_status` is stored; no scanner sets it yet (`PRD-OQ-009` → Phase 5).
5. Next 16 prints a `middleware`→`proxy` rename advisory; `middleware.ts` still works and builds. Rename is a housekeeping follow-up.
6. `parameter-manager.tsx` is a deliberately minimal CRUD surface for testability, not the Phase 3 editor.

---

## 14. External credential limitations

**Runtime credentials: PRESENT** (`.env.local`, reviewer-provided, gitignored). `/api/health` → `ready:true`; AC-P2-2 and AC-P2-3 verified against the real project.

**Schema application: BLOCKED.** The project has **no tables yet** (`GET /rest/v1/organizations` → 404) and this environment cannot apply `supabase/migrations`:
- only the `sb_publishable_` / `sb_secret_` API keys are available — these do CRUD/RPC via PostgREST but **cannot run DDL**;
- no Postgres connection string / DB password, and no `SUPABASE_ACCESS_TOKEN`, so `supabase db push` / `supabase link` cannot run;
- no local Docker for `supabase start`.

**Consequently BLOCKED (implemented + reviewed, not executed, NOT signed off):** AC-P2-4, 6–14, 16 (DB), 17 (DB), 18, 18a (runtime), 18b, 18c, 19 (storage), 20 (two-session), 21 (runtime), 24 (render), 26 (runtime); spec §25 (Polaris), §26 (parameter ownership), §27 (security) end-to-end; the entire `tests/integration/rls.test.ts` suite.

**To unblock:** supply a DB connection string **or** a `SUPABASE_ACCESS_TOKEN` for the project, then `supabase db push` + apply the seed, run the integration suite, and record results in §10–11. **Phase 2 is not fully complete until that pass is green.**

---

## 15. Deferred to Phase 3 (and later)

Phase 3: TipTap spike + visual block editor, accessible in-editor reorder, installation step builder, parameter table builder UI, image placement + annotation editor, undo, generated Supabase types. Phase 4: AI. Phase 5: checklist engine, `scan_status` gate. Phase 6: reviews, decisions, cloning, immutable snapshots. Phase 7: public route, PDF. Phase 8: audits, org switcher, member/template admin UI.
