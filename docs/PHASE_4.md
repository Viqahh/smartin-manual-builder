# Phase 4 completion report — Grounded AI assistant

> **Status: APPROVED. Phase 4 finalized — implementation + acceptance verification complete and
> committed (`feat(phase-4): add grounded AI assistant`). Phase 5 not started.**
>
> The AI is a **writing assistant, never a source of EA facts**. Every provider call receives
> exactly `{ selectedText, factBundle, locale, operation }` and nothing else. A provider returns
> either a before/after `RevisionProposal` (never auto-applied) or
> `ADDITIONAL_INFORMATION_REQUIRED`. A deterministic post-response grounding guard blocks any
> proposal that introduces a number / symbol / timeframe / setup-combination absent from the
> selection or the allow-listed facts. `detectClaims` is a deterministic, **advisory** scan of
> compliance-risk language — it never edits content, changes workflow status, marks a manual
> compliant, or blocks anything.
>
> `npm run lint` ✅ · `npm run typecheck` ✅ · `npm run test` ✅ **219 passed / 41 skipped**
> (the 41 skips are `tests/integration/rls.test.ts`, credential-gated in the plain run) ·
> `npm run build` ✅.
>
> **Post-review corrections applied:** (1) trading-symbol / timeframe grounding comparison
> is now **case-insensitive with a curated forex/index token model** (`eurusd`, `EURUSD`,
> `EurUsd`, `eurusd H1` are all caught; broker-suffix exactness preserved — `XAUUSD.m/M15` never
> implies `XAUUSD/M15`); +8 grounding tests (13 total). (2) The AI-accept save line now
> **derives from the real Phase 3 per-block autosave state** (`Belum disimpan → Menyimpan… →
> Tersimpan`, or `Gagal menyimpan` / conflict) instead of a static `Menyimpan…`; a no-op accept
> shows `teks sudah sesuai — tidak ada perubahan`. (3) Responsive verified with a rendered
> browser at **375 / 768 / 1024 / 1440** (geometry assertions + interactive
> proposal / AIR / claim-scan flows) plus a **production-build fresh-tab console check** (zero
> logs). (4) `.claude/launch.json` (and Next-dev-generated `AGENTS.md` / `CLAUDE.md`) removed
> from the tree; no credentials, no `.env.local`, no fixtures committed.
>
> ### Final live verification (finalization run)
>
> | Gate | Result |
> |---|---|
> | `npx vitest run tests/integration` (live Supabase DEV credentials loaded) | **41 passed / 0 failed / 0 skipped** |
> | `npm run test` (plain run) | **219 passed** · 41 skipped — the `tests/integration/rls.test.ts` file, credential-gated by design in the plain command |
> | `npm run lint` | **PASS** (0 errors, 0 warnings) |
> | `npm run typecheck` | **PASS** |
> | `npm run build` | **PASS** (Compiled successfully; all routes) |
> | Configured real-provider live API call | **NOT TESTED** — no `AI_PROVIDER` / `AI_API_KEY` configured; covered only by deterministic fake-transport unit tests. This is **not** "PASS". |
>
> **Live Supabase DEV integration: `npx vitest run tests/integration` → 41 passed / 0 failed /
> 0 skipped** (36 unchanged Phase 2/3 cases + 5 new `ai_revisions` RLS/idempotency cases). Run
> repeatedly; DEV returns to the seed steady state each time (asserting cleanup).
>
> **Migration applied to DEV** (`supabase migration list --linked`):
> `20260901001000_ai_revisions` — created **after** `20260901000900_phase3_section_delete_integrity`.
> No deployed migration was edited.
>
> **Configured (real vendor) provider:** architecture is vendor-neutral behind an `AiTransport`
> interface; the one concrete adapter shipped is **Anthropic Messages API**
> (`AI_PROVIDER=anthropic`). `.env.local` has **no** AI credentials, so the live
> configured-provider smoke test is **NOT TESTED** (see §16). The adapter is fully covered by
> deterministic unit tests with a fake transport.

Baseline: `docs/IMPLEMENTATION_PLAN.md` Phase 4, `docs/ACCEPTANCE_CRITERIA.md` AC-P4-1…11,
`docs/PRD.md` (PRD-AI-001…007, PRD-SEC-006, PRD-OUT-006), `docs/COMPLIANCE_REQUIREMENTS.md` §4,
`docs/ARCHITECTURE.md`, `docs/PHASE_2.md`, `docs/PHASE_3.md`.

Approved Phase 3 commit: `9580b135db7de87952e45e59fb591b07e578c3e1`.

---

## 1. Scope implemented

