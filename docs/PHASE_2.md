# Phase 2 completion report — Data & CRUD

> **Status: implemented, corrected after two review passes, and verified live against Supabase DEV.**
> Pass 1 (findings in [§0](#0-review-findings--how-each-was-fixed)) and pass 2
> (findings in [§0b](#0b-correction-pass-2--how-each-was-fixed)) are addressed in the implementation.
> `lint`, `typecheck`, `test`, and `build` pass.
>
> **Live DEV verification ([§0c](#0c-live-dev-verification-2026-08-29)):** the Phase 2 schema —
> including `20260901000700_grant_phase2_data_api_access.sql` — is deployed to the Supabase DEV
> project. Hosted test identities and repeatable fixtures exist. The app authenticates
> `developer@smartin.demo` and resolves organisation memberships. `/api/health` returns
> `ready:true`, the `sb_secret_` key is verified absent from the client bundle, and every response
> carries an `x-request-id`.
>
> `npx vitest run tests/integration/rls.test.ts` against DEV → **27 passed / 0 failed / 0 skipped**
> (RLS, RPC authorisation, relational integrity, storage, template instantiation, parameter
> ownership, multi-role). No credentials or secret values are recorded in this document.
>
> Baseline: `docs/IMPLEMENTATION_PLAN.md` Phase 2, `docs/ACCEPTANCE_CRITERIA.md` Phase 2,
> corrected `docs/DATA_MODEL.md`. No Phase 3+ functionality was implemented.

---

## 0. Review findings — how each was fixed

| # | Finding | Fix |
|---|---|---|
| **1** | RLS gave every member full write access; reviewers could bypass server actions | `20260901000500_rls.sql` rewritten: content-table `INSERT/UPDATE/DELETE` gated on `app.can_author(org)` (DEVELOPER or ADMIN); `TECHNICAL_REVIEWER` / `COMPLIANCE_REVIEWER` get `SELECT` only. `memberships` / org / templates writes gated on `app.is_admin(org)`. Storage writes gated on `can_author`, reads on membership. New integration tests: reviewer cannot `UPDATE manual_sections`, cannot `INSERT/UPDATE ea_parameters`, cannot `INSERT manual_blocks`; developer cannot write `memberships` / `manual_template_sections`. |
| **2** | SECURITY DEFINER RPCs checked membership but not role; cross-org copy possible | New `app.assert_author(org)` (membership **+** `can_author`) is called first in every public RPC (`create_ea_version_with_setups`, `create_manual_with_version`, `create_product_version_manual`, `replace_ea_version_setups`, `reorder_*`) and in `copy_parameter_definitions` / `instantiate_sections_from_template`. `copy_parameter_definitions` additionally requires **source org == target org**. *(Pass 2 hardened the gate itself — see §0b finding 1: it no longer treats a null `auth.uid()` as trusted, and `EXECUTE` is explicitly revoked from `PUBLIC` and `anon`, not just implicitly.)* |
| **3** | AC-P2-15 needs real Block CRUD, not just Zod schemas | New `features/blocks/actions.ts`: `createBlock`, `updateBlock` (row_version-guarded → CONFLICT), `softDeleteBlock`, `restoreBlock` (restores to end), `reorderBlocks` (transactional via `public.reorder_manual_blocks`). Every payload passes `blockPayloadSchema` at the write boundary; `parameter_group_ids` derived from the `parameterTable` payload feeds the ownership trigger; positions stay non-negative and unique among live blocks (partial unique index). Integration test does the full insert → transactional reorder → soft-delete round-trip. |
| **4** | Manual creation used a permanently-hardcoded 18-row source instead of the template tables | New migration `20260901000350_system_template.sql` installs the canonical system template (`manual_templates` v1, `organization_id NULL`) **and** its 18 `manual_template_sections`. `app.instantiate_sections_from_template(manual_version_id, template_id)` reads that table. `public.create_manual_with_version` resolves the **active** system template, records `manuals.template_id` + `manual_versions.template_version`, and instantiates from that exact version. No caller passes a null template. Integration test proves the instantiated section set equals the template's. |
| **5** | AC-P2-9b needs pointer drag; `replaceSupportedSetups` was non-atomic | `setup-editor.tsx` now has an HTML5 drag handle (`draggable` grip, `onDragStart/Over/Drop`) **and** keeps keyboard up/down buttons. `replaceSupportedSetups` delegates to the new atomic RPC `public.replace_ea_version_setups` (DELETE + re-INSERT in one function body). Integration test: a replace that violates the unique constraint rolls back and leaves the previous list intact. |
| **6** | AC-P2-19 requires image dimensions | New dependency-free `lib/domain/image-dimensions.ts` parses PNG / JPEG / GIF / WebP headers. `uploadManualImage` reads the file bytes, extracts `width`/`height`, rejects an unreadable header, and persists both to `image_assets`. Accepted formats validated against `DATA_MODEL.md` + the bucket config. Unit tests for all four formats + corrupt input. |
| **7** | Parameter CRUD incomplete | `features/parameters/actions.ts` now has: group `create` / `rename` / `reorder` (`reorder_parameter_groups` RPC) / `delete` (refused while a `parameterTable` block references it); parameter `create` (auto-position) / `read` / `update` / `reorder` (`reorder_ea_parameters` RPC) / `delete`. New `features/parameters/parameter-manager.tsx` is a minimal functional management surface on `/ea-products/[productId]` so the CRUD is exercisable from the app (not the Phase 3 editor). |
| **8** | Multi-role contradiction was only a "known limitation" | **Implemented.** `memberships` unique is now `(organization_id, user_id, role)` — normalised, one auditable row per role. New helpers `app.member_roles()`, `app.has_role()`, `app.can_author()`, `app.is_admin()`. `getWorkspaceContext` returns `activeOrg.roles: OrgRole[]`; `requireActiveOrg()` returns `roles`; every server action calls `assertCan(roles, action)`. App shell / settings show all roles. Unit tests cover multi-role authoring + admin-only gating. *(Pass 2 added the live fixture — see §0b finding 8.)* |
| **9** | Expand the integration suite; don't mark credential-gated tests passed | `tests/integration/rls.test.ts` rewritten into `describe.skipIf`-gated groups. *(Pass 2 removed every silent `if (!SECRET) return;`, added the anon-RPC / compliance-reviewer / relational-integrity / image-fixture groups, and fixed the cross-org copy attack — see §0b findings 4, 5.)* The suite was left gated (never marked passed) until it could run live; it has since been executed against Supabase DEV — **27 passed / 0 failed / 0 skipped** ([§0c](#0c-live-dev-verification-2026-08-29)). |
| **10** | Documentation accuracy | This file rewritten. The acceptance table below marks a MUST ✅ only where it is actually implemented **and** verified at the stated level. Criteria whose only outstanding evidence is a UI/e2e pass (not a database check) are marked accordingly — see [§11](#11-acceptance-criteria-results). |

---

## 0b. Correction pass 2 — how each was fixed

| # | Finding | Fix |
|---|---|---|
| **1** | `app.assert_author` treated `auth.uid() IS NULL` as a trusted backend — but an anonymous request is also null. Also PostgreSQL grants EXECUTE to `PUBLIC` (incl. `anon`) by default. | `app.assert_author` (moved to `…100_core.sql`) now: trusts a call **only** when `app.is_service_request()` is true (JWT `role` claim = `service_role`, or `session_user` is the DB owner for `db reset`/migrations); a null `auth.uid()` that is not a service request → `raise 'forbidden: authentication required'`. `…600_rpc.sql` ends with a do-block that `REVOKE EXECUTE … FROM PUBLIC` **and** `FROM anon` on every public mutating RPC and every privileged `app.*` helper, then `GRANT` only `authenticated`/`service_role` (public RPCs) or `service_role` (helpers). New integration group: an anon client (no sign-in) is denied on **all seven** mutating RPCs. |
| **2** | RLS only checked the child's `organization_id`; a dev could write a child (org=A) that references a parent UUID in org B. | **Composite foreign keys** at the DB layer. Every parent gains `unique (id, organization_id)`; every org-owned child FK is `(<parent>_id, organization_id) → (id, organization_id)` (`ea_versions`→`ea_products`, `ea_version_setups`/`parameter_groups`→`ea_versions`, `ea_parameters`→`parameter_groups`, `manuals`→`ea_products`, `manual_versions`→`manuals` **and** `→ea_versions`, `manual_sections`→`manual_versions`, `manual_blocks`→`manual_sections` **and** `→image_assets` via `ON DELETE SET NULL (image_asset_id)`). A cross-org parent reference is now impossible regardless of RLS/UUID knowledge. `guard_parameter_table_ownership` also checks the group's org; `guard_manual_template_org` restricts `template_id` to a system or same-org template. New integration group: an Org A dev's INSERT/UPDATE referencing an Org B parent UUID fails. |
| **3** | The app still passed `p_template_id = null`; `create_product_version_manual` passed null internally. | `features/manuals/actions.ts` now calls `resolveActiveTemplate()` and passes a **concrete** template id to both RPCs. `create_product_version_manual` takes an explicit `p_template_id uuid` (raises if null) and forwards it. `manual_versions` gains a **`template_id uuid NOT NULL`** column (immutable creation evidence) recorded alongside `template_version`; sections are instantiated from that exact template row. `docs/PHASE_2.md` no longer claims otherwise — it is now literally true. |
| **4** | Incomplete security coverage; the cross-org copy test attacked the wrong thing. | Added a `COMPLIANCE_REVIEWER` seed identity (`compliance@smartin.demo`). Integration groups now prove: both reviewer roles cannot mutate content / EA parameters / invoke the three create RPCs; anon cannot invoke any mutating RPC; DEVELOPER cannot do admin-only writes. The cross-org copy test now **creates a valid Org B product + target EA version**, then attempts `create_ea_version_with_setups(p_org=B, …, p_copy_params_from=<Org A version>)` and asserts the copy is refused **and** no Org B groups/parameters were created. |
| **5** | Tests used `if (!SECRET) return;` (a silent no-op that could look "passed"). | Every group is `describe.skipIf(!HAS_API)` or `describe.skipIf(!HAS_SERVICE)` where the flag covers **all** prerequisites. No test `return`s early. The private-image group **creates its own fixture** (uploads a real 1×1 PNG via the service client) and tests member-allowed, cross-org denial, unsigned/public-URL denial, signed-URL success, and **expiry**. The block-CRUD group runs the full create → update → reorder → soft-delete → restore chain. |
| **6** | Reorder RPCs relied on the TS `validateReorder()`; called directly they were weakly checked. | New `app.assert_reorder_list(ids, current_count)` — rejects a null id, a duplicate id, and a count mismatch — is called by all three reorder RPCs (which also keep the per-id `IF NOT FOUND` foreign-id catch). New integration group: duplicate / omitted / foreign / extra id → error **and** the original ordering is unchanged; a valid permutation succeeds. |
| **7** | `uploadManualImage` didn't check the final `storage_key` update; a failure left `pending-…`. | Rewritten: the asset id and the **final** `storage_key` are computed up front, the `image_assets` row is inserted with the final key (no `pending-…` ever), then the object is uploaded; on upload failure the row is deleted. No success path can leave an orphan row, an orphan object, or a `pending` key. New failure-path assertion. |
| **8** | The multi-role claim wasn't backed by a live fixture. | Seed: `developer@smartin.demo` holds **both** `DEVELOPER` and `TECHNICAL_REVIEWER` in org A. New integration group proves the roles aggregate, authoring capability is retained (can create an EA product), and admin capability is **not** gained (cannot insert a membership). |
| **9** | `AC-P2-23` marked ✅ without request ids; `AC-P2-26` conflated manual + checklist templates. | **Request ids implemented:** `middleware.ts` assigns/propagates `x-request-id` on request + response; `lib/observability/request-id.ts` exposes `getRequestId()` + a redacting `logServerError()`; `writeAudit` stores `metadata.requestId`; `mapPostgrestError` logs unmapped errors with it. Verified: every response carries `x-request-id`. **AC-P2-26** clarified in `docs/ACCEPTANCE_CRITERIA.md`: the **manual** template is versioned in Phase 2 (id + version recorded on the manual version); the **checklist** template is Phase 5. |

---

## 0c. Live DEV verification (2026-08-29)

The Phase 2 database was applied to the Supabase **DEV** project and the credential-gated
suite was run against it.

| Item | Result |
|---|---|
| Supabase DEV schema | `supabase/migrations/` applied remotely, including `20260901000700_grant_phase2_data_api_access.sql` (Data API table/function grants — the project has "Automatically expose new tables" = OFF, so `authenticated` / `service_role` need explicit privileges; RLS stays the authorisation boundary). |
| Hosted test identities & fixtures | Seed identities exist (`developer@`, `admin@`, `reviewer@`, `compliance@` in org A; `outsider@` in org B). `developer@` holds `DEVELOPER` + `TECHNICAL_REVIEWER`. Integration fixtures are repeatable: cross-org and same-org relational-integrity fixtures use randomised slugs and clean up after themselves. |
| App auth against DEV | The app authenticates `developer@smartin.demo` and resolves that user's organisation memberships. |
| Local runtime | Node.js 22. |
| `npx vitest run tests/integration/rls.test.ts` (DEV env) | **27 passed / 0 failed / 0 skipped** — RLS role enforcement, SECURITY DEFINER RPC authorisation (incl. anonymous denial on all 7 mutating RPCs), same-org composite-FK relational integrity, private-storage access + signed-URL expiry, template instantiation, parameter-ownership propagation, multi-role aggregation. |
| `npm run lint` / `npm run typecheck` / `npm run test` / `npm run build` | All passed. |

Integration-test corrections made during live verification (behaviour of the app, RLS, RPCs
and schema was **not** changed):

1. The multi-role assertion now filters memberships by the authenticated `developer@` user rather than reading every membership row in org A.
2. Cross-org fixtures create products with unique/randomised slugs and delete what they create, so the suite is repeatable.
3. The same-org relational-integrity fixtures are likewise repeatable and self-cleaning.

No credentials, keys, connection strings or other secret values are recorded in this document.
`npm run test` on its own (no `SUPABASE_TEST_*` env) still runs the 57 unit tests and skips
the integration suite by design — that path is credential-free for CI, not "blocked".

---

## 1. Completed scope (post-corrections)

| Area | Delivered |
|---|---|
| **Schema** | 8 migrations (`supabase/migrations/`): core + multi-role helpers, EA facts, manual content, **system template + sections**, functions/guards, **role-aware RLS**, atomic-creation + reorder + atomic-replace RPCs, **Data API table/function grants**. Applied to Supabase DEV ([§0c](#0c-live-dev-verification-2026-08-29)). |
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
| **Tests + CI** | 57 unit tests; the 27-case `tests/integration/rls.test.ts` suite **executed against Supabase DEV → 27 passed / 0 failed / 0 skipped** ([§0c](#0c-live-dev-verification-2026-08-29)). CI (`.github/workflows/ci.yml`) runs npm ci → lint → typecheck → test → build on Node 22 credential-free (integration suite skipped without `SUPABASE_TEST_*`). |

### Explicitly NOT implemented (Phase 3+ boundary)

TipTap / visual editor, drag-drop *document* editing, AI, validation/compliance engine, review workflow & comments, publishing & snapshots, public route behaviour, PDF export, image annotation editor, admin template-editing UI, member-management UI, org switcher, Phase 6 version cloning.

---

## 2. Database schema & migrations

| File | Contents |
|---|---|
| `…100_core.sql` | `pgcrypto`, `app` schema, `touch_updated_at()` / `bump_row_version()`; `membership_role` enum; `organizations`; `profiles` (+ `on_auth_user_created`); `memberships` **unique `(organization_id, user_id, role)`**; helpers `member_org_ids`, `has_org_access`, `member_roles`, `has_role`, `can_author`, `is_admin`; **`is_service_request()` + `assert_author()`** (the single mutating-RPC gate — anon denied); `audit_events`. |
| `…200_ea.sql` | EA enums; `ea_products` → `ea_versions` → {`ea_version_setups`, `parameter_groups` → `ea_parameters`}. **Same-org integrity:** every parent has `unique (id, organization_id)`; every child FK is COMPOSITE `(<parent>_id, organization_id) → (id, organization_id)`. Parameters/setups FK `ea_versions`, never `manual_versions`. |
| `…300_manuals.sql` | Manual enums; `manual_templates` + `manual_template_sections`; `image_assets` (width/height, `unique (id, organization_id)`); `manuals`; `manual_versions` (`row_version`, **`template_id NOT NULL`** + `template_version`, COMPOSITE FKs to `manuals` **and** `ea_versions`); `manual_sections`; `manual_blocks` (partial unique live-position, COMPOSITE FKs to `manual_sections` **and** `image_assets` via `ON DELETE SET NULL (image_asset_id)`). |
| `…350_system_template.sql` | **System template v1 (`organization_id NULL`) + its 18 sections.** Structural, not demo seed. |
| `…400_functions_triggers.sql` | `instantiate_sections_from_template` (reads the template table, `assert_author`-gated) + shim; `guard_required_section_delete`; `guard_published_manual_version`; `guard_parameter_table_ownership` (EA-version **and** org check); **`guard_manual_template_org`** (template must be system or same-org); `copy_parameter_definitions` (same-org + `assert_author`). |
| `…500_rls.sql` | RLS on all tables; **role-aware** — content `INSERT/UPDATE/DELETE` require `app.can_author`, admin tables require `app.is_admin`, append-only audit, `can_author` storage writes, no blanket member-write policy. |
| `…600_rpc.sql` | `create_ea_version_with_setups`, `replace_ea_version_setups` (atomic), `create_manual_with_version` (records `template_id`+version), `create_product_version_manual` (explicit `p_template_id`), + `app.assert_reorder_list` and the three `reorder_*` RPCs (independent null/dup/count/foreign checks, two-phase). **Grant block:** `REVOKE EXECUTE … FROM PUBLIC` **and** `FROM anon` on every public RPC + privileged `app.*` helper, then `GRANT` only `authenticated`/`service_role` (RPCs) or `service_role` (helpers). |
| `…700_grant_phase2_data_api_access.sql` | **Data API privileges.** The Supabase project has "Automatically expose new tables" = OFF, so PostgREST roles need explicit privileges: table `SELECT/INSERT/UPDATE/DELETE` for `authenticated` on the 16 Phase 2 tables (read-only where writes are RPC-only), full grants for `service_role`, `USAGE` on schema `app` + `EXECUTE` on the six read-only `app.*` membership helpers for `authenticated`/`service_role`. **RLS remains the authorisation boundary** for `authenticated`; this migration only makes the tables reachable through the Data API. |

`supabase/seed.sql` — demo org A + org B, **5** demo auth users (`*@smartin.demo` / `demo-password-123`, LOCAL ONLY) incl. `compliance@` (COMPLIANCE_REVIEWER); **`developer@` holds DEVELOPER + TECHNICAL_REVIEWER** (multi-role fixture); VMax EA / MT5 / 1.0.0, two setups, one parameter group + three parameters, one manual + version (with `template_id`) + sections from the system template.

### Reproducing a clean project

```bash
# local (Docker + supabase CLI)
supabase start && supabase db reset      # migrations/ then seed.sql

# hosted (done for Supabase DEV — see §0c):
supabase link --project-ref <ref>        # needs SUPABASE_ACCESS_TOKEN
supabase db push                          # applies migrations/ incl. …700 grants
#   then create the auth users + run the non-auth part of seed.sql
```

---

## 3. Ownership model (as built)

```
EAProduct → EAVersion → EAVersionSetup            (ea_version_setups.ea_version_id)
                      → EAParameterGroup           (parameter_groups.ea_version_id)
                          → EAParameter            (ea_parameters.parameter_group_id)
Manual → ManualVersion (→ one EAVersion) → ManualSection → ManualBlock
```

Parameter definitions and setups **never** carry `manual_version_id`. `guard_parameter_table_ownership` restricts a `parameterTable` block to groups of its manual version's linked EA version. Two manual versions on one EA version share the same rows (no copy step). Verified by `tests/unit/schema-parity.test.ts`; runtime propagation verified live against Supabase DEV by `tests/integration/rls.test.ts` ([§0c](#0c-live-dev-verification-2026-08-29)).

---

## 4. Supported Configuration (GI-10 / GI-12)

`ea_version_setups`: `symbol` (verbatim, broker-suffix regex), `timeframe` (`mt_timeframe` enum — free text impossible at DB and UI), `preset_ref?`, `tested_minimum_lot?` (`>= 0`, nullable, independent of broker rules), `notes?`, `is_supported`, `position`; unique `(ea_version_id, symbol, timeframe)`. No code path infers a `symbol × timeframe` pair. Editor: drag handle + keyboard up/down; the note **"Minimum lot aktual ditentukan oleh spesifikasi simbol pada broker."** and "data uji developer" label appear in the editor, wizard, version form, and rendered Chapters 2 & 9. Replace is atomic (`replace_ea_version_setups`).

---

## 5. Auth, membership & multi-role permissions

- `middleware.ts` refreshes the SSR session (no-op when unconfigured). *(Next 16 prints a `middleware`→`proxy` rename notice; `middleware.ts` still works and the build passes. Renaming is a follow-up housekeeping item.)*
- `lib/supabase/{server,client,service}.ts` — cookie-bound server client (RLS applies), browser client (publishable key), **server-only** service client (secret key; RLS-bypassing; seeding / atomic RPC paths).
- `SUPABASE_SECRET_KEY` is read only in `lib/env.ts` + `lib/supabase/service.ts` (`import "server-only"`). Verified absent from `.next/static` with the real key (AC-P2-3 ✅).
- **Multi-role:** `activeOrg.roles: OrgRole[]`; `assertCan(roles, action)` = permitted if any held role grants it. DB `app.can_author` / `app.is_admin` mirror the map for RLS.
- **`app.assert_author` gate (mutating RPCs):** trusts a call only when `app.is_service_request()` (JWT `role` = `service_role`, or DB-owner session for migrations/seed); an anonymous request (null `auth.uid()`, not a service request) is **denied**. `EXECUTE` on every public RPC + privileged `app.*` helper is explicitly revoked from `PUBLIC` and `anon`.
- **Request ids:** `middleware.ts` assigns/echoes `x-request-id`; `getRequestId()` + `logServerError()` (`lib/observability/request-id.ts`) carry it into audit rows and structured logs (AC-P2-23).

---

## 6. Autosave / conflict strategy

`row_version` bigint bumped by a `BEFORE UPDATE` trigger on `manual_versions` / `manual_sections` / `manual_blocks`. Mutations run `UPDATE … WHERE id = $id AND row_version = $expected`; 0 rows ⇒ `{ ok:false, code:"CONFLICT" }`; UI shows **"Konflik perubahan"**, never overwrites, never shows "Tersimpan" without server confirmation. Debounce 800 ms. `resolveWrite()` + the state machine are unit-tested. The `row_version` bump on UPDATE is observed live against Supabase DEV in the block-CRUD round-trip ([§0c](#0c-live-dev-verification-2026-08-29)); a full two-browser-session autosave-conflict e2e is Phase 3 editor work.

---

## 7. Dynamic routing & view model

`SupabaseManualDataSource(orgId).loadManualVersionByManualId(id)` loads every fact by explicit id; unknown/foreign id → `notFound()`. `manualIdentity(vm)` feeds builder header, inspector, preview header, and cover from one object. `ManualRenderer` + `ManualBuilder` take `{ vm }` — no hardcoded product.

---

## 8. Tests

`npm run test` (credential-free) → **57 unit tests passed**; the integration suite is skipped
without `SUPABASE_TEST_*` env. With the DEV env set,
`npx vitest run tests/integration/rls.test.ts` → **27 passed / 0 failed / 0 skipped**
([§0c](#0c-live-dev-verification-2026-08-29)).

| File | Covers |
|---|---|
| `tests/unit/permissions.test.ts` | role→action map; `assertCan` typed errors; **multi-role** authoring + admin-only gating (AC-P2-22, PRD §6). |
| `tests/unit/domain.test.ts` | semver; MT timeframe control; broker-suffix symbols + normalisation; setup list (3 configs distinct, `EURUSD/M15` not implied, dup rejected, unknown TF/empty rejected, `tested_minimum_lot` optional/≥0); 6 block payloads + unknown-type/raw-HTML rejection; parameter identifier/type; canonical 18 sections; `resolveWrite` match/stale/missing. |
| `tests/unit/view-model.test.ts` | assembler null-safety; Polaris never shows VMax; deterministic sort. |
| `tests/unit/positions.test.ts` | `nextPosition`, `validateReorder` (count/dup/unknown). |
| `tests/unit/image-dimensions.test.ts` | PNG/JPEG/GIF/WebP header parsing + corrupt input (AC-P2-19). |
| `tests/unit/schema-parity.test.ts` | SQL↔TS enums; **composite `(id, organization_id)` FKs on every child table**; **`unique (id, organization_id)` on every parent**; **`manual_versions.template_id NOT NULL` + recorded by the RPC**; **app resolves a concrete template, never sends null**; **`guard_manual_template_org` triggers**; **`assert_author` denies anon (no bare null-uid bypass); `is_service_request` keys on the JWT role**; **`REVOKE EXECUTE … FROM PUBLIC` + `FROM anon` do-block covers every RPC + helper**; **every RPC `perform app.assert_author`**; **`app.assert_reorder_list` null/dup/count checks + per-RPC foreign-id catch**; **cross-org `copy_parameter_definitions` guard**; **`uploadManualImage`: final key up front, no `pending`, rollback on failure, width/height**; **audit + logs carry `x-request-id`**; system template = canonical set & read from the table; RLS write policies require `can_author`; multi-role unique tuple; atomic `replace` uses the RPC; block CRUD actions validate payloads. |
| `tests/integration/rls.test.ts` | **27 passed / 0 failed / 0 skipped against Supabase DEV** ([§0c](#0c-live-dev-verification-2026-08-29)) — `describe.skipIf`-gated groups, no silent no-ops: anonymous client denied on **all 7** mutating RPCs; both reviewer roles read-only + cannot invoke create RPCs; DEVELOPER cannot admin-mutate; **multi-role fixture** (roles aggregate / author retained / admin not gained); cross-org isolation; **composite-FK relational integrity** (Org A dev cannot reference an Org B parent, INSERT + UPDATE); **cross-org `copy_parameter_definitions`** (valid Org B target, Org A source → refused, nothing copied); **hardened reorder** (dup / omitted / foreign / extra → error + order preserved; valid permutation succeeds); block CRUD create→update→reorder→soft-delete→restore; template instantiation records `template_id`+version; parameter propagation; **private image** (own fixture: member-allowed, cross-org denial, unsigned/public-URL denial, signed-URL success, expiry). |

### Running the integration tests

The schema + seed are applied to Supabase DEV. To re-run the suite against it (or any project
with the migrations + seed applied):

```bash
SUPABASE_TEST_URL=https://<ref>.supabase.co \
SUPABASE_TEST_ANON_KEY=<publishable key> \
SUPABASE_SECRET_KEY=<secret key> \
npx vitest run tests/integration/rls.test.ts
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
| `npm run test` | ✅ 57 unit tests passed (integration suite skipped without `SUPABASE_TEST_*`) |
| `npm run build` | ✅ pass, 18 routes |
| `GET /api/health` — no env | ✅ 503, `ready:false`, per-var checks false |
| `GET /api/health` — all env | ✅ 200, `ready:true`, all checks true → **AC-P2-2 fully verified** |
| Secret key in client bundle (real secret key) | ✅ **0 occurrences** in `.next/static` → **AC-P2-3 verified** |
| `/` / `/login` / `/dashboard` (configured, no session) | ✅ 307→/login (guard) / 200 / 307→/login |
| `npx vitest run tests/integration/rls.test.ts` — Supabase DEV | ✅ **27 passed / 0 failed / 0 skipped** ([§0c](#0c-live-dev-verification-2026-08-29)) |
| App sign-in against DEV | ✅ `developer@smartin.demo` authenticates; organisation memberships resolve |

**Covered by the live DEV run (§0c):** migration/seed apply, RLS role enforcement, SECURITY
DEFINER RPC denial (anon + reviewer), same-org composite-FK relational integrity, private-storage
access + signed-URL expiry, template instantiation, parameter-ownership propagation, multi-role
aggregation.

**Still UI/e2e work (not a database gap):** in-app CRUD round-trips through the server actions,
the signed-in-zero-membership screen, the two-browser-session autosave-conflict flow, pointer-drag
reorder in the browser, and the Polaris-vs-VMax render walkthrough. These need the Phase 3 editor
surface and browser-level e2e, not more credentials.

---

## 11. Acceptance criteria results

Legend: ✅ implemented & verified at the stated level (incl. live against Supabase DEV, §0c) ·
🟦 implemented + database behaviour verified live; the outstanding evidence is a UI/e2e pass, not
a schema/credential gap · ⬜ SHOULD / Phase boundary.

| ID | Result | Note |
|---|---|---|
| AC-P2-1 | ✅ / 🟦 | GI-3/4/5/6/7 ✅. GI-10/11/12 ✅ at schema + unit level; a runtime UI copy-scan is still pending (UI e2e). |
| AC-P2-2 | ✅ | Verified both directions against the real project. |
| AC-P2-3 | ✅ | Secret key absent from `.next/static` (real key). |
| AC-P2-4 | ✅ | Verified live against DEV: `developer@smartin.demo` authenticates and organisation memberships resolve. Generic-error message + sign-out are server-action/UI paths (implemented; browser e2e pending). |
| AC-P2-5 | 🟦 | `/no-membership` guard + layout redirect implemented; the *no-session* redirect is verified. The *signed-in, zero-membership* screen still needs a membership-less identity + a browser check (all seed users have a membership) — UI e2e, not a schema gap. |
| AC-P2-6 | ✅ / 🟦 | Live: an author's `ea_products` INSERT is accepted and org-scoped by RLS; a non-author is refused. The slug-uniqueness inline error is unit-tested at the action layer; browser e2e pending. |
| AC-P2-7 | ✅ / 🟦 | Live: `ea_versions` rows are created and the composite-FK / org scoping is enforced (cross-org product reference refused, INSERT + UPDATE). `(product,platform,version)` uniqueness rejection + semver parsing are parity/unit-tested; browser e2e pending. |
| AC-P2-8 | 🟦 | `requirements`/`support` JSON persisted on `ea_versions`; "no free-text symbols/timeframes" enforced by the `ea_version_setups` schema (parity test ✅). A full form round-trip is UI e2e. |
| AC-P2-9 | 🟦 | `create_ea_version_with_setups` writes one row per configuration; 3-config distinctness is unit-tested and the RPC's **authorisation** is verified live (anon + reviewer refused). The positive multi-config persistence path is pending e2e. |
| AC-P2-9a | ✅ / 🟦 | No inference path (unit-tested); full rendered-output scan pending (UI e2e). |
| AC-P2-9b | ✅ / 🟦 | Editor has **pointer drag + keyboard** reorder, suffix symbols, controlled TF, inline dup rejection — built + unit-tested; browser e2e pending. |
| AC-P2-9c | ✅ | Broker-min-lot note + "data uji developer" labels present in editor, wizard, version form, renderer. |
| AC-P2-10 | ✅ | Verified live against DEV: `create_manual_with_version` instantiates exactly the system template's section set and records `template_id` + `template_version` on the manual version. |
| AC-P2-11 | 🟦 | New-EA path is one transactional RPC (`create_product_version_manual`); its authorisation is verified live (anon + reviewer refused). The positive atomic create / rollback assertion is pending e2e. |
| AC-P2-12 | ✅ / 🟦 | View-model isolation unit-tested (Polaris ≠ VMax); full render walkthrough pending (UI e2e). |
| AC-P2-13 | 🟦 | `(manual_id, version)` unique constraint present; friendly error mapping unit-tested. Duplicate-version rejection is pending e2e. |
| AC-P2-14 | 🟦 | `guard_required_section_delete` trigger + `manual:update` gate + `schema-parity` coverage. Not exercised by the live suite (no required-section-delete case) — pending e2e. |
| AC-P2-15 | ✅ | Verified live against DEV: full block round-trip create → update (`row_version` bump) → reorder → soft-delete → restore, `blockPayloadSchema` at the write boundary. |
| AC-P2-16 | ✅ | Verified live against DEV: `reorder_manual_blocks` two-phase RPC — duplicate / omitted / foreign / extra id rejected with the order preserved; a valid permutation succeeds; positions stay non-negative under the partial-unique live-position index. |
| AC-P2-17 | ✅ | Verified live against DEV: `softDeleteBlock` + `restoreBlock` (restore-to-end) inside the block round-trip. |
| AC-P2-18 | ✅ / 🟦 | Live: `ea_parameters` rows are created under a group and read back through both manual versions. Full column-set update/delete via the action + management UI is pending e2e. |
| AC-P2-18a | ✅ | Verified live against DEV: a `parameter_group` (org A) referencing an Org B `ea_version` UUID is refused; `guard_parameter_table_ownership` rejects foreign groups; no `manual_version_id` on parameter tables (parity). |
| AC-P2-18b | ✅ | Verified live against DEV: editing an `ea_parameter` is visible to every manual version linked to that EA version — no copy step. |
| AC-P2-18c | ✅ | Verified live against DEV: an Org B admin's `create_ea_version_with_setups` copying parameter definitions from an Org A EA version is refused and nothing is copied (same-org + author guard). |
| AC-P2-19 | ✅ | Verified live against DEV: private-bucket fixture — owning-org member can sign a URL, another org cannot, the object is not publicly reachable, a signed URL expires. `width`/`height` header parsing has 4-format unit tests. |
| AC-P2-20 | ✅ / 🟦 | `row_version`-guarded UPDATE + `resolveWrite` unit-tested; the `row_version` bump is observed live in the block round-trip; 5 UI states. The two-browser-session conflict flow is pending e2e (Phase 3 editor). |
| AC-P2-21 | ✅ | Verified live against DEV: RLS is role-aware (reviewers read-only, cross-org reads/writes refused), the SECURITY DEFINER gate denies anon on all 7 mutating RPCs, `EXECUTE` is revoked from PUBLIC/anon, and same-org composite FKs block cross-org parent references (INSERT + UPDATE). |
| AC-P2-22 | ✅ | `assertCan(roles, …)` typed-error unit tests, incl. multi-role; the live multi-role fixture confirms roles aggregate, authoring is retained and admin is not gained. |
| AC-P2-23 | ✅ (SHOULD) | Request ids implemented: `middleware.ts` assigns/echoes `x-request-id` (verified on every response); `writeAudit` stores `metadata.requestId`; `mapPostgrestError` logs unmapped errors with it via a redacting logger. Human messages only — no SQL/tokens/signed URLs. |
| AC-P2-24 | ✅ / 🟦 | Pages read from `features/*/queries.ts`; `mock-data.ts` deleted. Live-data render walkthrough pending (UI e2e). |
| AC-P2-25 | ✅ | Vitest + Testing Library green in CI; slug/version mapping, permission map, autosave conflict, reorder, image dims all covered; integration suite green against DEV. |
| AC-P2-26 | ✅ | `manual_templates`/`_sections` versioned + installed by migration; `manual_versions.template_id` **NOT NULL** + `template_version` recorded and verified live (§0c / AC-P2-10). **Checklist template versioning is Phase 5** (documented in `ACCEPTANCE_CRITERIA.md` AC-P2-26). |
| AC-P2-27 | ✅ | Decisions in §12; the multi-role question resolved by implementing it. |

**No MUST is marked ✅ solely on the strength of a Zod schema or a code path a database has not
exercised. Rows still marked 🟦 are pending a browser/e2e pass, not a schema or credential gap.**

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

1. `lib/supabase/database.types.ts` is hand-authored (matches the migrations). Now that the schema is applied to Supabase DEV, `npm run db:types` against DEV can replace it; query files cast at the boundary meanwhile.
2. Active org = first membership by `created_at`; no org switcher.
3. Autosave's editable surface is the chapter completion state; the block editor UI is Phase 3 (the block **data** CRUD + conflict mechanism exist now).
4. `image_assets.scan_status` is stored; no scanner sets it yet (`PRD-OQ-009` → Phase 5).
5. Next 16 prints a `middleware`→`proxy` rename advisory; `middleware.ts` still works and builds. Rename is a housekeeping follow-up.
6. `parameter-manager.tsx` is a deliberately minimal CRUD surface for testability, not the Phase 3 editor.

---

## 14. Environment & verification state

**Runtime credentials: PRESENT.** `/api/health` → `ready:true`; AC-P2-2 and AC-P2-3 verified
against the real project.

**Schema: APPLIED to Supabase DEV.** `supabase/migrations/` — including
`20260901000700_grant_phase2_data_api_access.sql` — is deployed to the DEV project, the seed
identities and fixtures exist, and the app authenticates `developer@smartin.demo` and resolves
memberships. See [§0c](#0c-live-dev-verification-2026-08-29).

**Live suite: GREEN.** `npx vitest run tests/integration/rls.test.ts` against DEV →
**27 passed / 0 failed / 0 skipped**, covering RLS role enforcement, SECURITY DEFINER RPC
authorisation (incl. anonymous denial on all 7 mutating RPCs), composite-FK relational integrity,
hardened-reorder malformed-list rejection, the cross-org `copy_parameter_definitions` attack, the
private-image fixture group, template instantiation, parameter-ownership propagation, and the
multi-role fixture. Results recorded in §0c, §10 and §11.

**Still outstanding — UI / end-to-end, not a schema or credential gap:** the browser walkthroughs
behind AC-P2-1 (copy scan), AC-P2-5 (signed-in zero-membership screen), AC-P2-8/9/9a/9b (config
form + rendered output), AC-P2-11/13 (create/duplicate flows in the app), AC-P2-12/24 (Polaris vs
VMax render), AC-P2-14 (required-section-delete in the UI), AC-P2-18 (parameter management UI),
and AC-P2-20 (two-browser-session autosave conflict). These depend on the Phase 3 editor surface
and browser-level e2e.

---

## 15. Deferred to Phase 3 (and later)

Phase 3: TipTap spike + visual block editor, accessible in-editor reorder, installation step builder, parameter table builder UI, image placement + annotation editor, undo, generated Supabase types. Phase 4: AI. Phase 5: checklist engine, `scan_status` gate. Phase 6: reviews, decisions, cloning, immutable snapshots. Phase 7: public route, PDF. Phase 8: audits, org switcher, member/template admin UI.
