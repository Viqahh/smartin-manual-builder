# Implementation plan

## Phase gate policy

Each phase begins only after approval of the prior phase. Completion requires running the application, lint, TypeScript checks, browser workflow checks, console inspection, and a responsive pass where relevant. Findings and remaining work are recorded before stopping.

## Phase 0 — Architecture (this delivery)

- [x] Inspect the empty target repository.
- [x] Select modular-monolith architecture and runtime boundaries.
- [x] Define design tokens and UX guardrails.
- [x] Propose normalized data model and invariants.
- [x] Define route map and component map.
- [x] Define folder structure and dependency policy.
- [x] Record security, AI-grounding, publishing, and PDF decisions.
- [x] Stop without adding application code.

Validation for this documentation-only phase: Markdown structure/link checks, repository status check, and Git commit. Runtime/lint/typecheck are not applicable because Phase 0 intentionally has no application scaffold.

## Phase 1 — UI foundation (complete)

Scope: application shell, responsive sidebar, production-quality Indonesian dashboard, manual list, mocked create-manual wizard, three-panel builder with chapter navigation, mock blocks, reusable renderer, A4 preview, and local mocked state persistence.

Completion and acceptance evidence are recorded in [`PHASE_1.md`](PHASE_1.md). Phase 2 has not started.

Not in scope: database, real authentication, uploads, autosave backend, TipTap, drag-and-drop, AI, checklist engine, review transitions, public publishing, or PDF generation.

Checks:

1. `npm run lint`
2. `npm run typecheck`
3. production build
4. main Playwright workflow: dashboard → manuals → wizard → builder → chapter navigation → preview
5. browser console inspection
6. viewport checks at 375, 768, 1024, and 1440 pixels
7. keyboard navigation, focus visibility, reduced motion, overflow and image/table checks

## Phase 2 — Data and CRUD

Create Supabase migrations/RLS, auth adapter, organization and role model, EA/manual/section/block/parameter CRUD, private image uploads, typed server mutations, and debounced autosave with conflict handling.

Two ownership decisions are settled before the migrations are written:

- **EA parameter definitions belong to `ea_versions`** (`parameter_groups` → `ea_parameters` hang off the EA version, never off `manual_versions`). A `parameterTable` block references groups of the manual version's linked EA version. Two manual versions of the same EA version share one set of definitions.
- **Supported symbol/timeframe configurations are a Phase 2 deliverable — model *and* input UI.** The Phase 1 plain-text `symbols` / `timeframes` fields are replaced by a repeatable, functional Supported Configuration editor (`ea_version_setups`: symbol with broker suffixes, controlled MetaTrader timeframe, optional preset ref, optional tested minimum lot, optional notes, supported flag, position; unique per `(ea_version, symbol, timeframe)`; no inference of unlisted combinations). "Minimum lot" test data is stored per configuration as `tested_minimum_lot` and labeled as developer testing data, with the manual/UI stating the actual minimum lot comes from the broker's symbol specification.

## Phase 3 — Document editor

Introduce TipTap after a serialization spike. Add allowlisted custom blocks, image placement, accessible reordering, installation step builder, parameter group/table builder, and undo behavior. Phase 3 may **improve the presentation** of the supported-configuration editor (e.g. inline in the builder) but is **not** the first phase where supported configurations can be entered — that ships in Phase 2.

## Phase 4 — AI assistant

Implement `AIProvider`, mock and configured providers, grounded fact bundles, explicit missing-information results, before/after proposals, caption generation, and claim scanning. No automatic overwrite.

## Phase 5 — Validation and compliance

Implement versioned checklist templates/results, completion scoring, missing field/parameter detection, risky phrase review, and EA/manual version mismatch detection. UI wording remains “ready for review,” never “approved by regulator.”

## Phase 6 — Reviews and versioning

Implement reviewer assignment, block/chapter/general comments, approval/request-changes commands, audit history, version cloning, and published-version immutability.

## Phase 7 — Output

Finalize shared renderer, public published route, TOC/search/version navigation, print CSS, and Playwright A4 export with visual regression fixtures.

## Phase 8 — Quality

Accessibility, responsive, security and performance audits; comprehensive empty/loading/error states; TypeScript cleanup; dependency review; and end-to-end coverage of permission and publishing boundaries.

## Principal risks and mitigations

| Risk | Mitigation |
|---|---|
| Rich text model diverges from structured facts | Reference normalized entities from typed block payloads; one renderer |
| AI fabricates technical claims | Narrow fact bundle, missing-information sentinel, proposal-only apply flow, audit trail |
| Published output changes unexpectedly | Immutable snapshot + content hash + separate new-version clone |
| RLS becomes too complex to audit | Organization ID on owned rows, action-level server checks, policy tests by role |
| Three-panel UI fails on small screens | One primary content region; chapter drawer and inspector sheet |
| PDF and web layouts drift | Server renders same semantic view model and print CSS |
| Editor complexity delays product validation | Static block UI in Phase 1; TipTap only in Phase 3 after schema spike |
| Supported setups inferred from free text, or EA facts owned by the wrong entity | Explicit `ea_version_setups` rows entered via a functional Phase 2 UI; `parameter_groups`/`ea_parameters` owned by `ea_versions` so manual versions share one definition set |