| Area | Delivered |
|---|---|
| **`AIProvider` interface** | `lib/ai/types.ts` — `improveText`, `simplifyText`, `technicalRewrite`, `generateSteps`, `generateCaption`, `detectClaims`; `readonly mode: "mock" \| "configured"`, `readonly label`. Client-import-safe (no `server-only`, no vendor SDK, no env access). |
| **Mock provider (default)** | `lib/ai/providers/mock.ts` — deterministic, lexical only (whitespace/casing + a small fixed plain-language & de-marketing dictionary). Never introduces a number, symbol, or timeframe. Obeys grounding, fact references, `ADDITIONAL_INFORMATION_REQUIRED`, and the result schema. Label `"Mock AI"`. |
| **Configured provider** | `lib/ai/providers/configured.ts` wraps an injected `AiTransport`. Owns the *contract*: untrusted-content system prompt, JSON-only output, Zod validation of every response, `ADDITIONAL_INFORMATION_REQUIRED` passthrough, deterministic `detectClaims`. Malformed output → `AiProviderError("MALFORMED_RESPONSE")`, never a write. |
| **Vendor transport** | `lib/ai/transport/types.ts` (`AiTransport`) + `lib/ai/transport/anthropic.ts` (`server-only`). The only place any vendor detail lives. `fetch` to `https://api.anthropic.com/v1/messages`; key in the `x-api-key` header only; `AbortController` timeout; non-2xx → `BAD_STATUS` with **no response body** surfaced. |
| **Provider selection** | `lib/ai/providers/index.ts` (`server-only`). Both env vars absent (or `AI_PROVIDER=mock`) → mock. Both present → configured. Exactly one present → `AiProviderError("CONFIG")` — **no silent fallback**. `currentProviderMode()` for status without touching credentials. Memoised; `__resetAIProviderForTests()`. |
| **Grounded request** | `lib/ai/grounded-request.ts` — `buildGroundedRequest` constructs exactly the 4 allowed keys in fixed order + `Object.freeze`. `assertGroundedRequestShape` throws on any extra / missing key and on Zod failure. `serializeGroundedRequest` = `JSON.stringify` after the shape assertion — the *only* string sent to a transport. |
| **Fact bundle (allow-list)** | `lib/ai/fact-bundle.ts` — facts come ONLY from the current Manual Version + its linked EA Version: `ea:*` identity, one `setup:<uuid>` per supported configuration **with `symbol`+`timeframe` kept paired** (GI-10), `requirement:<key>`, `parameterGroup:<uuid>` / `parameter:<uuid>` (linked EA version only, GI-11), `chapter:<key>`, `block:*`, `blockContent:current` (allow-listed plain text, sliced to 8 000 chars), `image:<uuid>` = `{altText, caption}` **only** (never a signed URL or binary). |
| **Fact references** | `lib/ai/fact-references.ts` — every id in `proposal.factReferences` must exist in the supplied bundle; any provider-invented id ⇒ the whole result is rejected. |
| **Anti-hallucination grounding guard** | `lib/ai/grounding.ts` — deterministic post-response check. Builds allowed sets of numbers, MT timeframes, and trading symbols from `selectedText` + all fact values, comparing on an **upper-cased canonical form (case-insensitive)** while preserving the original for display. A "symbol" is a forex/metal pair (two ISO currency codes) or a known CFD index/crypto ticker, optionally with a broker suffix; the **suffix stays significant** (`XAUUSD.m` ≠ `XAUUSD`). Flags any output number/timeframe/symbol outside the allowed sets. Per line: a **known** symbol co-occurring with a timeframe must be an exact stored `setup` pair (or appear verbatim in the source) — this blocks a fabricated `XAUUSD/H1` even though `XAUUSD` and `H1` are individually known. Violation ⇒ `{ok:false, violations[]}` ⇒ Accept disabled + grounding error shown. |
| **Claim scanner** | `lib/ai/claim-scanner.ts` — one rule per `COMPLIANCE_REQUIREMENTS.md` §4 category (10 total; a runtime guard throws if that count ever drifts). Bilingual (Bahasa Indonesia + English) regex rules, `CLAIM-UNCONDITIONED-PERF` gated by a performance-number pattern and suppressed when full test conditions are present. Findings are typed `ClaimFinding` with `severity: "advisory"`, excerpt, location, explanation, recommended action. Used verbatim by **both** providers' `detectClaims`. |
| **Whole-manual claim scan** | `lib/ai/manual-projection.ts` — controlled text projection of the **current** Manual Version only (chapter titles, `text`/`callout` bodies, `faq` Q+A, `steps` text, image captions). Never other manuals, DB internals, URLs, or source. |
| **Canonical input hash / idempotency** | `lib/ai/hash.ts` — `hashAiRequest` = SHA-256 of a `stableStringify` (recursively key-sorted — the Phase 3 jsonb fix) of `{operation, locale (trimmed/lowered), normalised selectedText, factBundle, target}`. Same logical bundle with different key order ⇒ same hash. Covers operation / selectedText / factBundle / locale / target identity. No secret is ever part of the digest. |
| **Server actions** | `features/ai/actions.ts` (`"use server"`) — `requestAiRevision`, `resolveAiRevision`, `scanManualClaims`. Each: `requireActiveOrg()` → `assertCan(roles, "manual:update")` (aggregated across roles), re-derives the whole manual + facts from the DB (never trusts client facts), builds the 4-key request, hashes it, dedupes a PENDING row, calls the provider, validates fact refs + grounding, and writes an `ai_revisions` audit row + `writeAudit`. |
| **`ai_revisions` table** | `supabase/migrations/20260901001000_ai_revisions.sql` — org-scoped audit trail; composite FK `(manual_version_id, organization_id)` → `manual_versions`; partial unique index `ai_revisions_pending_dedup (manual_version_id, input_hash) WHERE decision = 'PENDING'`; RLS: read = org member, insert/update = `app.can_author` **and** `actor_id = auth.uid()`, no delete; explicit `authenticated` grants (select/insert/update only). |
| **Builder inspector AI panel** | `features/ai/ai-panel.tsx` — always-visible provider-mode badge ("Mock AI — mode pengembangan, hasil simulasi"), operation buttons with a visible disabled reason, SEBELUM/SESUDAH diff, provider + facts-used chips, grounding status (pass = green, fail = red block that disables **Terima**), `[Terima]`/`[Tolak]`, "Informasi tambahan diperlukan" view with navigation hints, "Pindai klaim manual" + advisory finding cards, loading/retry/error states. Renders in the desktop inspector and the mobile/tablet inspector drawer (`features/manuals/manual-builder.tsx`). |
| **Target-aware apply + undo/redo + save state** | `SectionEditor` (now `forwardRef`) exposes `applyProposal(blockKey, targetField, output) → { ok, changed }` and `blockPayloadHash(blockKey)`, and reports the applied block's live autosave state via `onAiApplyStateChange`. Accept: stale-target check (captured hash vs live hash) → apply optimistically → `pushSnapshot` (one undo step for the pre-AI state) → persist through the **existing** single-flight autosave queue (`saver.queue(..., immediate)`); the panel then shows `Belum disimpan → Menyimpan… → Tersimpan` (or `Gagal menyimpan` / conflict) from that queue's own transitions — no parallel mechanism, no fake timeout. Undo restores the pre-AI text; Redo restores the accepted proposal; Reject changes neither history nor content nor save state. `text` + `generateSteps` → the block is converted to a `steps` block; `generateCaption` writes the `caption` field only and never touches ALT. |
| **Env contract** | `.env.example` documents mock-by-default, both-or-neither, and the optional `AI_MODEL` override; states `AI_API_KEY` is server-only. |

