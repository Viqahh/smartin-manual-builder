# Dependency plan

Phase 0 deliberately has no `package.json`. Phase 1 will install current non-prerelease releases, commit the lockfile, and record exact versions. As of this architecture review, Next.js 16.2 is the Active LTS line and Tailwind CSS 4.3 is current; the lockfile, not this document, will become the executable source of truth.

## Phase 1 runtime

| Dependency | Purpose | Decision |
|---|---|---|
| `next`, `react`, `react-dom`, `typescript` | App Router application | Required; server components by default |
| `tailwindcss` | Token-driven responsive styles | Required |
| shadcn/ui source components | Accessible primitives owned in repository | Add only components actually used |
| `lucide-react` | Consistent SVG icons | Required; no emoji navigation icons |
| `react-hook-form`, `zod`, `@hookform/resolvers` | Wizard forms and boundary validation | Required for specified multi-step forms |

## Later-phase runtime

| Phase | Dependency | Purpose |
|---|---|---|
| 2 | `@supabase/supabase-js`, `@supabase/ssr` | PostgreSQL, storage, cookie-based SSR auth; monitor the SSR package's beta API |
| 3 | `@tiptap/react`, `@tiptap/starter-kit` and selected official extensions | Extensible editor and custom block nodes |
| 3 | `@dnd-kit/core`, `@dnd-kit/sortable` only if native controls cannot meet reorder UX | Pointer/keyboard reorder support |
| 7 | `playwright` | Server-side A4 HTML-to-PDF rendering and browser checks |

## Development dependencies

- ESLint with Next.js configuration.
- Prettier only if the team requires format enforcement; do not add competing lint format rules.
- Vitest + Testing Library when Phase 2 introduces domain logic and interactive components.
- Playwright begins in Phase 1 for the acceptance workflow if browser checks cannot be covered by the existing environment.

## Explicit non-dependencies

- **No Prisma initially:** Supabase migrations, generated database types, and RLS are enough. Add Prisma only if measured query or migration pain justifies it.
- **No global state library in Phase 1:** URL state, server data, and local React state cover the mock workflows.
- **No animation library:** CSS transitions cover the calm enterprise interaction model.
- **No charting library:** Phase 1 metrics do not require charts.
- **No custom component package:** shadcn/ui primitives are copied selectively and remain local.
- **No AI SDK until Phase 4:** provider requirements should drive the choice.
- **No queue until PDF/AI workloads prove one is needed.**

## Environment contract (introduced with consuming phase)

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
AI_PROVIDER=
AI_API_KEY=
APP_URL=
```

Secret values remain server-only. Phase 2 validates environment variables at startup; the application runs with mocked data/AI when their phase permits it.

## Reference baselines

- [Next.js release blog](https://nextjs.org/blog)
- [Tailwind CSS releases](https://tailwindcss.com/blog)
- [Supabase SSR authentication](https://supabase.com/docs/guides/auth/server-side)
- [TipTap extensions](https://tiptap.dev/docs/editor/core-concepts/extensions)
