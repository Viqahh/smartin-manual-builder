# Phase 2 completion report — Data & CRUD

> **Status: corrections applied after TWO failed review passes.** Pass 1 (findings in [§0](#0-review-findings--how-each-was-fixed))
> and pass 2 (findings in [§0b](#0b-correction-pass-2--how-each-was-fixed)) are addressed in the
> implementation, not by editing docs. `lint`, `typecheck`, `test`, and `build` pass.
>
> **Credential state:** app-runtime Supabase credentials are present (`.env.local`, reviewer-provided,
> gitignored, never committed). The project is reachable, `/api/health` returns `ready:true`, the
> `sb_secret_` key is verified absent from the client bundle, and every response carries an
> `x-request-id`. The **database schema has still not been applied** to that project and cannot be
> from this environment (only the `sb_publishable_` / `sb_secret_` API keys — no DB connection
> string / `SUPABASE_ACCESS_TOKEN`, so no DDL). The live integration suite therefore still cannot
> run; schema-dependent acceptance criteria remain **BLOCKED** and are not marked passed.
> See [§14](#14-external-credential-limitations).
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
| **9** | Expand the integration suite; don't mark credential-gated tests passed | `tests/integration/rls.test.ts` rewritten into `describe.skipIf`-gated groups. **All skipped** (schema not applied) and reported BLOCKED, never passed. *(Pass 2 removed every silent `if (!SECRET) return;`, added the anon-RPC / compliance-reviewer / relational-integrity / image-fixture groups, and fixed the cross-org copy attack — see §0b findings 4, 5.)* |
| **10** | Documentation accuracy | This file rewritten. The acceptance table below marks a MUST ✅ only where it is actually implemented **and** verified at the stated level; everything needing a live schema is 🟦 BLOCKED. |

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
| **Tests + CI** | 57 unit tests, 27 skipped (BLOCKED) integration; `.github/workflows/ci.yml` npm ci → lint → typecheck → test → build on Node 22. |

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

`supabase/seed.sql` — demo org A + org B, **5** demo auth users (`*@smartin.demo` / `demo-password-123`, LOCAL ONLY) incl. `compliance@` (COMPLIANCE_REVIEWER); **`developer@` holds DEVELOPER + TECHNICAL_REVIEWER** (multi-role fixture); VMax EA / MT5 / 1.0.0, two setups, one parameter group + three parameters, one manual + version (with `template_id`) + sections from the system template.

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
- **`app.assert_author` gate (mutating RPCs):** trusts a call only when `app.is_service_request()` (JWT `role` = `service_role`, or DB-owner session for migrations/seed); an anonymous request (null `auth.uid()`, not a service request) is **denied**. `EXECUTE` on every public RPC + privileged `app.*` helper is explicitly revoked from `PUBLIC` and `anon`.
- **Request ids:** `middleware.ts` assigns/echoes `x-request-id`; `getRequestId()` + `logServerError()` (`lib/observability/request-id.ts`) carry it into audit rows and structured logs (AC-P2-23).

---

## 6. Autosave / conflict strategy

`row_version` bigint bumped by a `BEFORE UPDATE` trigger on `manual_versions` / `manual_sections` / `manual_blocks`. Mutations run `UPDATE … WHERE id = $id AND row_version = $expected`; 0 rows ⇒ `{ ok:false, code:"CONFLICT" }`; UI shows **"Konflik perubahan"**, never overwrites, never shows "Tersimpan" without server confirmation. Debounce 800 ms. `resolveWrite()` + the state machine are unit-tested; the two-session test is BLOCKED.

---

## 7. Dynamic routing & view model

`SupabaseManualDataSource(orgId).loadManualVersionByManualId(id)` loads every fact by explicit id; unknown/foreign id → `notFound()`. `manualIdentity(vm)` feeds builder header, inspector, preview header, and cover from one object. `ManualRenderer` + `ManualBuilder` take `{ vm }` — no hardcoded product.

---

## 8. Tests

`npm run test` → **57 passed, 27 skipped** (7 files).

| File | Covers |
|---|---|
| `tests/unit/permissions.test.ts` | role→action map; `assertCan` typed errors; **multi-role** authoring + admin-only gating (AC-P2-22, PRD §6). |
| `tests/unit/domain.test.ts` | semver; MT timeframe control; broker-suffix symbols + normalisation; setup list (3 configs distinct, `EURUSD/M15` not implied, dup rejected, unknown TF/empty rejected, `tested_minimum_lot` optional/≥0); 6 block payloads + unknown-type/raw-HTML rejection; parameter identifier/type; canonical 18 sections; `resolveWrite` match/stale/missing. |
| `tests/unit/view-model.test.ts` | assembler null-safety; Polaris never shows VMax; deterministic sort. |
| `tests/unit/positions.test.ts` | `nextPosition`, `validateReorder` (count/dup/unknown). |
| `tests/unit/image-dimensions.test.ts` | PNG/JPEG/GIF/WebP header parsing + corrupt input (AC-P2-19). |
| `tests/unit/schema-parity.test.ts` | SQL↔TS enums; **composite `(id, organization_id)` FKs on every child table**; **`unique (id, organization_id)` on every parent**; **`manual_versions.template_id NOT NULL` + recorded by the RPC**; **app resolves a concrete template, never sends null**; **`guard_manual_template_org` triggers**; **`assert_author` denies anon (no bare null-uid bypass); `is_service_request` keys on the JWT role**; **`REVOKE EXECUTE … FROM PUBLIC` + `FROM anon` do-block covers every RPC + helper**; **every RPC `perform app.assert_author`**; **`app.assert_reorder_list` null/dup/count checks + per-RPC foreign-id catch**; **cross-org `copy_parameter_definitions` guard**; **`uploadManualImage`: final key up front, no `pending`, rollback on failure, width/height**; **audit + logs carry `x-request-id`**; system template = canonical set & read from the table; RLS write policies require `can_author`; multi-role unique tuple; atomic `replace` uses the RPC; block CRUD actions validate payloads. |
| `tests/integration/rls.test.ts` | **skipped (BLOCKED — schema not applied)** — `describe.skipIf`-gated groups, no silent no-ops: anonymous client denied on **all 7** mutating RPCs; both reviewer roles read-only + cannot invoke create RPCs; DEVELOPER cannot admin-mutate; **multi-role fixture** (roles aggregate / author retained / admin not gained); cross-org isolation; **composite-FK relational integrity** (Org A dev cannot reference an Org B parent, INSERT + UPDATE); **cross-org `copy_parameter_definitions`** (valid Org B target, Org A source → refused, nothing copied); **hardened reorder** (dup / omitted / foreign / extra → error + order preserved; valid permutation succeeds); block CRUD create→update→reorder→soft-delete→restore; template instantiation records `template_id`+version; parameter propagation; **private image** (own fixture: member-allowed, cross-org denial, unsigned/public-URL denial, signed-URL success, expiry). |

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
| `npm run test` | ✅ 57 passed, 27 skipped (BLOCKED integration) |
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
| AC-P2-5 | 🟦 | `/no-membership` guard + layout redirect implemented and the *no-session* redirect is verified; the *signed-in, zero-membership* path needs a real `profiles` row without a `memberships` row → schema. |
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
| AC-P2-21 | ✅ (schema-level) / 🟦 (runtime) | **RLS is now role-aware**; SECURITY DEFINER gate denies anon; `EXECUTE` revoked from PUBLIC/anon; **same-org composite FKs** (parity tests for all). Runtime cross-org + reviewer + anon-RPC + relational-integrity denial in the (blocked) integration suite. |
| AC-P2-22 | ✅ | `assertCan(roles, …)` typed-error unit tests, incl. multi-role. |
| AC-P2-23 | ✅ (SHOULD) | Request ids implemented: `middleware.ts` assigns/echoes `x-request-id` (verified on every response); `writeAudit` stores `metadata.requestId`; `mapPostgrestError` logs unmapped errors with it via a redacting logger. Human messages only — no SQL/tokens/signed URLs. |
| AC-P2-24 | ✅ / 🟦 | Pages read from `features/*/queries.ts`; `mock-data.ts` deleted. Live data render 🟦. |
| AC-P2-25 | ✅ | Vitest + Testing Library green in CI; slug/version mapping, permission map, autosave conflict, reorder, image dims all covered. |
| AC-P2-26 | ✅ (manual template) / 🟦 (runtime) | `manual_templates`/`_sections` versioned + installed by migration; `manual_versions.template_id` **NOT NULL** + `template_version` recorded; sections instantiated from that exact version. **Checklist template versioning is Phase 5** (documented in `ACCEPTANCE_CRITERIA.md` AC-P2-26). Runtime instantiation 🟦. |
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

**Consequently BLOCKED (implemented + reviewed, not executed, NOT signed off):** AC-P2-4, AC-P2-5 (signed-in no-membership path), 6–14, 16 (DB), 17 (DB), 18, 18a (runtime), 18b, 18c, 19 (storage), 20 (two-session), 21 (runtime), 24 (render), 26 (runtime); spec §25 (Polaris), §26 (parameter ownership), §27 (security) end-to-end; the **entire** `tests/integration/rls.test.ts` suite — including the pass-2 additions: anonymous-RPC denial, composite-FK relational integrity, hardened-reorder malformed-list rejection, the fixed cross-org `copy_parameter_definitions` attack, the private-image fixture group, and the multi-role fixture group.

**To unblock:** supply a DB connection string **or** a `SUPABASE_ACCESS_TOKEN` for the project, then `supabase db push` + apply the seed, run the integration suite, and record results in §10–11. **Phase 2 is not fully complete until that pass is green.**

---

## 15. Deferred to Phase 3 (and later)

Phase 3: TipTap spike + visual block editor, accessible in-editor reorder, installation step builder, parameter table builder UI, image placement + annotation editor, undo, generated Supabase types. Phase 4: AI. Phase 5: checklist engine, `scan_status` gate. Phase 6: reviews, decisions, cloning, immutable snapshots. Phase 7: public route, PDF. Phase 8: audits, org switcher, member/template admin UI.
