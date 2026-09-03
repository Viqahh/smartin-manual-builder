# Environments — Supabase isolation (Phase 8A.5)

DEV/Preview and Production use **separate Supabase projects**. Non-production activity
(local dev, Preview, integration tests, fixture/UAT scripts, DEV migrations) never touches the
Production database.

## Mapping

| Runtime | `APP_ENV` | Supabase project | Ref | Data policy |
|---|---|---|---|---|
| Local dev (`next dev`) | `development` | `smartin-manual-builder-dev` | `tmrwhkhydkjaubpuegqa` | seed + demo + UAT + fixtures allowed |
| Vercel **Preview** | `preview` | `smartin-manual-builder-dev` | `tmrwhkhydkjaubpuegqa` | same as above |
| Integration tests | `development` | `smartin-manual-builder-dev` | `tmrwhkhydkjaubpuegqa` | writes; DEV only (guard-enforced) |
| Fixture / UAT scripts | `development` | `smartin-manual-builder-dev` | `tmrwhkhydkjaubpuegqa` | destructive; DEV only + opt-in |
| Vercel **Production** | `production` | `smartin-manual-builder-prod` | `wotidyhpbltoxmzvdqkj` | **no** demo/seed/UAT; real data only |

Both projects: Supabase org `qfeaaklqazbdqgklmtmx`, region `ap-southeast-1`, Postgres 17.

## Environment identity

`lib/env.ts`:
- `resolveAppEnv()` / `appEnv` — explicit `APP_ENV` wins, else derived from `VERCEL_ENV`, else `development`.
- `EXPECTED_DEV_PROJECT_REF` / `EXPECTED_PROD_PROJECT_REF` — the public project-URL subdomains (not secrets).
- `supabaseProjectRef(url)` — parses the ref from a project URL.
- `expectedProjectRefFor(env)` — the one ref an environment may use (`production` → PROD, else DEV).
- `envProjectMismatch()` — non-fatal form, surfaced in `/api/health` as the `APP_ENV/project match` check and the top-level `env` field.

## Guards (fail closed)

**Runtime — HARD** — `lib/env.ts` → `assertSupabaseProjectMatchesEnv()`, called inside
`createSupabaseServerClient()` (`lib/supabase/server.ts`) and `createSupabaseServiceClient()`
(`lib/supabase/service.ts`). Throws `SupabaseEnvMismatchError` and stops client creation when:
- the configured ref is neither the DEV nor the PROD ref (unknown / ambiguous), or
- the ref is not the one bound to this `APP_ENV` (`production`↔PROD, `development`/`preview`↔DEV).

A blank `NEXT_PUBLIC_SUPABASE_URL` returns quietly — that is the "Supabase not configured" path
(`SupabaseNotConfiguredError`) handled separately, and the CI build (empty Supabase env) stays green.
Consequence: **Vercel Production env must be repointed to the PROD project _before_ the deployment
that carries this code** — otherwise Production boots fail closed instead of silently using DEV.

**Integration suite** — `tests/integration/_guard.ts` → `assertIntegrationTargetIsDev()`, called at
module scope in `rls.test.ts`:
- no `SUPABASE_TEST_URL` → returns quietly; the suite self-skips (`describe.skipIf(!HAS_API)`), so the
  credential-free `npm run test` / CI run stays green;
- a configured target that is the Production ref, `APP_ENV=production`, or an unrecognised ref →
  throws `ABORT — …` and errors the whole file.

**Fixture / UAT scripts** — `scripts/fixtures/_guard.mjs` → `assertDevFixtureTarget(url)`. Passes only when
_all_ hold: target ref === DEV ref, `APP_ENV` ≠ `production`, and `ALLOW_DESTRUCTIVE_FIXTURES=yes-dev`.
See `scripts/fixtures/README.md`.

Coverage: `tests/unit/env-guards.test.ts`.

## Environment variables