**Nothing outside Phase 4 was enabled.** No checklist / readiness-score engine, no `checklist_results`, no review workflows, reviewer comments, approval, publishing, public route, PDF, or version cloning. `detectClaims` remains advisory-only.

## 2. Configured-provider decision & rationale

The environment contract names `AI_PROVIDER` / `AI_API_KEY` but pins no vendor. **Anthropic's
Messages API** was chosen for the one concrete adapter: a plain JSON HTTP endpoint (no SDK on
Node 20), first-class support for a strict system prompt + JSON-only output, and alignment with
this project's tooling. Everything Anthropic-specific is confined to
`lib/ai/transport/anthropic.ts`; the rest of the app depends only on `AiTransport` / `AIProvider`.
Swapping vendors is a new `AiTransport` implementation and one line in `providers/index.ts` —
nothing else.

`detectClaims` is **deterministic in both providers** (rule-based `scanClaims`, not the LLM).
Rationale: §4 compliance-category coverage must be testable and reproducible, and the AI is not
the compliance authority. This is a deliberate, documented divergence from "the provider does
everything".

## 3. GroundedRequest schema (the only thing a provider ever receives)

```ts
type GroundedRequest = {
  selectedText: string;              // the developer's current text for the target field
  factBundle: { facts: Fact[] };     // allow-listed — see §4
  locale: string;                    // e.g. "id"
  operation: "improveText" | "simplifyText" | "technicalRewrite"
           | "generateSteps" | "generateCaption";
};
```

`groundedRequestSchema` is `.strict()`. `assertGroundedRequestShape` additionally rejects any
top-level key that is not one of these four and any missing key, then runs the Zod parse.
Explicitly **excluded**: organisation records, memberships, other manuals, other users, auth /
session / JWT, Supabase keys, signed URLs, source code, audit logs, arbitrary DB context.

## 4. FactBundle allow-list

