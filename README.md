# Smartin Manual Builder

Architecture-first repository for **PT Smartin Advisor Sistem's EA Developer Tools** product. The product guides MetaTrader 4/5 Expert Advisor contributors through structured, versioned, reviewable manual creation without allowing AI to invent technical facts.

## Current delivery

**Phase 0 — Architecture is complete.** No application runtime has been scaffolded yet because the product brief explicitly requires approval before Phase 1.

- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Routes and components](docs/ROUTES_AND_COMPONENTS.md)
- [Dependencies](docs/DEPENDENCIES.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Design system](design-system/smartin-manual-builder/MASTER.md)

## Repository inspection

The target directory was empty and was not a Git repository. Phase 0 therefore establishes the technical source of truth without prematurely adding runtime dependencies or application scaffolding.

## Product guardrails

1. Structured EA data is the source of truth.
2. AI may rewrite supplied facts but may not invent facts or performance claims.
3. Drafts and private assets require server-side authorization and storage policies.
4. Automated checks indicate documentation readiness, never regulatory approval.
5. Published manual versions are immutable and remain addressable.
6. Phase boundaries require explicit approval.

## Next step

After Phase 0 approval, Phase 1 will add the Next.js UI foundation with mocked data only, then run lint, TypeScript, browser workflow, console, and responsive checks before stopping again.
