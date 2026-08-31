# Phase 8 — Quality & real-user hardening

> **Status: PHASE 8A (Real User UAT Correction Pass) — IN PROGRESS. Baseline
> `c5764f2` (Phase 7 complete). No migration (28). Not committed / not pushed / Production untouched.**

Phase 8A is a **real-user UAT correction pass**, not a feature phase. A developer built a
complete VMax EA UAT manual by hand; automated tests were green but real authoring exposed
usability, state-management, output, and validator problems. The objective is:

**make manual authoring simple, direct, predictable, and low-friction** — bring the required
actions *to* the developer instead of making them hunt across pages, learn enum terminology,
scroll through validators, write for the regex engine, or guess whether data saved.

The findings and their resolution status live in [`docs/UAT_FINDINGS.md`](./UAT_FINDINGS.md).

Phase 8A is executed as reviewed slices (same discipline as Phases 1–7). **8A-P0 (this slice)**
fixes the five correctness blockers; P1 (authoring friction + validator usability) and P2
(presentation / performance / responsive) follow in later slices, each with its own Preview and
review.

---

## Slice 8A-P0 — correctness blockers

Non-negotiable invariants preserved (Phase 1–7): EA Version is the source of truth for
parameters/setup facts; no manual-owned parameter copies; the review workflow
`DRAFT → TECHNICAL_REVIEW → COMPLIANCE_REVIEW → APPROVED → PUBLISHED → ARCHIVED` is unchanged;
published snapshots + READY PDF artifacts stay immutable; `GET /pdf` never launches Chromium for a
READY artifact; the public route exposes no draft/private data; RBAC unchanged; no secrets in
code/logs/payloads; the checklist means *documentation readiness*, not regulatory approval; no
auto-N/A, no weakened compliance checks.

### UAT-01 — chapter content disappears until refresh

**Root cause.** `<SectionEditor key={section.id}>` (`features/manuals/manual-builder.tsx`) fully
remounts per chapter. On mount it derives its editable block list from the `section` prop, which
comes from the builder's `sections` state. That state is only mutated for chapter-level ops
(completion, reorder, rename, add, delete) — **never for block content**. Block edits are
autosaved to the DB but the builder's `sections[x].blocks` still holds the *original* payloads, so
navigating A → B → A remounts A from stale props. A full page refresh reloads the VM from the DB
and the content reappears.

**Fix.** Lift committed block state. `SectionEditor` gains an optional
`onSectionBlocksCommitted(sectionId, blocks)` callback, fired after each successful save, after
each persisted structural op, and on unmount. The builder folds the committed blocks back into its
`sections` state (deduped by canonical payload compare), so a later remount rebuilds A from
current data. The mounted editor is unaffected (it reads `section.blocks` only for its initial
`useState`). No refresh, no new server round-trips.

### UAT-04 — blank draft blocks persist

**Root cause.** `SectionEditor.addBlock` immediately `saver.queue(...)`s every non-image block
with its *draft* payload. `text`/`callout` drafts (`emptyRichText()`) pass `parseBlockPayload`, so
`createBlock` writes an empty row at once; `faq`/`steps` drafts were seeded with placeholder
strings (`"Pertanyaan baru"`, `"Langkah 1"`, `"Tuliskan instruksi."`) that also parse and persist.
The documented contract (`lib/domain/blocks.ts::draftBlockPayload`) says the opposite: *"the editor
keeps them as local draft state and only persists once `parseBlockPayload` succeeds"*.

**Fix.**
- `addBlock` no longer seeds placeholder strings and no longer eagerly persists. Only
  `parameterTable` persists on add (it carries a *meaningful reference* — a real EA-Version group
  id — the moment it exists, per spec §3). `image` stays deferred until an asset is chosen.
- New `lib/domain/blocks.ts::isPersistableDraft(payload)` — parse must succeed **and**, for
  `text`/`callout`, the rich text must contain non-whitespace. `changePayload` persists a
  never-saved block only once it is persistable; before that it updates local state only (typing
  is visible, nothing is written).
- An untouched in-memory draft is simply dropped on chapter switch / unmount — no server call, so
  no ghost row and no duplicate-on-refresh.

### UAT-22 — structured changelog missing from Preview / Public / PDF (renders an internal placeholder)

**Root cause.** The shared `ManualRenderer` renders `section.blocks` and injects the
supported-configuration table for `requirements`/`presets`. It **never renders `vm.changelog`**.
The changelog chapter is authored through the structured `ChangelogEditor`, so it has *zero
blocks* → `SectionContent` falls through to the empty-chapter placeholder, whose text was the
internal string *"Bab ini telah disiapkan dari template Smartin. Konten akan disusun pada editor
(Phase 3)."*

