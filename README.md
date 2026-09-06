# Smartin Manual Builder

Architecture-first repository for **PT Smartin Advisor Sistem's EA Developer Tools** product. The product guides MetaTrader 4/5 Expert Advisor contributors through structured, versioned, reviewable manual creation without allowing AI to invent technical facts.

## Current delivery

**Phases 1–8 are complete.** Phases 1–7 implemented; Phase 8A / 8A.5 closed; **Phase 8B — Final
Quality & Release Closeout is COMPLETE** (slices 8B-1 … 8B-12). All nine Phase 8 MUST acceptance
criteria are PASS; one SHOULD criterion (AC-P8-7) is PASS WITH KNOWN RISK (PDF cold-start
generation — non-blocking, owned); there is no known release blocker. This is an internal
engineering completion statement and does **not** imply Bappebti / regulator approval or compliance
certification. DEV/Preview and Production run on separate Supabase projects
(`docs/ENVIRONMENTS.md`); migration 32 is applied to both, drift 0. Acceptance matrix, migration
history, and the environment map: [`docs/PHASE_8.md`](docs/PHASE_8.md) and
[`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md). IT / infrastructure handover:
[`docs/INTEGRATION.md`](docs/INTEGRATION.md). The phase-by-phase history below is preserved as
written at the time each phase shipped.

**Phase 2 — Data & CRUD is implemented** (Supabase Postgres + Auth + Storage, RLS, organisation/role model, EA product/version/supported-configuration/parameter CRUD, manual + manual-version + section + block persistence, private image upload, real dynamic manual routing, action-based server authorization, `row_version` autosave with conflict handling, unit tests, CI). `lint`, `typecheck`, `test`, and `build` all pass.

The schema is applied to Supabase DEV and the Phase 2 live integration suite (`tests/integration/rls.test.ts`) passes **27 / 0 / 0** — see [`docs/PHASE_2.md`](docs/PHASE_2.md).

**Phase 3 — Document editor is implemented** (TipTap for rich text only; structured React editors for steps / image / callout tone / parameterTable / faq; block add/edit/autosave/duplicate/reorder/soft-delete/restore; chapter reorder + custom-chapter CRUD; snapshot undo/redo; in-editor image upload; completion gates for empty ALT and danger-mode warnings). Persistence stays structured JSON — no raw HTML, no `dangerouslySetInnerHTML`. Serialization spike: [`docs/PHASE_3_SERIALIZATION_SPIKE.md`](docs/PHASE_3_SERIALIZATION_SPIKE.md). Full report: [`docs/PHASE_3.md`](docs/PHASE_3.md). `lint` / `typecheck` / `test` (111 pass) / `build` all pass. **Migration `20260901000800_phase3_section_management.sql` still needs applying to Supabase DEV** for chapter-reorder persistence.

Phase 1 (mocked UI foundation) is recorded in [`docs/PHASE_1.md`](docs/PHASE_1.md).

## Documentation

The documentation is split into a **Product** layer (what the product is and must do) and an **Engineering** layer (how it is built). The product layer was written after Phase 1 to make the existing phased architecture explicit; it does not redesign the product.

### Product documentation

| Document | Purpose |
|---|---|
| [Product Requirements (PRD)](docs/PRD.md) | Vision, users, roles, functional and non-functional requirements, security, versioning, AI, compliance-assistance, output, success criteria, MVP vs later scope, risks, assumptions, open questions. |
| [User Flows](docs/USER_FLOWS.md) | End-to-end and per-feature flows (create/use EA, versions, draft, upload, parameters, review, changes requested, publish, new version after publication) with Mermaid diagrams. |
| [UI Specification](docs/UI_SPEC.md) | Per-route spec: purpose, layout, sections, components, fields, actions, validation, loading/empty/error/disabled/success states, responsive + accessibility, data source, permissions, future-phase notes. Includes the three-panel manual builder. |
| [Content Requirements](docs/CONTENT_REQUIREMENTS.md) | The canonical 18-chapter Smartin EA Manual Book structure; per chapter: purpose, required/optional information, allowed content blocks, expected screenshots/tables, validation, and prohibited claims. |
| [Compliance Requirements](docs/COMPLIANCE_REQUIREMENTS.md) | Documentation/compliance-assistance spec: required manual information, risk disclosure, claim prohibitions, checklist states (`PASS` / `WARNING` / `MISSING` / `NOT_APPLICABLE`), and the hard separation between automated documentation checks and human/regulatory approval. **The tool never grants regulatory approval.** |
| [Requirements Traceability](docs/REQUIREMENTS_TRACEABILITY.md) | Matrix mapping every requirement to source, priority, user, page, data entity, phase, status, and acceptance evidence. |
| [Acceptance Criteria](docs/ACCEPTANCE_CRITERIA.md) | Objective pass/fail criteria for Phases 1–8, plus global invariants and the phase-gate procedure. |

### Engineering documentation

| Document | Purpose |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Modular-monolith decision, runtime boundaries, folder structure, authorization model, workflow invariants, editor/AI/publishing architecture. |
| [Data Model](docs/DATA_MODEL.md) | Normalized entities, JSON boundaries, database-enforced invariants, index plan, seed strategy. |
| [Routes and Components](docs/ROUTES_AND_COMPONENTS.md) | Route map, application shell, dashboard/list/wizard/builder component maps, shared interaction rules. |
| [Dependencies](docs/DEPENDENCIES.md) | Per-phase runtime and dev dependency policy, environment contract, explicit non-dependencies. |
| [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) | Phase 0–8 roadmap, phase-gate policy, principal risks and mitigations. |
| [Phase 1 completion report](docs/PHASE_1.md) | Delivered scope and acceptance verification for the UI foundation. |
| [Phase 2 completion report](docs/PHASE_2.md) | Delivered scope, schema/migrations, ownership model, auth/RLS, autosave strategy, acceptance-criteria results, known limitations, external-credential limitations. |
| [Phase 3 serialization spike](docs/PHASE_3_SERIALIZATION_SPIKE.md) | Mandatory pre-TipTap spike: 6-block-type round-trip through structured JSON, security treatment, architecture rationale. |
| [Phase 3 completion report](docs/PHASE_3.md) | Document editor: editor architecture, TipTap schema, block model, image flow, parameter ownership, reorder + undo design, `@dnd-kit` + PRD-OQ-002 decisions, permissions, security, responsive + test evidence, AC-P3 matrix. |
| [Design System](design-system/smartin-manual-builder/MASTER.md) | Colour, type, spacing, component specs, motion, anti-patterns, pre-delivery checklist. |

## Run locally

```bash
npm install
```

### Without Supabase

```bash
npm run dev
```

Open `http://localhost:3000`. The app boots; `/api/health` reports `ready:false` and the workspace shows a "Supabase belum dikonfigurasi" panel. `/login` and static routes work.

### With Supabase (the real data path)

1. `cp .env.example .env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APP_URL`. Never commit `.env.local`.
2. Apply the schema + seed:
   ```bash
   # local stack (needs Docker + the supabase CLI)
   supabase start
   supabase db reset            # replays supabase/migrations/ then supabase/seed.sql
   # OR hosted
   supabase link --project-ref <ref> && supabase db push
   ```
3. `npm run dev`. Sign in with a seeded demo user (`developer@smartin.demo` / `demo-password-123`, local only).

### Checks

```bash
npm run lint
npm run typecheck
npm run test              # unit tests; RLS/data-layer integration tests are credential-gated (self-skip)
npm run test:integration  # live DEV Supabase only — see docs/ENVIRONMENTS.md before running this
npm run build
```

`npm run test:integration` requires `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` (and optionally
`SUPABASE_TEST_SECRET_KEY`, else it falls back to `SUPABASE_SECRET_KEY`) pointed at the **DEV**
Supabase project. A fail-closed guard (`tests/integration/_guard.ts`) aborts the whole suite if
the target resolves to Production or an unrecognised project — see `docs/ENVIRONMENTS.md`. CI runs
this same job automatically on `main` once the three secrets are configured in the repository's
Actions settings.

## Product guardrails

1. Structured EA data is the source of truth.
2. AI may rewrite supplied facts but may not invent facts or performance claims.
3. Drafts and private assets require server-side authorization and storage policies.
4. Automated checks indicate documentation readiness, never regulatory approval.
5. Published manual versions are immutable and remain addressable.
6. Phase boundaries require explicit approval.

## Status

Phases 1–8 are complete. The `AC-P8-1..10` acceptance matrix (all MUST criteria PASS; AC-P8-7 PASS
WITH KNOWN RISK) is in [`docs/PHASE_8.md`](docs/PHASE_8.md) §8B-11 / §8B-12. Taking the application
onto company-owned infrastructure (source repo, deployment, Supabase, domain, secrets) is covered
end-to-end in [`docs/INTEGRATION.md`](docs/INTEGRATION.md).
