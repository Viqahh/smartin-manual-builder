# Smartin Manual Builder — Integration & IT Handover

> **Audience:** the company IT Head / infrastructure owner / future maintainer.
> **Purpose:** move this application off the original developer's personal accounts and onto
> company‑owned infrastructure, and operate it from there.
> **This document contains no secret values** — only variable *names*, procedures, and checklists.
> Where another document is authoritative it is linked rather than restated.

Prepared at Phase 8B‑12 (final release closeout). Repository baseline commit at handover:
`f9797d289de81cfbde58816a2fe5e9a7311fc026` on `main`.

---

## 1. Purpose

**What the system is.** Smartin Manual Builder is a single Next.js web application that guides
MetaTrader 4/5 Expert Advisor (EA) contributors through creating structured, versioned, reviewable
product manuals. Structured EA data (identity, requirements, parameters, supported configurations,
changelog) is the source of truth; an optional AI assistant may only rewrite supplied facts, never
invent them. Manuals move through a fixed review workflow and, once published, become immutable
snapshots that are served as a public web page and as a generated PDF.

**What this document covers.** Source‑code ownership, deployment ownership, environment variables,
DEV/Preview/Production data separation, Supabase ownership, first‑admin bootstrap, the role model,
CI, domain/DNS cutover, PDF operations, AI configuration, the health check, the deployment
procedure, rollback, an operational checklist, an ownership‑transfer checklist, and the carried
known risks / deferred items.

**What this document does not contain.**
- No secret values (keys, tokens, passwords, connection strings, real emails, real UUIDs).
- No product feature specification — see [`docs/PRD.md`](./PRD.md), [`docs/USER_FLOWS.md`](./USER_FLOWS.md),
  [`docs/UI_SPEC.md`](./UI_SPEC.md).