| `kind` | id shape | value | source surface |
|---|---|---|---|
| `ea` | `ea:name` / `ea:platform` / `ea:version` / `ea:manualVersion` | scalar | EA Product / EA Version / Manual Version |
| `setup` | `setup:<uuid>` | `{symbol, timeframe, testedMinimumLot, presetRef, notes, isSupported}` — **symbol+timeframe paired** | Supported Configuration |
| `requirement` | `requirement:<key>` | the requirement value | EA Version — Persyaratan |
| `parameterGroup` | `parameterGroup:<uuid>` | `{name}` | EA Version — Parameter |
| `parameter` | `parameter:<uuid>` | full definition (name, type, default, unit, range, mutability, …) | EA Version — Parameter |
| `chapter` | `chapter:<key>` | `{key, title}` | this chapter |
| `block` | `block:<id\|current>` | `{type}` | this block |
| `blockContent` | `blockContent:current` | allow-listed plain text, ≤ 8 000 chars | this block |
| `image` | `image:<uuid>` | `{altText, caption}` **only** | Metadata gambar |

GI-10: a supported configuration is one `setup` fact; symbols and timeframes are never flattened
into separate lists, so `XAUUSD/M15` + `EURUSD/H1` can be represented without ever implying
`XAUUSD/H1`. GI-11: parameter facts come only from the linked EA Version.

## 5. Fact-reference validation (§6)

Every `RevisionProposal` carries `factReferences: string[]`. `validateFactReferences` checks each
id against the supplied bundle; an unknown id ⇒ `requestAiRevision` returns `INTERNAL` ("AI
mengembalikan referensi fakta yang tidak dikenal. Hasil ditolak.") and **no row is written with a
usable proposal**. Provider-supplied ids are never trusted as-is.

## 6. Anti-hallucination grounding validation (§13, AC-P4-7)

`validateGrounding({ selectedText, facts, output })` — all comparison is done on an
**upper-cased canonical form** (case-insensitive), but the original text is preserved for display:

- **Numbers** — every numeric literal in the output must appear (normalised) in `selectedText`
  or a fact value.
- **Timeframes** — MetaTrader tokens (`M1 M5 M15 M30 H1 H4 D1 W1 MN1`, longest-first) matched
  **case-insensitively** (`h1`, `H1`, `M15`).
- **Symbols** — a symbol is specifically a **forex/metal pair** (two ISO-4217 currency/metal
  codes, e.g. `EURUSD`, `XAUUSD`, `GBPJPY`) or a **known CFD index/crypto ticker**
  (`US30`, `NAS100`, `BTCUSD`, …), each optionally with a broker suffix (`.m`, `.pro`,
  `_raw`). Matched **case-insensitively**, so `eurusd`, `EURUSD`, `EurUsd` are one token — and
  ordinary prose ("folder", "sistem", "produk") never matches because it does not contain two
  concatenated currency codes. The **broker suffix stays significant**: `XAUUSD.m` and
  `XAUUSD` are distinct tokens, so a stored `XAUUSD.m / M15` never implies `XAUUSD / M15`,
  `XAUUSD.m / H1`, or `EURUSD.m / M15`.
- **Combinations** — per output line, a *known* symbol co-occurring with a timeframe must be an
  exact stored `setup` pair (compared after normalisation, suffix included), or appear verbatim
  in the source. This blocks "EA mendukung EURUSD H1 dengan win rate 90%" — and also
  `XAUUSD H1` — when only `XAUUSD/M15` is stored, and a supported pair with only-casing
  differences (`xauusd / m15`) still passes.

Any violation ⇒ `{ ok: false, violations: string[] }`. The panel then shows the grounding-error
block and **disables Terima**; nothing can reach a block. `detectClaims` independently flags the
"win rate 90%" style phrasing as `CLAIM-UNCONDITIONED-PERF`.

Because the Mock provider is purely lexical it never trips the guard on a legitimate rewrite. A
configured LLM that hallucinated a fact would be caught here (Accept disabled, retry offered) —
the guard errs toward blocking, which is the safe direction. Covered by 13 `validateGrounding`
unit tests (5 original + 8 case-normalisation cases: unsupported lower/mixed-case symbol,
lowercase timeframe, mixed-case pair, broker-suffix exactness, supported-pair casing difference,
unsupported combination of two known values, fabricated lowercase symbol + number).

## 7. ADDITIONAL_INFORMATION_REQUIRED behaviour (§12, AC-P4-5)

When the facts/selection are insufficient the provider returns
`{ status: "ADDITIONAL_INFORMATION_REQUIRED", missingFacts: [{ label, hint?, surface? }] }`.
The mock does this for: source text shorter than 3 meaningful chars (improve/simplify/technical),
no usable instruction lines (`generateSteps`), and no image ALT/caption (`generateCaption`). The
panel renders "Informasi tambahan diperlukan" with each missing fact, its hint, and the real data
surface to edit (`Blok teks`, `Metadata gambar`, …). No prose is generated and no row is left
`PENDING`.

## 8. Proposal workflow & Accept/Reject semantics (§17–§19, AC-P4-6)

1. Operation click → `requestAiRevision` → provider → (fact-ref + grounding validation) →
   `ai_revisions` row (`decision = 'PENDING'` for a proposal, `'N/A'` for AIR).
2. Panel shows SEBELUM / SESUDAH, provider, facts used, grounding status.
3. **Terima**: captured-hash vs live-hash staleness check → `applyProposal` (routed through the
   normal autosave queue → editor history) → `resolveAiRevision(ACCEPTED, appliedAgainstHash)`.
   The block never changes before this click.
4. **Tolak**: `resolveAiRevision(REJECTED)`; the proposal is discarded; content and undo history
   are untouched.
5. **Undo** restores the pre-AI text (one snapshot pushed on apply); **Redo** re-applies the
   accepted proposal. Persistence uses the Phase 3 single-flight autosave + `row_version`
   conflict mechanism — there is **no parallel write path**.
6. A stale target (block edited after the proposal was generated) ⇒ Accept is refused with
   "Konten blok berubah setelah proposal dibuat. Buat ulang proposal terhadap konten terbaru."
7. **Save state after Accept** is the block's real Phase 3 autosave state, forwarded from
   `SectionEditor` (`onAiApplyStateChange`) to the panel: `Belum disimpan → Menyimpan… →
   Tersimpan`, or `Gagal menyimpan (coba simpan lagi dari blok)` / `Konflik perubahan
   (selesaikan konflik di editor)`. There is no fake timeout — the label is `SAVE_STATE_LABEL`
   keyed on the autosave-queue transition. A no-op accept (the proposal equals current content)
   shows `teks sudah sesuai — tidak ada perubahan` and still records the `ACCEPTED` decision.
   **Reject** never sets any save state.

## 9. `ai_revisions` schema & idempotency (§21–§23, AC-P4-9/10)

Columns: `id`, `organization_id` (FK → organizations, cascade), `manual_version_id`,
`section_id?`, `block_id?`, `target_field?` (check), `actor_id` (FK → profiles, set null),
`operation` (check, 6 values), `input_hash`, `locale`, `fact_reference_ids text[]`,
`status` (`PROPOSAL` / `ADDITIONAL_INFORMATION_REQUIRED` / `SCAN`), `proposed_output jsonb`,
`grounding_ok bool`, `grounding_violations text[]`, `provider`, `provider_model`,
`provider_metadata jsonb` (request id + duration only — **no credential**), `decision`
(`PENDING` / `ACCEPTED` / `REJECTED` / `N/A`), `decided_at`, `applied_row_version bigint`,
`created_at`. Composite FK `(manual_version_id, organization_id)` → `manual_versions`.

**Never stored:** `AI_API_KEY`, auth/session token, signed URL, source code, raw DB context.

**Idempotency:** partial unique index `ai_revisions_pending_dedup (manual_version_id, input_hash)
WHERE decision = 'PENDING'`. `requestAiRevision` first selects an existing PENDING row for the
hash and re-serves it (`deduped: true`, no provider call). A concurrent identical request that
loses the insert re-reads the winner's row. `resolveAiRevision` is a no-op when the row is
already decided (`alreadyDecided: true`). Verified by integration test (a duplicate PENDING
insert returns Postgres `23505`).

## 10. Security & privacy (§10, §20, §28, §31)

- AI actions require `manual:update`, aggregated across the caller's roles — `developer@` (also
  TECHNICAL_REVIEWER) keeps the capability; a lone TECHNICAL_REVIEWER / COMPLIANCE_REVIEWER
  cannot invoke or apply. Enforced server-side even if a client forged the request.