| Name | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` / `APP_URL` | app runtime (`lib/env.ts` → `lib/supabase/*`) | **per-environment** values on Vercel (Preview → DEV project, Production → Prod project) |
| `APP_ENV` | all runtimes | `development` locally; `preview` / `production` set per-environment on Vercel |
| `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` / `SUPABASE_TEST_SECRET_KEY` | integration tests only | DEV project values; passed inline or via shell profile. `SUPABASE_TEST_SECRET_KEY` falls back to `SUPABASE_SECRET_KEY`. |
| `ALLOW_DESTRUCTIVE_FIXTURES` | fixture scripts only | must equal `yes-dev` |

## Migrations

- One history, applied **independently** per project. Never auto-run from a Vercel build.
- Apply order: DEV first → integration suite green on DEV → then a deliberate push to Production.

```bash
# DEV (default linked project)
supabase db push --linked

# Production (explicit, deliberate)
supabase db push --project-ref wotidyhpbltoxmzvdqkj
supabase migration list --project-ref wotidyhpbltoxmzvdqkj   # all rows local == remote
```

- Never edit an applied historical migration. Corrections are new forward migrations.
- Production is **never** seeded: `supabase/seed.sql` is DEV-only. Structural rows (system manual
  template + sections, checklist v1 + 31 items, `human_evidence_eligible`) ship inside the migrations.

## First Production identity — `supabase/prod-bootstrap.sql`

One-time, manual, idempotent. **Not** a migration. Stays a **template** in git — never commit a
real email / org name / slug / UUID / credential.

Corrected sequence (the live Production deployment still points at DEV until cutover, so the app
cannot be used to register the first admin):

1. Create the first admin **auth user manually** in the Production project's Auth dashboard.
2. Verify the `on_auth_user_created` trigger created the matching `public.profiles` row.
3. Edit the three values in the `DECLARE` block (do not commit the edit) and run it once — via the
   Production SQL editor, or:
   ```bash
   supabase link --project-ref wotidyhpbltoxmzvdqkj
   supabase db query --linked -f supabase/prod-bootstrap.sql
   supabase link --project-ref tmrwhkhydkjaubpuegqa   # re-link back to DEV
   ```
4. Verify exactly one `organizations` row + one ADMIN `memberships` row, and no demo/UAT data.

Creates exactly one `organizations` row and one ADMIN `memberships` row. No auth users, no demo data.

## Cutover sequence (do NOT deploy until the bootstrap above is confirmed)

1. Vercel **Preview** stays: DEV Supabase `tmrwhkhydkjaubpuegqa`, `APP_ENV=preview`.
2. Vercel **Production** → set `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` /
   `SUPABASE_SECRET_KEY` to the PROD project + add `APP_ENV=production`. **Before** the next deploy.
3. Commit the Phase 8A.5 changes → push `main` → let the Vercel Git integration build the new
   Production deployment (starts directly against the PROD database).
4. Verify the deployment uses PROD (`/api/health` → `env:"production"`, `APP_ENV/project match` ok).
5. Production smoke tests: `/login`, first ADMIN login, dashboard, org context, create/open manual,
   Manual Builder, validation inspector, review/RBAC boundaries, publication readiness, public manual
   route, PDF generation, `/api/health`.

Never run the integration suite or fixture/UAT scripts against Production.

## Production bootstrap status (2026-09-03)

- Migrations 1–31 applied to `wotidyhpbltoxmzvdqkj`; `migration list` — all 31 rows `local == remote`.
- `seed.sql` **not** run. Verified empty: 0 organizations / profiles / auth users / memberships /
  ea_products / manuals / manual_versions / checklist_results / audit_events / public_manuals.
- Structural parity with DEV: 29 tables, 29 RLS-enabled, 67 policies, 50 triggers, 18 template
  sections, 31 checklist items, `human_evidence_eligible` = {CHK-INSTALL-AUTOTRADING, CHK-PACKAGE-FILES}.
- Vercel Production Supabase env vars **not yet repointed** — pending explicit go-ahead.
- Known DEV-only drift (pre-existing, unrelated): two scratch functions `public._c_guard()`,
  `public._do_del(int)` exist on DEV only — leave alone for now; not a Production blocker.
