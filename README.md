# Smartin Manual Builder

Architecture-first repository for **PT Smartin Advisor Sistem's EA Developer Tools** product. The product guides MetaTrader 4/5 Expert Advisor contributors through structured, versioned, reviewable manual creation without allowing AI to invent technical facts.

## Current delivery

**Phase 1 — UI Foundation is complete.** The application is a production-quality mocked interface with no database, real authentication, rich-text editor, AI, or publishing backend yet.

- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Routes and components](docs/ROUTES_AND_COMPONENTS.md)
- [Dependencies](docs/DEPENDENCIES.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Design system](design-system/smartin-manual-builder/MASTER.md)
- [Phase 1 completion report](docs/PHASE_1.md)

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