- RLS on `ai_revisions`: outsider (Org B) reads none of Org A's rows and cannot insert into
  Org A; anon cannot read or mutate; reviewers can read the audit but not write. Verified live.
- The configured system prompt states the user message is **untrusted document content**;
  manual text is data, not instructions.
- `AI_API_KEY` never reaches the client bundle (grep of `.next/static`: the only match is the
  UI label string `"… (AI_PROVIDER / AI_API_KEY)"`; no `x-api-key`, `api.anthropic.com`, or
  `sb_secret`), the provider payload, logs, `ai_revisions`, or an error message. Transport
  errors surface a class + HTTP status only, never a response body.
- Logs contain request id / revision id / operation / provider / duration / success-or-error
  class / hashes — never selected text, proposal text, the full fact bundle, or credentials.

## 11. Test evidence

### Unit — `npm run test` → 219 passed / 41 skipped (integration file, credential-gated)

New files:

- `tests/unit/ai-domain.test.ts` (49 tests) — GroundedRequest exact-4-keys + extra-key
  rejection + no-signed-URL serialisation; FactBundle paired setups / linked-EA params /
  image-metadata-only / no cross-org leak; `hashAiRequest` key-order stability + operation /
  selectedText / target sensitivity; `validateGrounding` allows a clean rewrite, blocks a new
  number / symbol / timeframe / unlisted combination, allows an exact stored pair, **plus 8
  case-normalisation cases** (lower/mixed-case unsupported symbol, lowercase timeframe,
  mixed-case pair, broker-suffix exactness, supported-pair casing difference, unsupported
  combination of two known values, fabricated lowercase symbol + number);
  `validateFactReferences` accepts known / rejects invented; `MockAIProvider` all six methods +
  AIR + structured steps + caption + `detectClaims`; `ConfiguredAIProvider` with a fake
  transport — sends only the 4-key payload with no key, parses a fenced PROPOSAL, passes AIR
  through, rejects malformed JSON + schema-invalid output as `MALFORMED_RESPONSE`, maps
  transport timeout / unavailability, `detectClaims` never calls the transport; provider
  selection (`resolveProviderMode` / `getAIProvider` / `currentProviderMode`) no-env → mock /
  both → configured / partial → config error / unknown vendor → config error.