- No architecture rationale — see [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md).
- No environment‑isolation contract detail — see [`docs/ENVIRONMENTS.md`](./ENVIRONMENTS.md) (authoritative).
- No acceptance evidence — see [`docs/PHASE_8.md`](./PHASE_8.md) and
  [`docs/ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md).

---

## 2. System architecture (summary)

```
Browser (Next.js web client — forms, builder panels; never decides authorization)
  → Next.js App Router application (server components + server actions)
      · session validation, authorization policies, workflow transitions
      · signed asset URLs, AI request constraints, PDF orchestration
      · Node.js runtime (see §5 / §13)
  → Supabase Auth        — cookie-based SSR sessions
  → Supabase PostgreSQL  — normalized records, status/version constraints, audit metadata,
                           SQL (SECURITY DEFINER) functions, Row-Level Security as defence in depth
  → Supabase Storage     — private buckets for draft images; published images served only through
                           controlled signed URLs / a publish-safe path
  → PDF generation       — server-side headless Chromium (playwright-core + @sparticuz/chromium)
                           loads a short-lived signed print route and exports A4
  → AI provider adapter  — optional; deterministic Mock AI when no credential is configured
```

One typed `ManualViewModel` feeds the editor preview, the public web page, the print CSS, and the
PDF — there is no second content model. Full detail: [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 3. Source-code ownership

**Current repository:** `github.com/Viqahh/smartin-manual-builder` (personal account of the
outgoing developer). `main` is the release branch; CI runs on every push to `main` and every PR
to `main`.

The company must take ownership using **one** of:

### Option A — transfer the existing repository into a company GitHub organisation
GitHub's *Settings → Danger Zone → Transfer ownership*. Preserves history, branches, PRs, issues,
and stars. After transfer the repository URL changes; update any local clones' `origin`.

### Option B — create a company-owned repository and import the full history
Create an empty repo in the company org, then `git push --mirror` from a full clone so **all**
commits, tags, and branches move across.

**Requirements either way:**
- [ ] Full commit history preserved (do not squash / re-init).
- [ ] `main` preserved as the release branch; branch protection re-applied as the company requires.
- [ ] Any tags / GitHub Releases created later are preserved (there are none at handover).
- [ ] CI workflow file `.github/workflows/ci.yml` preserved unchanged.
- [ ] Repository **Actions secrets recreated** under the new owner (see §11) — secrets do **not**
      transfer with Option B and are not guaranteed visible after an org transfer.
- [ ] CI re-validated on the first post-transfer push (see §11 checklist).
- [ ] No personal GitHub credentials or personal access tokens embedded anywhere in the repo or
      its Actions configuration.

---

## 4. Deployment ownership

**Current state:** the deployed application is operated from the **outgoing developer's personal
Vercel account** (`viqahhs-projects`), with the Vercel Git integration building `main`
automatically. The company must move to a company-controlled deployment. Three supported patterns:

### Option A — transfer the existing Vercel project to a company Vercel Team
Vercel *Project → Settings → Advanced → Transfer Project* into a company-owned Team. After
transfer, verify:
- [ ] Git integration reconnected to the (now company-owned) repository, Production branch = `main`.
- [ ] All environment variables present with the correct **per-environment** scope (see §5, §7).
- [ ] Custom domain re-attached and its DNS still valid.
- [ ] Deployment Protection setting is as intended (see §6, §13).
- [ ] Production vs Preview environment separation intact (`APP_ENV`, Supabase project mapping).
- [ ] `GET /api/health` on the Production URL returns the healthy shape in §16.

### Option B — create a fresh company-owned Vercel project
1. In the company Vercel Team, *Add New → Project* and connect the company-owned repository.
2. Framework preset: **Next.js**. Build command `next build` (default). Install `npm ci` (default).
   Node.js version **22** (match CI — see §5).
3. Recreate every environment variable from §5, each scoped to the right environment(s).
4. Attach the Production custom domain (do **not** cut DNS over yet — see §12).
5. Configure Preview deployments (every push / PR builds a Preview).
6. Deploy; verify `GET /api/health` (§16) and run the smoke list in §12.
7. Switch DNS to the company project **only after** verification (§12).

### Option C — company-managed non-Vercel hosting
Vercel is not mandatory, but the target platform **must** provide:
- The **Next.js server runtime** (App Router server components + server actions + route handlers +
  the Proxy/`proxy.ts` request hook). This is **not** a static export — generic static/CDN‑only
  hosting is **not sufficient**.
- **Server-side environment variables** (secrets never exposed to the browser bundle).
- Persistent outbound network connectivity to Supabase (Auth, Postgres, Storage).
- **Headless Chromium execution** for PDF generation. The app ships `@sparticuz/chromium` +
  `playwright-core`, which target an AWS‑Lambda‑style serverless container. On another platform the
  runtime must be able to launch a headless Chromium (either the bundled `@sparticuz/chromium`
  binary or a platform‑provided Chrome via `PDF_LOCAL_CHROMIUM_PATH`), with enough memory
  (~2 GB) and a long enough function/route timeout (see §14 — current setting is 300 s).
- A per-environment configuration mechanism equivalent to Vercel's environment scopes, so
  Preview‑equivalent builds point at DEV Supabase and Production points at Production Supabase
  (§7).

If Option C is chosen, re-run the full acceptance smoke (§12) and the PDF measurement (§14) on the
new platform before cutover.

---

## 5. Environment variable handover

The canonical list is [`.env.example`](../.env.example). Names and purpose only below — **all
secret values must be generated/entered by company IT** in the target platform's own secret UI.

### APPLICATION RUNTIME
| Name | Browser-safe? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **public** (in bundle) | Supabase project URL. Per-environment: Preview → DEV project, Production → Production project. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **public** (in bundle) | Supabase anon/publishable key. Per-environment, same split. |
| `SUPABASE_SECRET_KEY` | **server-only secret** | Supabase service-role key. Never in the browser bundle (GI‑9). Per-environment, same split. |
| `APP_URL` | server (not secret) | Absolute base URL of this deployment (e.g. the Production domain). Used to build trusted print origins. |
| `APP_ENV` | server (not secret) | `development` \| `preview` \| `production`. Explicit value wins; else derived from `VERCEL_ENV`. Drives the fail‑closed Supabase project guard (§7). |

### PDF
| Name | Kind | Purpose |
|---|---|---|
| `PDF_PRINT_SECRET` | **server-only secret** | HMAC‑SHA256 key for the signed internal print route. High entropy. **Must differ from** `SUPABASE_SECRET_KEY`, `AI_API_KEY`, and `VERCEL_AUTOMATION_BYPASS_SECRET`. Never `NEXT_PUBLIC`, never logged. |
| `PDF_LOCAL_CHROMIUM_PATH` | **local-only**, not secret | Absolute path to a local Chrome/Chromium for PDF generation during local development. Ignored in serverless (uses `@sparticuz/chromium`). |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | **server-only secret** | Vercel *Deployment Protection → Protection Bypass for Automation*. The PDF route's Chromium sends it as `x-vercel-protection-bypass` to fetch its own protected print page during generation. Never in a URL/query/log/PDF/bundle. Only relevant on a protected Vercel deployment. |

### AI
| Name | Kind | Purpose |
|---|---|---|
| `AI_PROVIDER` | server (not secret) | Empty → deterministic **Mock AI** (default). The only shipped real adapter is `anthropic`. |
| `AI_API_KEY` | **server-only secret** | Provider key. Server‑only — never in the bundle, a provider payload, logs, `ai_revisions`, or an error message. |
| `AI_MODEL` | server (not secret) | Optional model override for the configured provider. |

Setting **exactly one** of `AI_PROVIDER` / `AI_API_KEY` is a hard server config error (no silent
fallback) — set **both** or **neither** (§15).

### CI / DEV INTEGRATION (GitHub Actions repository secrets — DEV Supabase project only)
| Name | Purpose |
|---|---|
| `SUPABASE_TEST_URL` | DEV project URL for the live integration suite. A guard aborts the suite if this resolves to Production or an unknown project. |
| `SUPABASE_TEST_ANON_KEY` | DEV anon key for the integration suite. |
| `SUPABASE_TEST_SECRET_KEY` | DEV service‑role key for the integration suite (falls back to `SUPABASE_SECRET_KEY` locally; required explicitly in CI). |

### DEV FIXTURE GUARD (local only)
| Name | Purpose |
|---|---|
| `ALLOW_DESTRUCTIVE_FIXTURES` | Must equal `yes-dev` to let `scripts/fixtures/*` run — and only ever against DEV. Never set this in Preview or Production. |

**Secret-handling rules (all parties):**
- Secrets are **regenerated / re-entered by company IT** through the target platform's secret
  manager (Vercel Environment Variables, or the Option C equivalent) and GitHub *Settings →
  Secrets and variables → Actions*.
- Never transmit a secret through Git, this document or any doc, README, screenshots, email, or
  plain chat, or source code.
- Do **not** ask the outgoing developer to commit `.env.local` or paste secret values anywhere.
- `SUPABASE_SECRET_KEY`, `PDF_PRINT_SECRET`, `AI_API_KEY`, and `VERCEL_AUTOMATION_BYPASS_SECRET`
  are the four independent server‑only secrets — rotating one must not require reusing another.

---

## 6. Deployment Protection (Vercel)

The project has used Vercel **Deployment Protection** so that Preview URLs are not publicly
reachable. Keep it enabled. Automated access (the PDF route fetching its own print page, or an
external test) uses the supported **Protection Bypass for Automation** secret
(`VERCEL_AUTOMATION_BYPASS_SECRET`) sent as the `x-vercel-protection-bypass` HTTP header — never a
query‑string value, never logged. Do not disable protection to work around an automation issue;
issue/rotate the bypass secret instead. On a non‑Vercel platform (Option C) provide an equivalent
non‑public Preview mechanism.

---

## 7. DEV / Preview / Production data separation (authoritative: `docs/ENVIRONMENTS.md`)

| Runtime | `APP_ENV` | Supabase project | Data policy |
|---|---|---|---|
| Local development (`next dev`) | `development` | **DEV** | seed + demo + UAT + fixtures allowed |
| Preview deployment | `preview` | **DEV** | same as local dev |
| Integration tests (`npm run test:integration`, CI `integration` job) | `development` | **DEV only** (guard‑enforced) | writes; DEV only |
| Fixture / UAT scripts (`scripts/fixtures/*`) | `development` | **DEV only** + opt‑in | destructive; DEV only |
| Production deployment | `production` | **Production only** | real data only — **no** seed / demo / UAT / fixtures |

**Fail-closed guard.** `lib/env.ts → assertSupabaseProjectMatchesEnv()` runs inside every server
Supabase client creation. It throws and stops the client (the request fails closed) when the
configured Supabase project ref is unknown/ambiguous, or is not the one bound to this `APP_ENV`
(`production` ↔ Production project; `development`/`preview` ↔ DEV project). Consequence: the
Production environment's Supabase variables **must** point at the Production project **before** the
deploy that carries the code — otherwise Production boots fail closed instead of silently using
DEV. Company IT keeps the DEV↔ref and PROD↔ref expectations in `lib/env.ts`
(`EXPECTED_DEV_PROJECT_REF` / `EXPECTED_PROD_PROJECT_REF`) in sync with the company's own Supabase
projects if the projects are recreated (see §8).

**Never** run, against Production: the integration suite, `supabase/seed.sql`, `scripts/fixtures/*`,
or any UAT cleanup script.

---

## 8. Supabase ownership handover

**Access company IT needs** (both projects — DEV and Production):
- Supabase **organisation / project ownership** (transfer the projects into a company‑owned
  Supabase organisation, or create fresh company projects and migrate — see below).
- **Auth** administration (users, providers, email templates).
- **Database** (SQL editor, roles, extensions, backups/PITR as the plan allows).
- **Storage** (the private `manual-images` bucket and its policies).
- **Project API settings** (URL, anon/publishable key, service‑role key — the last is a secret).
- **Logs** (Postgres, Auth, Storage, Edge).

**If the company creates fresh Supabase projects** (rather than transferring the existing ones):
1. Create a DEV project and a Production project in the company Supabase org (keep them **separate**).
2. Apply the migration history to **DEV first** (`supabase db push`), then run the integration
   suite against DEV and confirm green.
3. Update `EXPECTED_DEV_PROJECT_REF` / `EXPECTED_PROD_PROJECT_REF` in `lib/env.ts` to the new
   project refs, plus `docs/ENVIRONMENTS.md`, in one commit; re-run CI.
4. Apply the migration history to **Production** deliberately and separately (§17), then bootstrap
   the first admin (§9).
5. Recreate the Storage bucket `manual-images` (private) — the migrations create the bucket row and
   its RLS policies, so a clean `db push` reproduces it; verify no public access.
6. Point each environment's `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` /
   `SUPABASE_SECRET_KEY` at the matching new project (§5, §7).

**Migration rules (authoritative: `docs/ENVIRONMENTS.md` §Migrations):**
- One history, applied **independently** per project. **Never auto-run from a build.**
- Apply order: **DEV → integration green on DEV → deliberate Production push.**
- **Never edit an applied historical migration.** Corrections are new forward migrations.
- **Production is never seeded.** Structural rows (system manual template + sections, checklist
  template v1 + its 31 items, `human_evidence_eligible` data) ship *inside* the migrations, not the
  seed file.
- At handover: **32 migrations**, applied to both DEV and Production, drift 0.

---

## 9. First / future admin setup

**Model.** A person signs up through Supabase Auth; a database trigger (`on_auth_user_created`)
creates their `public.profiles` row; a **one-time manual bootstrap** grants the first
organisation + first ADMIN membership. After that, admins manage members and roles in the app.

**First Production admin** — use [`supabase/prod-bootstrap.sql`](../supabase/prod-bootstrap.sql).
It is a **template** (placeholders only — `CHANGE_ME@example.com`, `CHANGE_ME Organisation Name`,
`change-me`), **not a migration**, idempotent, and must **never** be committed with real values.

1. Confirm migrations are applied to Production (§8, §17).
2. Create the first admin **auth user manually** in the Production project's Auth dashboard (not
   through the app — until DNS cutover the live Production deployment may still be pointed
   elsewhere).
3. Verify the trigger created the matching `public.profiles` row.
4. Edit the three values in the `DECLARE` block locally (do **not** commit the edit) and run the
   file **once** — via the Production SQL editor, or `supabase db query --linked -f
   supabase/prod-bootstrap.sql` while linked to the Production project (re‑link back to DEV
   afterwards).
5. Verify exactly one `organizations` row and one `ADMIN` `memberships` row, and no demo/UAT data.

**Future members / roles** (normal operation): an existing `ADMIN` invites/adds members to the
organisation and assigns one of the four roles (§10). Role changes are admin actions and are
audited. There is **no** self‑service org creation in the MVP. Do **not** document or reuse any
demo password — demo identities exist only in the DEV seed.

---

## 10. Role model

Roles are **organisation-scoped**. Permission checks are action‑based (`manual:update`,
`review:technical`, `manual:publish`, …), enforced **server‑side** and mirrored by RLS — never by
hiding buttons.

| Role | Responsibilities | Key boundaries |
|---|---|---|
| **DEVELOPER** | Authors manual content on drafts they own or are assigned to; submits a draft for review when gates are satisfied. | Cannot approve any review, cannot publish, cannot assign reviewers, cannot act on another organisation's data. |
| **TECHNICAL_REVIEWER** | Reviews technical correctness in `TECHNICAL_REVIEW`; leaves anchored comments; approves or requests changes. | Cannot approve a version they authored or edited (**self‑approval protection**, server‑enforced). Cannot publish. Only the assigned reviewer of the active stage acts. |
| **COMPLIANCE_REVIEWER** | Reviews compliance/documentation readiness in `COMPLIANCE_REVIEW` **after** technical approval; approves or requests changes; records human‑evidence decisions where eligible. | Cannot be reached before technical approval. Cannot publish. Only the assigned compliance reviewer acts. Automated checklist output is **documentation readiness, never regulatory approval**. |
| **ADMIN** | Assigns technical & compliance reviewers; runs `APPROVED → PUBLISHED`; archives; administrative ownership of the organisation and its members. | All privileged actions are audited. Publish is **ADMIN‑only** (PRD‑OQ‑007). |

**No regulator approval is implied by any application state.** "Approved" is an internal Smartin
workflow state; the public manual and PDF never claim Bappebti / regulator approval or compliance
certification. Workflow: `DRAFT → TECHNICAL_REVIEW → (CHANGES_REQUESTED → DRAFT →)* →
COMPLIANCE_REVIEW → APPROVED → PUBLISHED → ARCHIVED`.

---

## 11. GitHub Actions / CI

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Triggers: push to `main`,
PR to `main`.

**`verify` job:** `npm ci` → `npm run lint` → `npm run typecheck` → `npm run test` (unit) →
`npm run build`. Node **22**. `actions/checkout@v5`, `actions/setup-node@v5`.

**`integration` job** (needs `verify`): `npm ci` → `npm run test:integration` against the **DEV**
Supabase project, `APP_ENV=development`. Node 22.
- Integration tests **intentionally require** the three `SUPABASE_TEST_*` repository secrets.
- **Fork PRs** do not receive repository secrets → that case is **skipped explicitly with a logged
  reason** (not a failure).
- On the **authoritative repository** (push to `main`, or a same‑repo PR) the three secrets are
  **required**: if any is missing the job **fails closed** with a config error rather than letting
  the suite self‑skip to a false green.
- No step ever prints a secret value.

**Required repository Actions secret names** (DEV Supabase project values **only**):
`SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SECRET_KEY`.

**Post-transfer CI verification checklist:**
- [ ] The three secrets recreated under the new repository owner (DEV project values only).
- [ ] First push to `main` (or a same‑repo PR) triggers CI.
- [ ] `verify` job green: lint, typecheck, unit, build.
- [ ] `integration` job green: DEV integration suite runs (not skipped) and passes.
- [ ] No new deprecation warnings; Node shown as **22** in both jobs.
- [ ] Removing a secret (test in a throwaway branch) makes `integration` **fail**, not skip.

At handover the last green run is CI run `34038344993` on commit `f9797d2` — `verify` green,
`integration` **172/172**, unit **692/692**.

---

## 12. Domain / DNS cutover

Run this sequence so there is always a working Production and a rollback target:

1. Deploy the company‑owned environment (§4) with all env vars set (§5).
2. **Keep the current Production online and serving** on its existing domain.
3. Confirm the company environment's `APP_ENV=production` and Supabase vars point at the
   **Production** Supabase project (§7).
4. `GET /api/health` on the company deployment URL → healthy shape (§16).
5. Verify `/login` loads and the first ADMIN (from §9) can sign in.
6. Verify read‑only application pages: dashboard, EA products, manuals list, open a manual, the
   Manual Builder, the validation inspector, a review page.
7. Verify **PDF generation** in a controlled way: publish a disposable manual in a non‑production
   environment, or generate a PDF for an existing published manual, and confirm a READY artifact
   plus a byte‑identical re‑download (§14).
8. Attach the custom domain to the company deployment (still no DNS change).
9. Re‑verify `/api/health` on the domain‑attached deployment.
10. **Change DNS** to the company deployment only now. Lower TTL beforehand if possible.
11. Monitor error rate and `/api/health` during propagation.
12. Keep the previous deployment/project available as a rollback target (§18) until acceptance.

Do not hard‑code DNS record values here — they are the company's to set.

---

## 13. Vercel-specific settings (where Vercel is used)

- **Git integration:** connected to the company‑owned repository; **Production branch = `main`**.
- **Preview deployments:** enabled for every push / PR.
- **Environment variables:** each scoped correctly — Preview → DEV Supabase + `APP_ENV=preview`;
  Production → Production Supabase + `APP_ENV=production` (§5, §7).
- **Deployment Protection:** enabled; automation uses `VERCEL_AUTOMATION_BYPASS_SECRET` (§6).
- **Function settings:** [`vercel.json`](../vercel.json) pins the PDF route
  `app/manual/[eaSlug]/[version]/pdf/route.ts` to **memory 2048 MB, maxDuration 300 s**. Keep
  this. The 300 s ceiling exists for the cold‑start case in §14.
- **Node.js version:** 22 (match CI).
- Do **not** record real Vercel project IDs, team IDs, or tokens as setup data — they are
  environment‑specific and the tokens are secrets.

---

## 14. PDF operations

- **Generation** is server‑side headless Chromium (`playwright-core` + `@sparticuz/chromium`),
  triggered through a **signed internal print route** (`POST /api/internal/pdf-artifact`, guarded
  by an HMAC print token derived from `PDF_PRINT_SECRET`). It loads a short‑lived signed print
  page, waits for fonts + images, and exports A4.
- The generated PDF is stored as an **immutable READY artifact**. `GET /manual/<slug>/<version>/pdf`
  serves the stored bytes (immutable cache, `nosniff`, filename `Manual_<EAName>_v<X.Y.Z>.pdf`) and
  **never launches Chromium**.
- **Generation is idempotent:** re‑triggering a slug/version that is already READY returns the
  existing artifact; concurrent triggers do not double‑generate.

**KNOWN PERFORMANCE RISK — carried forward (AC‑P8‑7 = PASS WITH KNOWN RISK):**

| Measure | Observed |
|---|---|
| Warm generation | ~12–19 s |
| Cold generation (first request on a cold serverless container) | **> 180 s** observed |
| `maxDuration` (route ceiling) | 300 s |
| READY artifact GET (serves stored bytes) | ~3.3 s; never runs Chromium |

Root cause: serverless (Lambda‑style) + Chromium cold start dominates the first request.
Classification: **medium severity, first‑request‑only, self‑healing** (the artifact still lands
READY and every subsequent request is fast), **non‑blocking**.
Owner: **release engineer.** Follow‑up: **first post‑Phase‑8 maintenance window.**
Potential future options (do **not** implement now): pre‑generate the PDF during the publish
transaction; move generation to a background queue/job with a progress state.

Operational note: if a first PDF request for a brand‑new published manual appears to hang, it is
almost certainly the cold start — the artifact typically completes server‑side; re‑request after
a few minutes and it returns READY.

---

## 15. AI provider

- If `AI_PROVIDER` **and** `AI_API_KEY` are **both empty** → the deterministic **Mock AI** provider
  is used (the default). The UI labels it "Mock AI".
- If a real provider is configured, **both** `AI_PROVIDER` and `AI_API_KEY` must be set
  consistently. Setting exactly one is a **hard server config error** — there is no silent
  fallback. The only real adapter shipped is `AI_PROVIDER=anthropic` (optionally `AI_MODEL`).
- The assistant receives a **narrow grounded fact bundle only** — selected text, a permitted fact
  set, locale, operation. It returns a *proposed* revision (or an "additional information required"
  sentinel); the UI never auto‑applies it. It must not invent strategy, performance, or compliance
  facts.
- `AI_API_KEY` is **server‑only** — never in the browser bundle, a provider payload, logs,
  `ai_revisions`, or an error message.

Do not add or assume a provider integration that is not already shipped.

---

## 16. Health check

`GET /api/health` — no auth, no secrets in the response (status only).

| Field | Meaning |
|---|---|
| `ok` | The app process is up. Always `true` while the endpoint responds. |
| `ready` | Required configuration present. `false` (HTTP 503) when a Supabase var or `APP_URL` is missing. |
| `env` | Resolved `APP_ENV` (`development` / `preview` / `production`). |
| `checks[]` | Per‑variable presence + the `APP_ENV/project match` guard result. Booleans only — **no values**. |

**Healthy Production response:**
```json
{
  "ok": true,
  "ready": true,
  "env": "production",
  "checks": [
    { "name": "NEXT_PUBLIC_SUPABASE_URL", "ok": true },
    { "name": "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "ok": true },
    { "name": "SUPABASE_SECRET_KEY", "ok": true },
    { "name": "APP_URL", "ok": true },
    { "name": "APP_ENV/project match", "ok": true }
  ]
}
```
`APP_ENV/project match: ok` means the deployment's `APP_ENV` and its Supabase project ref agree
(§7). If it is not `ok`, **stop** — the environment is misconfigured; fix the Supabase vars before
using the deployment.

---

## 17. Deployment procedure (company-run)

```
code review on a PR → merge to main → CI (verify + integration) green
  → apply DB migrations IF this release adds any  (DEV first → integration green → Production, §8)
  → deploy the application (Vercel Git integration builds main automatically, or Option C equivalent)
  → GET /api/health on the Production URL  (§16)
  → smoke: /login, ADMIN login, dashboard, open a manual, builder, a review page, a published
           public manual page, and (if the release touches rendering/PDF) one PDF generate + GET
  → monitor error rate + /api/health for the first period after deploy
```

**A build never runs database migrations.** Migrations are a separate, deliberate step
(`supabase db push` per project) — see §8 and `docs/ENVIRONMENTS.md`. Deploying application code
that expects a migration which has not been applied to Production will fail closed or error at
runtime; apply the migration first.

---

## 18. Rollback

Two **independent** rollback classes — application and database. They are separate because
application code can be reverted freely, but the database is forward‑only and shared state.

### Application rollback
- Re‑promote the previous known‑good deployment (Vercel: *Deployments → previous Production build
  → Promote to Production*; Option C: redeploy the previous known‑good commit/artifact).
- `GET /api/health` (§16).
- Smoke the critical paths (§17).
- Safe to do immediately; no data implications **provided** the previous code is compatible with
  the current database schema (it is, unless the rolled‑past release included a migration — then
  see below).

### Database rollback
- Migrations are **forward‑only by default**. **Do not** blindly run a down‑migration against
  Production.
- To undo a schema change, author a **new corrective forward migration**, apply it to DEV, run the
  integration suite, then apply it to Production.
- Data restoration is only through **approved Supabase database operations** (point‑in‑time
  recovery / backup restore on the plan that supports it), performed deliberately by whoever holds
  Production database access — never ad hoc.
- If an application rollback crosses a release that carried a migration, the app and the schema are
  now mismatched: either roll the app forward again to the schema‑compatible version, or ship the
  corrective forward migration — do not leave a known‑incompatible pair live.

---

## 19. Operational checklist

**Before deploy**
- [ ] PR reviewed and merged to `main`; CI green (`verify` + `integration`).
- [ ] Migrations for this release (if any) applied to DEV; integration suite green on DEV.
- [ ] Release notes / change summary recorded.

**After deploy**
- [ ] Migrations for this release (if any) applied to Production, deliberately (§8).
- [ ] `GET /api/health` → healthy shape, `env: production`, `APP_ENV/project match: ok`.
- [ ] Smoke: `/login`, ADMIN login, dashboard, open a manual, builder, a review page, a published
      public manual page.
- [ ] If rendering/PDF changed: one PDF generate → READY, and a byte‑identical READY GET.
- [ ] Error rate and `/api/health` watched for the first period after deploy.

**Incident response**
- [ ] Check `/api/health` first (`ok`, `ready`, `env`, `APP_ENV/project match`).
- [ ] Check platform + Supabase logs (no secret values are logged; request IDs correlate).
- [ ] If config/env: fix the variable and redeploy. If code: application rollback (§18).
- [ ] If database: corrective forward migration (§18) — never an ad hoc production write.

**Schema change**
- [ ] New forward migration only; never edit an applied one.
- [ ] DEV → integration green → deliberate Production push.
- [ ] `supabase migration list` on both projects shows `local == remote`, drift 0.

**Role / admin change**
- [ ] Performed by an existing ADMIN in the app (audited). Bootstrap SQL is first‑admin only (§9).
- [ ] At least **two** Production ADMINs exist at all times (§20).

**PDF incident**
- [ ] Distinguish "cold start, still generating" (§14 — wait, re‑request) from a real failure.
- [ ] READY GET path unaffected by generation problems (serves stored bytes).
- [ ] `maxDuration` stays 300 s; do not lower it.

**Environment mismatch**
- [ ] `APP_ENV/project match` not `ok` → the deployment's `APP_ENV` and Supabase project disagree.
- [ ] Fix the Supabase vars / `APP_ENV` for that environment and redeploy. Never point Production
      at the DEV project or vice versa.

---

## 20. Ownership handover checklist (for the IT Head)

- [ ] Company controls the **source repository** (org‑owned; full history; branch protection).
- [ ] Company controls the **deployment project / account** (company Vercel Team, or Option C).
- [ ] Company controls the **Production domain / DNS**.
- [ ] Company controls the **Supabase organisation / projects** (DEV **and** Production).
- [ ] Company controls the **CI secrets** (`SUPABASE_TEST_*`, DEV values only).
- [ ] Company controls the **runtime secrets** (`SUPABASE_SECRET_KEY`, `PDF_PRINT_SECRET`,
      `AI_API_KEY` if used, `VERCEL_AUTOMATION_BYPASS_SECRET` if on Vercel) — regenerated, not
      copied from the outgoing developer.
- [ ] At least **two** appropriate Production administrators exist (app ADMIN role + Supabase +
      platform access) — no single point of failure.
- [ ] **DEV and Production separation verified** (`APP_ENV/project match: ok` on each; DEV work
      never touches Production).
- [ ] **CI green under company ownership** (`verify` + `integration`, integration not skipped).
- [ ] `GET /api/health` **green** on the company Production deployment.
- [ ] **Production smoke complete** (§17 list).
- [ ] **Rollback access verified** — the company can promote a previous deployment and can run a
      Supabase restore/PITR if entitled.
- [ ] **Logging / monitoring access verified** (platform logs + Supabase logs).
- [ ] The outgoing developer's **personal credentials are no longer required** for any part of
      build, deploy, database, or DNS.
- [ ] Outgoing developer's personal access **scheduled for removal** — see below.

**Do NOT revoke the outgoing developer's access until company ownership has been independently
verified** (every box above ticked and a company‑run deploy + rollback rehearsed). Remove personal
access only after the company formally accepts the handover.

---

## 21. Known risks / deferred items (carried forward)

| # | Item | Status / impact | Owner | Target review date¹ |
|---|---|---|---|---|
| A | **PDF cold-start > 180 s** (warm ~12–19 s; READY GET ~3.3 s, no Chromium; `maxDuration` 300 s) | Known performance risk. First‑request‑only, self‑healing, non‑blocking. Not a release blocker. Options: pre‑generate on publish / background queue — not implemented. | Release engineer | First post‑Phase‑8 maintenance window |
| B | **PRD-OQ-008 — multi-locale authoring UI** | Schema is ready (`manuals.locale`); MVP authors the `id` locale only. Not a Phase 8 gate. | Product | **2026-12-31** |
| C | **PRD-OQ-009 — real image scanner** | `image_assets.scan_status` field is stored; no scanner in the MVP; not a publish gate. Residual risk low — images are org‑private (RLS + signed URLs) and only enter a published snapshot after a human review round. | Platform/Security | **2026-12-31** |
| D | **PRD-OQ-012 — admin template editor** (`template:manage`) | v1 ships versioned template tables + a seeded system template; per‑manual chapter edits exist at the manual level. No admin template‑CRUD UI. Not a Phase 8 gate. | Product | **2026-12-31** |

¹ Every target review date is a **planning checkpoint for the named owner to reassess scope — not
a committed delivery date**, and not a release gate.

**Still-open non-blocking P2 hygiene items from Phase 8B** (backlog; none block release):
- `eslint@9` install‑time "no longer supported" notice — routine dev‑dependency upgrade, deferred.
- TypeScript / ESLint major‑version upgrades — deferred (no demonstrated need; avoid churn).
- Stale `db:types` npm script (assumes a local Supabase stack) — cosmetic.
- `/AGENTS.md`, `/CLAUDE.md` regenerated by `next dev` when absent — left untracked, not gitignored
  by decision.
- Optional `engines.node` pin in `package.json` — not set; CI and Vercel both pin Node 22.
- Public‑manual footer: ~1‑character cosmetic crowding of the 8px uppercase footer label at 375 px
  — no document/nested horizontal scroll; does not violate AC‑P8‑4.
- Preview deployment occasionally loads pre‑scrolled — initial scroll position only, Preview‑runtime
  only; not an overflow / AC‑P8‑4 issue.
- `prefers-reduced-motion`: verified live at Phase 8B‑12 (deployed Production CSS carries the
  comprehensive `@media (prefers-reduced-motion: reduce)` reset — transitions/animations neutralised,
  `scroll-behavior: auto`); no further action.

---

## 22. Reference index

| Topic | Authoritative document |
|---|---|
| Environment isolation, migrations, cutover, first‑admin bootstrap | [`docs/ENVIRONMENTS.md`](./ENVIRONMENTS.md) |
| Architecture, runtime boundaries, authorization model, workflow | [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) |
| Product requirements, roles, open questions (PRD §25) | [`docs/PRD.md`](./PRD.md) |
| Acceptance criteria + global invariants | [`docs/ACCEPTANCE_CRITERIA.md`](./ACCEPTANCE_CRITERIA.md) |
| Phase 8 status, AC‑P8 closure matrix, known‑risk record | [`docs/PHASE_8.md`](./PHASE_8.md) |
| Requirements traceability (incl. resolved open questions) | [`docs/REQUIREMENTS_TRACEABILITY.md`](./REQUIREMENTS_TRACEABILITY.md) |
| Dependencies policy | [`docs/DEPENDENCIES.md`](./DEPENDENCIES.md) |
| User + reviewer + publish flows | [`docs/USER_FLOWS.md`](./USER_FLOWS.md) |
| Compliance/documentation‑readiness spec (never regulatory approval) | [`docs/COMPLIANCE_REQUIREMENTS.md`](./COMPLIANCE_REQUIREMENTS.md) |
| Environment variable contract | [`.env.example`](../.env.example) |
| PDF route function settings | [`vercel.json`](../vercel.json) |
| CI workflow | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |
| First Production identity (template, run once) | [`supabase/prod-bootstrap.sql`](../supabase/prod-bootstrap.sql) |
| DEV fixture guard | [`scripts/fixtures/README.md`](../scripts/fixtures/README.md) |
