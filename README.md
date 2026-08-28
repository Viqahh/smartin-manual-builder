# Smartin Manual Builder

Architecture-first repository for **PT Smartin Advisor Sistem's EA Developer Tools** product. The product guides MetaTrader 4/5 Expert Advisor contributors through structured, versioned, reviewable manual creation without allowing AI to invent technical facts.

## Current delivery

**Phase 1 — UI Foundation is complete.** The application is a production-quality mocked interface with no database, real authentication, rich-text editor, AI, or publishing backend yet.

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
| [Design System](design-system/smartin-manual-builder/MASTER.md) | Colour, type, spacing, component specs, motion, anti-patterns, pre-delivery checklist. |

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The mocked wizard and selected builder chapter persist in browser storage.

## Product guardrails

1. Structured EA data is the source of truth.
2. AI may rewrite supplied facts but may not invent facts or performance claims.
3. Drafts and private assets require server-side authorization and storage policies.
4. Automated checks indicate documentation readiness, never regulatory approval.
5. Published manual versions are immutable and remain addressable.
6. Phase boundaries require explicit approval.

## Next step

Phase 2 remains blocked pending explicit approval. It will introduce Supabase data/auth/storage and CRUD according to the committed architecture.