- `tests/unit/ai-claim-scanner.test.ts` (34 tests) — every one of the 10 §4 categories detected
  from a Bahasa Indonesia fixture and (where the rule set carries it) an English fixture; 5
  clean control fixtures raise nothing; advisory shape (category / label / excerpt / explanation
  / action / location, `severity: "advisory"`); input array not mutated; `CLAIM-UNCONDITIONED-PERF`
  suppressed when full test conditions are present.
- `tests/unit/ai-anthropic-transport.test.ts` (7 tests) — key required; POST to the Messages
  API with the key in `x-api-key` **only** (never in the body); safe label/model metadata;
  abort → `TIMEOUT`; non-2xx → `BAD_STATUS` with the response body **not** leaked; empty content
  → `EMPTY`.

### Integration (LIVE Supabase DEV) — `npx vitest run tests/integration` → 41 passed / 0 failed / 0 skipped

New group `Phase 4 — ai_revisions RLS + idempotency` (5 cases):

1. anon cannot insert / update / read `ai_revisions`.
2. a reviewer (technical **and** compliance) cannot insert a row (RLS `app.can_author`).
3. a DEVELOPER inserts their own PROPOSAL (`decision = 'PENDING'`); an identical
   `(manual_version_id, input_hash)` while still PENDING is rejected with `23505`; the developer
   records a decision; a re-issue after the decision is allowed again.
4. a reviewer can READ the org's audit rows (read-only).
5. an outsider (Org B) can neither read nor write Org A's rows.

Cleanup runs via service role and **asserts** the test rows are gone (`afterAll`). The 36
unchanged Phase 2/3 cases still pass alongside.

### Lint / typecheck / build

`npm run lint` ✅ (0 errors, 0 warnings) · `npm run typecheck` ✅ · `npm run build` ✅ (all
routes compile; `/manuals/[manualId]/edit` builds).

## 12. Browser verification (developer@smartin.demo, DEV, manual `VMax EA (DEMO)`)