**Fix.**
- `ManualRenderer` renders `vm.changelog` for `section.key === "changelog"` (ordered list: type
  label + body +, for `BREAKING`, the open-position impact). One shared renderer → Preview,
  Public, and PDF all get it identically. Published snapshots already carry `content.changelog`
  (`lib/publication/snapshot.ts`) and the adapter already maps it (`snapshot-view-model.ts`).
- The empty-chapter placeholder text is now the neutral `EMPTY_CHAPTER_PLACEHOLDER`
  (`lib/manual/view-model.ts`): *"Bagian ini belum memiliki konten."* — no internal wording. A
  repo-wide scan confirms no `Phase N` / `template Smartin` / `akan disusun pada editor` string
  remains on any Preview/Public/Print/PDF path.
- `lib/publication/output-parity.ts` and `tests/support/parity-html.ts` gain a symmetric
  `changelog` manifest kind so **AC-P7-4 web/PDF content parity still holds** with a changelog
  present (proven by a new dedicated parity test + the existing comprehensive fixture, whose empty
  changelog chapter still exercises the neutral placeholder).

### UAT-21 — changelog editor stuck after Save

**First diagnosis (insufficient).** `useTransition` + `router.refresh()` inside the transition
kept `isPending` true. Swapped to a plain `busy` boolean. **Preview hands-on review showed this
did NOT fix it.**

**Confirmed root cause (deployed inspection).** `ChangelogEditor` called `router.refresh()` after
every mutation. That refetches the ENTIRE `export const dynamic = "force-dynamic"`
`/manuals/[manualId]/edit` route — `assembleManualViewModel` + `getValidation` (full Phase-5
evaluation) + ~7 more Supabase queries in one `Promise.all` — and re-reconciles the result into
the live client tree. That reconciliation **regenerated a hydration-divergent subtree**: the
`ValidationPanel` renders `new Date(view.evaluatedAt).toLocaleString("id-ID", …)`, which formats
in the server's timezone during SSR and the browser's on hydration → **React error #418 ×3** on
the edit page. On every `router.refresh()` that mismatched subtree was thrown away and rebuilt,
the scroll jumped, and the editor *looked* stuck — even though the save had already persisted and
the Preview already reflected it.

**Fix.**
- **`ChangelogEditor` no longer calls `router.refresh()`.** Each mutation is applied to local
  `rows` on success and the editor is its own source of truth for the session:
  - *create* → adopt the real `id` + server `position`, drop `_new` (a 2nd Save now *updates*, so
    **no duplicate row**);
  - *update* → local row already holds the edit; just clear `dirty`;
  - *delete* → remove the row locally;
  - *reorder* → re-sequence `rows` to the new order.
  A transient **"✓ Tersimpan"** appears per row; `busy` gates controls only for the action
  duration. Validation still re-evaluates through `props.onChanged` → `ValidationPanel`'s own
  targeted `refreshValidation` action (not a route refetch); the Preview route re-reads on
  navigation. A guarded post-commit `useEffect` (not render-phase `setState`) still adopts a
  genuinely changed `props.entries` (e.g. the manual leaves DRAFT) when the user has no unsaved
  work.
- **`ValidationPanel`** wraps the evaluated-at timestamp in `<time … suppressHydrationWarning>` —
  the sanctioned React fix for deliberately server/client-divergent text — so the pre-existing
  #418 is gone and `router.refresh()` from *other* controls (publish/review) is no longer
  destructive either.

### UAT-33 — structured changelog was a separate authoring surface outside the manual page (ACCEPTANCE BLOCKER)

**Problem (Preview hands-on).** `ChangelogEditor` was rendered by `manual-builder.tsx` as a
standalone bordered panel (`.cl-editor`, its own "Catatan perubahan terstruktur" heading, every
entry a permanently-open form) **between** `.editor-toolbar` and `<SectionEditor>` — i.e. *above*
the document canvas. BAB 14 felt like two different editors: a management form on top, the manual
canvas below.

**Fix (placement + editing UX only — data model untouched).**
- **`SectionEditor`** gains a `canvasPrefix?: ReactNode` slot rendered at the **top of
  `.editor-canvas`**, above any optional ordinary blocks. With a prefix present, the big "Tambah
  blok pertama" empty-state is replaced by a muted "Blok tambahan bersifat opsional" hint (blocks
  stay available via the toolbar).
- **`manual-builder.tsx`** no longer renders `<ChangelogEditor>` standalone. For a DRAFT changelog
  chapter it passes it as `canvasPrefix`; in read-only states the shared `<SectionContent>`
  already shows `vm.changelog` (UAT-22), so no prefix is needed.
- **`ChangelogEditor`** is now inline canvas content — a subtle `.cl-canvas-label` (not a panel
  heading), then per entry:
  - **saved → collapsed content card** (`.cl-doc-card`): `v{version} · {type}` + feature flag +
    a transient `✓ Tersimpan`, the body text, the BREAKING impact, and `[Edit] [Hapus]` + `↑ ↓`.
  - **Edit / Tambah entri → the same card expands inline** into the field form with
    `[Simpan] [Batal]`. `Batal` on a new draft discards it; on an existing entry it reverts to the
    last-saved values (`baseline` ref). `Simpan` collapses back to the card. No page jump.
- All four changelog **server actions and the changelog data are unchanged** — one authoritative
  source drives Edit → Preview → Public → PDF. The UAT-21 no-`router.refresh` self-reconcile is
  preserved (create adopts the real id + position → a 2nd Save updates, never duplicates).
- CSS: `app/globals.css` gains `.cl-canvas*`, `.cl-doc-*`, `.cl-saved`, `.editor-empty-optional`;
  the old `.cl-editor` panel styles are now unused by the builder.

### UAT-05 — Undo/Redo unreliable during real authoring

**Root cause.** The pure history stack (`lib/editor/history.ts`) is sound. But a *content* edit is
only pushed as an undo step **after** its autosave round-trips (`section-editor.tsx` inside
`saveImpl`), so undo does nothing until the 800 ms debounce + network settle, and a fast
edit-then-undo is lost. Structural undo was further undermined by UAT-01/UAT-04: a chapter switch
wiped the per-chapter history, and an eagerly-persisted blank add left a real row that undo then
had to chase.

**Fix (light touch — no persistent VCS).**
- `changePayload` schedules a **coalesced** history push ~400 ms after typing stops (deduped by
  `sameDoc`), so undo is available without waiting for the network; the post-save push remains as
  a harmless no-op.
- The UAT-01 (no state loss) and UAT-04 (no eager blank persist) fixes remove the two conditions
  that made structural undo feel broken.
- The Undo/Redo controls carry an accessible `title` making the **session-scoped** nature
  explicit (*"Riwayat berlaku selama sesi edit bab ini"*); a page refresh intentionally resets it.

---

## 8A-P0 tests

- `tests/unit/blocks-draft.test.ts` — `isPersistableDraft` truth table (empty text/callout not
  persistable; non-empty is; faq/steps/parameterTable gated by parse).
- `tests/unit/changelog-render.test.tsx` — `ManualRenderer` renders `vm.changelog` (bodies +
  BREAKING impact); **no** internal-placeholder string anywhere in the output; `diffOutputParity`
  of the vm manifest vs the parsed-HTML manifest is `[]` **with** a changelog present; a mutated
  entry body is detected at the right path.
- `tests/unit/section-editor-undo.test.tsx` — extended: adding a `text`/`faq` block does **not**
  write to the fake DB until real content is typed; an untouched draft is discarded on unmount;
  add → undo (local, no server delete) → redo; a coalesced content edit is undoable before its
  autosave would have fired.
- `tests/unit/manual-builder-state.test.tsx` — chapter A → B → A after a committed edit shows the
  latest content (no refresh); the mounted editor is not disrupted by the lift-up.
- `tests/unit/changelog-editor-save.test.tsx` — covers UAT-21 **and** UAT-33: `router.refresh` is
  **never** called for a changelog mutation; a saved entry renders **collapsed** (no editable
  fields) with an Edit action; Edit **expands inline**, Cancel collapses back with no write and
  reverts to the saved value; Edit → change → Simpan **collapses** to the compact card with the
  new value; Tambah entri opens an inline editor and a successful create **collapses to a saved
  card with the server id**; editing that entry again **updates the same row (no duplicate)**;
  delete removes the row locally and reorder still works; the component renders `.cl-canvas`
  (inline) and **not** the old `.cl-editor` / `.cl-head-row` panel.
- `tests/unit/section-editor-undo.test.tsx` — also adds a UAT-33 structural test: a `canvasPrefix`
  is rendered **inside `.editor-canvas`** (not a sibling panel), and the "optional blocks" hint
  replaces the big empty state.
- `tests/unit/output-parity.test.tsx` — unchanged expectations still pass (comprehensive fixture,
  neutral placeholder).

## 8A-P0 non-goals (later slices)

Placeholder→helper-text everywhere (UAT-19), inline parameter/step-image authoring (UAT-07/10/11/
13/14), multi-item FAQ (UAT-20), chapter guidance (UAT-18), completion discoverability
(UAT-27/28), validation-panel redesign (UAT-06/26/29), validator false-positives (UAT-12A/B/C/D),
header compaction (UAT-16), Preview↔Edit performance (UAT-25), renderer typography (UAT-23/24),
responsive/scroll (§20). None are weakened here; they are scheduled, not skipped.