| Check | Result |
|---|---|
| Inspector AI section **active**, no longer a Phase-4 placeholder | ✅ |
| Provider badge "Mock AI — mode pengembangan, hasil simulasi" always visible | ✅ |
| Focus a text block → "Sasaran: Blok teks", operation buttons enabled; empty/again on blur handled (sticky target, re-checked on Accept) | ✅ |
| `improveText` / `simplifyText` / `technicalRewrite` → SEBELUM/SESUDAH, provider + facts chips, "Grounding lolos" | ✅ |
| **Tolak** → proposal discarded, block text unchanged | ✅ |
| **Terima** → block updates, autosave "Tersimpan", survives full page reload | ✅ |
| **Undo** restores the pre-AI text; **Redo** restores the accepted proposal; no false autosave conflict | ✅ (verified after a clean dev-server compile; production build unaffected) |
| **Accept save state** — panel shows `Belum disimpan → Menyimpan… → Tersimpan` (real Phase 3 autosave), never a stuck `Menyimpan…`; no-op accept shows `teks sudah sesuai — tidak ada perubahan` | ✅ (real-change path at 768 & 1024 & 375; no-op path at 375) |
| `generateCaption` insufficient metadata / empty text block → "Informasi tambahan diperlukan" with the source-surface hint, no invented content | ✅ (unit + browser: AIR card rendered at 375, no overflow) |
| `generateSteps` → structured `steps` proposal (2 steps), grounding lolos, Terima present | ✅ (production build, 1280) |
| "Pindai klaim manual" on a crafted risky paragraph → **5 advisory findings** (`CLAIM-PROFIT-GUARANTEE`, `CLAIM-CONSISTENCY`, `CLAIM-RISK-FREE`, `CLAIM-PROFIT-SHARING`, `CLAIM-MLM`), each with category id, excerpt, chapter location, explanation, recommended action; **block text unchanged**; framing "Tinjau bersama manusia — tidak ada perubahan otomatis", not "Manual failed compliance" | ✅ (at 375, no card overflow) |
| "Pindai klaim manual" on the clean manual → "Tidak ada frasa klaim berisiko yang terdeteksi (pemindaian awal — bukan persetujuan)" | ✅ |
| Grounding attack (§36): the Mock provider cannot be coerced into emitting `EURUSD H1 / 90% / $500` (lexical only); the deterministic guard blocking a fabricated / lower- or mixed-case symbol / timeframe / combination is covered by 13 `validateGrounding` unit tests; `detectClaims` flags "win rate 90%" | ✅ (unit — the enforced control; the lexical mock can't produce the hallucination to demo in-browser) |
| **Responsive 1440** — 3-column desktop; `documentElement.scrollWidth === clientWidth` (1440), no page/body horizontal scroll; `.ai-panel` / `.ai-proposal` / `.ai-diff` no overflow-x; badge + facts chips + grounding + Terima/Tolak all present | ✅ (JS geometry + screenshot) |
| **Responsive 1024** — drawer mode; scrollWidth === clientWidth; **drawer `scrollHeight (942) > clientHeight (820)` → vertically scrollable**; drawer / proposal / diff no overflow-x; full flow: run → SEBELUM/SESUDAH → Reject (unchanged) → run → Accept → `Tersimpan` → reload persists | ✅ |
| **Responsive 768** — drawer mode; no page/body h-scroll; drawer / proposal / diff no overflow-x; full flow run → proposal → Reject (unchanged) → run → Accept → `Tersimpan` → reload persists | ✅ |
| **Responsive 375** — drawer mode; `scrollWidth === clientWidth === 375`, no page/body h-scroll; drawer 329 px + vertically scrollable; proposal / diff / diff-text / fact-chip / grounding / AIR card / 5 finding cards **none overflow-x** (`overflow-wrap: anywhere`); Terima 95×40 px + Tolak present; badge wraps; full flow run → proposal → Reject (unchanged) → run → Accept → `Tersimpan` → reload persists; AIR card + claim-finding cards rendered and fit | ✅ |
| **Browser console (production build, fresh tab)** — editor + AI panel load, focus block, run `generateSteps`, render steps, Reject: **`No console logs`** (zero errors, zero warnings) at 1280 and 375. Dev-server runs additionally showed only: `/_next/hmr` WebSocket failures (dev-only), a stale Turbopack "useImperativeHandle changed size" warning from incremental hot-edits (a fixed 4-element deps literal in source; absent in the production build), and `prompt() is not supported` from the Phase 3 TipTap link button in this sandbox. | ✅ |

DEV data hygiene: every block and `ai_revisions` row created during browser testing was removed;
`manual_blocks` for the demo manual and `ai_revisions` are both back to 0 (asserted via
`supabase db query`).

## 13. Configured real-provider live-test status

**NOT TESTED.** `.env.local` contains no `AI_PROVIDER` / `AI_API_KEY`. The configured provider
is fully covered by `tests/unit/ai-anthropic-transport.test.ts` and the `ConfiguredAIProvider`
tests in `ai-domain.test.ts` using a deterministic fake transport (outbound request shape,
structured parse, timeout/unavailable mapping, malformed rejection, AIR passthrough, no secret
persistence). No evidence of a real API round-trip is fabricated.

## 14. AC-P4 acceptance matrix

| AC | Verdict | Evidence |
|---|---|---|
| **AC-P4-1** GI-1..GI-12 hold (incl. GI-5 responsive at 375/768/1024/1440) | **PASS** | No schema replacement; GI-10 paired setups + GI-11 linked-EA params enforced in `fact-bundle.ts` and unit-tested; lint/typecheck/build green; 41/41 live integration incl. all unchanged Phase 2/3 RLS/RPC cases; **GI-5 rendered-browser evidence at 375 / 768 / 1024 / 1440** — `scrollWidth === clientWidth`, no doc horizontal scroll, no clipped proposal / AIR / finding cards, before/after + fact chips + grounding UI wrap, drawer scrolls vertically, Accept/Reject/claim-scan reachable, provider badge visible, **zero console errors on the production build** (§12). |
| **AC-P4-2** `AIProvider` 6 methods, mock + configured | **PASS** | `lib/ai/types.ts`; `ai-domain.test.ts` exercises all six on `MockAIProvider` and (fake transport) `ConfiguredAIProvider`. |
| **AC-P4-3** no env → mock, unmistakable | **PASS** | `resolveProviderMode` unit tests; browser badge "Mock AI — mode pengembangan, hasil simulasi" always visible; `page.tsx` passes `currentProviderMode()`. |
| **AC-P4-4** payload = only the 4 keys | **PASS** | `assertGroundedRequestShape` + `.strict()` schema; `ai-domain.test.ts` asserts exact keys, rejects an extra key, and that the serialised payload contains no signed URL / key. |
| **AC-P4-5** insufficient facts → AIR, UI prompts | **PASS** | mock AIR paths unit-tested (thin source for improve/simplify/technical, no lines for `generateSteps`, no ALT/caption for `generateCaption`); browser at 375 — an empty text block + improveText renders the "Informasi tambahan diperlukan" card with the missing fact + hint + source surface (`Blok teks`), no prose generated, no overflow. |
| **AC-P4-6** before/after; nothing written until Accept; Reject discards | **PASS** | `ai-panel.tsx` + `applyProposal`; browser: Tolak leaves text unchanged, Terima applies + persists across reload. |
| **AC-P4-7** no accepted proposal introduces a new symbol/timeframe/number (**case-insensitive**); fabricated claim caught by `detectClaims` | **PASS** | 13 `validateGrounding` unit tests: new number / symbol / timeframe / unlisted combination blocked; **`eurusd` / `EURUSD` / `EurUsd` / `eurusd H1` / lowercase `h1` all rejected**; broker-suffix exactness (`XAUUSD.m/M15` ≠ `XAUUSD/M15` / `XAUUSD.m/H1` / `EURUSD.m/M15`); supported pair with only-casing difference passes; unsupported combination of two individually-known values rejected; fabricated lowercase symbol + number rejected; clean rewrite + exact stored pair allowed. `detectClaims` flags win-rate phrasing. The symbol model is a curated forex/index token set (two ISO currency codes, or a known ticker) so ordinary prose never matches. |
| **AC-P4-8** `detectClaims` covers every §4 category; advisory; never auto-edits | **PASS** | `ai-claim-scanner.test.ts` — 10/10 §4 categories from Bahasa Indonesia (+English where the rule set carries it) fixtures, 5 clean controls raise nothing, runtime drift guard, input not mutated; browser scan of a crafted risky paragraph produced **5 correct findings** (`CLAIM-PROFIT-GUARANTEE`, `-CONSISTENCY`, `-RISK-FREE`, `-PROFIT-SHARING`, `-MLM`) with **no content change** and non-alarmist framing ("Tinjau bersama manusia — tidak ada perubahan otomatis"). |
| **AC-P4-9** every proposal + outcome recorded; no raw credential | **PASS** | `ai_revisions` migration applied to DEV; `requestAiRevision` / `resolveAiRevision` write actor / operation / input hash / fact ids / output / provider metadata / decision + timestamp; `provider_metadata` is `{requestId, durationMs}` only; live RLS/columns verified. |
| **AC-P4-10** idempotent — no duplicate PENDING, no double write | **PASS** | partial unique index + dedup select + race re-read; `hashAiRequest` key-order stability unit test; integration test asserts the duplicate PENDING insert fails with `23505` and a re-issue after decision succeeds. |
| **AC-P4-11** inspector AI section active; no other phase's affordances enabled | **PASS** | `.ai-placeholder` replaced by `<AiPanel>`; "Kirim review" still disabled ("Phase 6"), PDF/preview unchanged, no checklist/score/review UI added. |

## 15. Known limitations / not-perfect

1. **Configured provider — no live smoke test** (no credentials in `.env.local`). Covered by
   deterministic fake-transport tests only; reported **NOT TESTED**, not fabricated. Credentials
   were not added to the repo to force this.
2. **Grounding guard is deliberately conservative about combinations** — a configured LLM
   rewrite that re-pairs two individually-valid values, or invents an instrument, is blocked
   (Accept disabled, retry offered). The symbol model is now a curated forex/index token set, so
   ordinary prose is not flagged; but a very unusual real broker suffix outside the
   `[._][A-Za-z0-9]{1,10}` shape, or an index ticker not in the known list, would not be
   recognised as a "known symbol" for the combination check (it would still be caught as a "new
   symbol"). This errs toward *never letting an unsupported fact through* — the intended safety
   direction. The Mock provider (lexical only) never trips the guard.
3. **375/768 interactive flows were driven with dispatched focus events + JS clicks**, because
   the in-app browser pane intermittently timed out on `computer` taps at narrow widths.
   Geometry was measured with real `getBoundingClientRect` / `scrollWidth` in the rendered page,
   the production build was loaded in a fresh tab for the clean-console check, and every
   proposal / AIR / claim-scan state was rendered and asserted. This is a harness limitation,
   not an app issue.
4. **Dev-server Turbopack HMR cache** got noisy after many incremental hot-edits to
   `SectionEditor` (a `forwardRef` + `useImperativeHandle`): a spurious "useImperativeHandle
   changed size" warning and stale parse errors. The source has a fixed 4-element deps literal;
   a fresh `next build` / `next start` shows **zero console output**. A reviewer testing locally
   should restart `next dev` after pulling.

## 16. Phase 5+ boundary (unchanged, not touched)

Checklist engine, compliance/readiness score engine, `checklist_results`, automated readiness
gates, technical/compliance review workflows, reviewer comments, approval, publishing, the
public manual route, PDF export, version cloning, and published snapshots remain **out of
scope**. `detectClaims` is advisory input to a human review that Phase 6 will own — it never
marks a manual compliant, approves it, blocks publishing, or modifies content.
