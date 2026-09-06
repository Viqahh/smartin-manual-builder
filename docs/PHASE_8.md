# Phase 8 — Quality & real-user hardening

> **Status (2026-09-04):**
> - **Phase 8A (Real User UAT Correction Pass) — CLOSED.** Slices 8A-P0 / 8A-P1+P2 / 8A-FINAL /
>   UAT-35 (migrations 29–31), all findings tracked in [`docs/UAT_FINDINGS.md`](./UAT_FINDINGS.md).
> - **Phase 8A.5 (Supabase environment isolation + Production persistence/navigation hardening) —
>   CLOSED.** See "Phase 8A.5" below. Migration 32. Isolation contract in
>   [`docs/ENVIRONMENTS.md`](./ENVIRONMENTS.md).
> - **Phase 8B (Final Quality & Release Closeout) — IN PROGRESS.** Closes the original `AC-P8-1`
>   through `AC-P8-10` (never formally walked until now — see the closure matrix once complete).
>   Phase 8 as a whole is **NOT YET marked complete** — that happens only once every 8B release
>   gate is green (final slice of this document).
> - **Production**, live commit at last update: `5bd8582` (`style(manual): add consistent block
>   spacing across rendered surfaces`), Supabase project `wotidyhpbltoxmzvdqkj`, migration 32,
>   drift 0. **DEV/Preview**, Supabase project `tmrwhkhydkjaubpuegqa`, migration 32, drift 0.
>
> Baseline for this whole Phase 8 document remains `c5764f2` (Phase 7 complete, migration 28).

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

---

# Slice 8A-P1 + 8A-P2 — complete correction pass

Executed as one pass (no intermediate UAT, by request). No migration (28 == 28), no schema, no
compliance/review/RBAC weakening, published snapshots + READY PDF artifacts untouched. All P0
behaviour (UAT-01/04/05/21/22/33, no React #418) preserved and re-tested.

## Inline parameter management (UAT-10/11/13/14, §2)

Parameter definitions stay OWNED BY THE EA VERSION (GI-11). `DEVELOPER` already holds
`ea_parameter:manage`, so this surfaces an existing capability in-context — no RBAC change.

- `features/parameters/actions.ts` gains one **read** action `getParameterGroups({eaVersionId})`
  (client-callable, `ea_version:read`), so the builder can re-read after a mutation without a
  route refetch.
- `features/parameters/inline-parameter-manager.tsx` — a human-labelled panel over the existing
  `create/update/deleteParameter[Group]` actions: **Nama yang tampil di MT5** / **Nama parameter
  di kode/input EA** / **Tipe data** (bool·int·double·string with one-line help) / **Nilai
  default** / **Kapan boleh diubah** (label over the internal `before_start`/`may_change_live`/
  `needs_reattach` enum) / safe range / order effect. Create when no group exists first creates a
  default "Parameter" group.
- `ParameterTableBlockEditor` (in `block-editors.tsx`): empty EA Version → `Belum ada parameter
  untuk EA Version ini.` + `+ Tambah parameter` (no page hop). Populated → the group checkboxes
  **plus a compact preview table** (Nama / Technical / Type / Default) for the referenced groups
  **plus** `+ Tambah / Kelola parameter` inline.
- `ManualBuilder` threads `parameterGroupsFull` + `eaVersionId` + `onParametersChanged` through
  `BlockEditorCtx`; `onParametersChanged` re-reads groups and bumps the validation nonce. The
  block preview and Phase-5 checklist refresh; no `router.refresh`.
- **Source-of-truth proof:** every write goes through `ea_parameters` / `parameter_groups` via
  the existing actions; nothing is written to `manual_blocks` except the group-id references it
  already held; `tests/unit/schema-parity.test.ts` + `block-ops` still assert the block payload
  carries only `groupIds`.

## Installation step image (UAT-07, §3)

Each step now has `StepImagePicker`: `Upload gambar` (reuses `ctx.onUploadImage` → the existing
private `manual-images` bucket) **or** `Pilih dari library`, preview, ALT, caption, remove. The
step payload is unchanged (`imageAssetId?`), so existing step-image payloads render as before.

## Multi-item FAQ (UAT-20, §4)

- `lib/domain/blocks.ts`: FAQ payload **v2** `{ type:"faq", schemaVersion:2, items:[{question,
  answer}] }`. `normalizeBlockPayload(input)` upgrades a v1 `{question,answer}` payload to v2 on
  the way into `parseBlockPayload`, so every NEW write is v2 and a v1 payload already stored (a
  draft manual, or an **immutable published snapshot**) still parses. `faqItems(payload)` reads
  both shapes and is the single reader used by the renderer, `output-parity`, `parity-html`,
  `search-index`, `manual-projection`, `fact-bundle`, `validation/rules`, and the editor.
- `FaqBlockEditor`: one block, add/edit/delete/reorder items; only the currently-edited item is
  expanded, others collapse to a question row.
- Renderer: `.manual-faq` → one `.manual-faq-item` per Q/A. Print/PDF renders every item expanded.
- `output-parity` `faq` manifest kind changed to `{ items:[{question,answer}] }` (symmetric in
  `parity-html`), so **AC-P7-4 parity holds with a multi-item FAQ** (proven by
  `tests/unit/faq-multi.test.tsx`).
- **No migration** — the JSONB payload is versioned in application code.

## Placeholder system (UAT-19, §5)

`RichTextEditor` gets a `placeholder` prop (a positioned overlay, no new TipTap dependency); real
`placeholder` attributes on the FAQ question, step title/instruction/menu path, image ALT/caption,
and parameter name fields. Placeholders are never the field value → never persisted, never
validation evidence, never in Preview/Public/PDF. Untouched drafts are still discarded (UAT-04).

## Chapter guidance 00–17 (UAT-18, §6)

`lib/domain/chapter-guidance.ts` — one metadata source (purpose · what belongs · what NOT to
assume · suggested blocks · example · `factOwner`) for every canonical chapter, distilled from
`docs/CONTENT_REQUIREMENTS.md`. It drives `ChapterGuidancePanel` (a prominent empty-state panel + a
compact `<details>` above an existing block list) **and** the Template + Panduan pages. UI-only.

## Chapter completion + lock (UAT-27/28/17, §7/§8)

Completion is a labelled `<select>` (`Belum lengkap / Sedang dikerjakan / Selesai / Ada masalah`)
next to the chapter heading; a blocked `Selesai` shows the exact reason inline; the sidebar rows
carry a coloured completion border. The canonical lock icon has `title` + descriptive `aria-label`.

## Validation panel redesign + rule audits (UAT-06/26/29, UAT-12A/B/C/D, §9/§10/§11)

- **Progressive disclosure** in `ValidationPanel`: score + counts on top, an explicit
  "documentation readiness, not chapters completed" line, then a **`Perlu diperbaiki`** tab (the
  default) that shows only actionable items grouped into `Bisa kamu perbaiki` /
  `Butuh data teknis / source-of-truth` / `Butuh Admin / perusahaan` / `Butuh Compliance`
  accordions, with passing checks collapsed to `✓ N pemeriksaan lainnya lolos`. **`Semua
  pemeriksaan`** is the secondary tab (category accordions). `Tandai tidak berlaku` is a small
  secondary link; the override flow + audit are unchanged.
- **Owner map** `lib/validation/types.ts::checklistOwner` — presentation only; it never changes a
  rule state, applicability, or the publish gate.
- **CHK-VERSI-DUA (12A):** verifies two DISTINCT labelled version fields + the "berlaku untuk
  versi X.Y.Z" statement. **Identical semver is now PASS.**
- **CHK-INSTALL-AUTOTRADING (12B):** the legacy "smiley hijau/merah" wording is no longer
  required — any concrete verification signal (status icon, "initialized" log line, active-state
  label, panel indicator) satisfies the "user can verify status" half.
- **12C/12D:** strategy/source-of-truth and organisation/compliance facts are **not** weakened —
  they keep their MISSING/WARNING state when absent; only their presentation moves to the correct
  owner group. Compliance semantics and the publish gate are unchanged (integration suite green).
- **Review submission (§11):** blocked `Kirim review` shows `Belum siap dikirim · N hal perlu
  dilengkapi` with an expandable list; missing reviewers name the exact role and say "ditetapkan
  oleh Admin (tab Metadata)". State machine + gates unchanged.

## Resource pages (UAT-30/31/32, §12/§13/§14) + internal-phase wording (§21)

- `components/section-page.tsx` deleted (the only source of "Phase berikutnya").
- **Template Manual** — a live READ-ONLY reference generated from `allChapterGuidance()` (18
  chapters, required flag, purpose, what belongs, what not to assume, suggested blocks). No fake
  buttons, no "akan dihubungkan". Full Admin template lifecycle is documented as deferred.
- **Panduan Dokumentasi** — a searchable accordion; chapter-scoped topics reuse the chapter
  guidance metadata (so instructions never conflict) + curated cross-cutting topics (screenshots,
  claim language, versioning) with Lakukan / Hindari / contoh aman / bab terkait.
- **Referensi Kepatuhan** (renamed from "Checklist Kepatuhan") — built from `CHECKLIST_V1` +
  `checklistOwner` + `notApplicableReason` + `bappebtiOnly`: requirement, expected evidence,
  responsible party, PBK scope, N/A eligibility, publish impact. Always states "Checklist membantu
  kesiapan dokumentasi dan bukan persetujuan regulator." **No per-manual status.**
- `components/resource-accordion.tsx` — a small client search + `<details>` list (no-JS-safe).
- The nav labels are now "Template Manual" / "Panduan Dokumentasi" / "Referensi Kepatuhan".
- `tests/unit/no-internal-phase-wording.test.ts` scans `app/ features/ components/`
  string/JSX literals (comments stripped) for `Phase N` / `akan dihubungkan` / etc. → none.

## Typography / spacing (UAT-23/24, §17) + canvas consistency (§15)

Base rich-text rhythm on `.manual-content` (paragraph / list / list-indent / heading / bold /
italic / link) in the ONE shared renderer, plus `.manual-faq` and `.manual-changelog` spacing —
so Preview = Public = Print = PDF and formatting never forks. DOM + visible text are unchanged →
AC-P7-4 parity holds. Canvas audit: changelog (P0) and the parameter preview now render inside the
document canvas; FAQ / steps / images are block editors already in the canvas; the AI + validation
panels stay in the inspector (they are tools, not document content).

## Performance (UAT-25, §18)

`<Link prefetch>` on Edit→Preview and Preview→Edit warms the RSC payload; the last-edited chapter
is restored from `sessionStorage` per manual on return; the inline editors never call
`router.refresh`. Before/after navigation timings are in the report.

## Tests added

`chapter-guidance` (guidance metadata), `faq-multi` (v1↔v2, multi-item render + parity + mutation
detection), `checklist-owner` (owner routing), `no-internal-phase-wording` (scan), extended
`validation-rules` (CHK-VERSI-DUA UAT-12A, CHK-INSTALL-AUTOTRADING), extended `block-ops` +
`serialization-spike` (FAQ v2), `section-editor-undo` ctx updated. Unit **542 pass**, integration
**134 pass**, build clean, 28 migrations.

---

# Slice 8A — FINAL UAT correction pass (validation UX + rule fix + empty blocks)

Continues the same uncommitted tree. No migration (28). Production still on e48e467.

## §1 Validation inspector — compact by default
`features/validation/validation-panel.tsx`: owner groups are now button-driven disclosures, not
always-open `<details>`. Only the highest-priority non-empty owner group is open until the user
touches a disclosure. Each finding is a one-line `v-finding-row` (state icon + label + state +
caret); the reason, evidence summary, owner CTA, "Buka bab", and "Tandai tidak berlaku" appear
only when the row is expanded. `[Lihat semua]` / `[Tutup semua]` drive every owner + finding at
once. PASS and NOT_APPLICABLE are each collapsed behind their own toggle (`N pemeriksaan lainnya
lolos`, `N tidak berlaku`). CSS: `.v-owner-row`, `.v-finding*`, `.v-todo-head`, `.v-textbtn`.

## §2 CHK-VERSI-DUA — no body prose required
`lib/validation/rules.ts::checkVersiDua` now returns PASS whenever the EA Version field and the
Manual Version field both exist and are valid semver — VALUES MAY BE IDENTICAL. The former
`/berlaku untuk versi X.Y.Z/` Cover-body requirement is removed from this rule (it lives on as
chapter guidance, not a gate). WARNING only for non-semver; MISSING only for an absent value.

## §3 Remaining findings — messages, not fake passes
`checkKontak`: the "no support channel" branch now reads "Data dukungan pada EA Version belum
tersedia atau belum lengkap … Perlu dikonfirmasi Admin/perusahaan — bukan diisi oleh penulis
manual." Algo-Trading, Cara Kerja EA, Perilaku kondisi khusus, and Ekspektasi margin onboarding
rules are UNCHANGED (already platform-generic / source-of-truth / PBK-scoped) — only their CTA
framing in the panel changed.

## §4 CTA copy by resolution owner
`OWNER_CTA` in the panel: author → "Bisa kamu perbaiki langsung di bab terkait."; source-of-truth
→ "Perlu data teknis EA yang dikonfirmasi developer / source-of-truth."; organisation → "Data
organisasi belum tersedia / perlu dikonfirmasi Admin."; compliance → "Perlu verifikasi / data
kepatuhan oleh tim Compliance." No new permissions; navigation stays "Buka bab …".

## §5 UAT-34 — legacy persisted empty blocks
`lib/domain/blocks.ts::isBlockContentEmpty(payload)` — conservative raw-payload predicate: TRUE
for blank Text/Callout, zero-item or all-blank FAQ, empty or all-blank Steps; FALSE for image /
parameterTable / anything unrecognised / rich text that throws. `section-editor.tsx` filters these
out of the initial block list for an editable DRAFT (`canEdit`) and fires `softDeleteBlock` once
per id via a ref-guard, then calls `onBlockSaved` so readiness re-evaluates. The existing
`emitCommitted` effect propagates the cleaned set to the builder, so A→B→A and reload stay clean.
No empty "Tersimpan" card is ever painted. Read-only manuals are untouched.

## UAT-35 — human evidence fallback: NOT implemented (needs approval)
"Sudah ada di manual" requires a stateful author-submission + reviewer-decision record that
existing tables cannot safely carry (`review_comments` is reviewer-authored, round- and
status-gated, immutable; `checklist_results` is one server-owned row per check and its `evidence`
is overwritten on every re-evaluation; `audit_events` is an append-only log, not a workflow
store). A new migration is required → see "# UAT-35 PERSISTENCE PROPOSAL" in the final report.
No UI was added (no dead controls without persistence).

## Tests added
`empty-block-cleanup` (isBlockContentEmpty + SectionEditor auto-cleanup, read-only untouched, no
re-fire on reload), `validation-panel-compact` (owner groups collapsed, compact finding row,
expand-on-demand, PASS/NA collapsed, Lihat/Tutup semua, owner CTA routing). Extended
`validation-rules` (CHK-VERSI-DUA: identical semver PASS, no body sentence, non-semver WARNING).
Unit **559 pass**, integration **134 pass**, build clean, 28 migrations.

---

# Slice 8A — UAT-35 human-evidence workflow (Migration 29, APPROVED with revisions)

## Migration 29 — `20260901002800_phase8_checklist_evidence.sql` (count 28 → 29)
New objects only; no existing migration edited.
- `checklist_items.human_evidence_eligible boolean` — DB copy of the STRICT allowlist, set true
  for `CHK-INSTALL-AUTOTRADING`, `CHK-PACKAGE-FILES` only (mirrors `HUMAN_EVIDENCE_ELIGIBLE` in
  `lib/validation/types.ts`; `human-evidence-eligibility.test.ts` asserts parity).
- `checklist_evidence_submissions` — id, org, manual_version_id, checklist_template_id/version,
  checklist_item_id, check_key snapshot, submitted_by/at, section_id, block_id, note,
  automated_state_at_submit, evidence_content_hash, status
  (`PENDING/ACCEPTED/RETURNED/SUPERSEDED/STALE`), decided_by/at, decision_review_type,
  return_reason. Composite `(manual_version_id, organization_id)` FK; anchors `on delete set null`;
  partial unique index `(manual_version_id, check_key) where status in ('PENDING','ACCEPTED')`.
- Triggers: `app.assert_evidence_anchor` (anchor belongs to the same manual_version + org),
  `app.guard_evidence_update` (identity/author/hash/note frozen; PENDING→…, ACCEPTED→SUPERSEDED/
  STALE only, RETURNED/SUPERSEDED/STALE terminal — no PENDING recycling),
  `app.stale_evidence_for_block` / `app.stale_evidence_for_section` (SECURITY DEFINER; on any
  payload edit / soft-delete / insert / hard-delete of a block in the anchored chapter, or a
  chapter delete, a live submission flips to STALE).
- RLS: SELECT for org members; NO client write. Two SECURITY DEFINER RPCs:
  - `submit_checklist_evidence(mv, check_key, section_id, block_id, note, evidence_hash)` —
    `app.can_author`, status DRAFT/CHANGES_REQUESTED, check `human_evidence_eligible`,
    current `checklist_results.state = 'WARNING'` (MISSING rejected), valid anchor, no live row.
  - `decide_checklist_evidence(submission_id, 'ACCEPT'|'RETURN', return_reason)` — the review type
    is **derived server-side** from `manual_versions.status` + the assigned reviewer id; there is
    no client review-type parameter. RETURN needs a reason.
  - Each writes an `audit_events` row (`checklist_evidence:submitted|accepted|returned`).
- `public.publish_warning_blockers(mv) returns text[]` — extracted so the publish gate stays DRY
  and is directly testable. Excludes a `publish_blocking` WARNING check ONLY when it is
  `human_evidence_eligible` AND has a current `ACCEPTED` submission on the same template. MISSING
  is handled by the separate array and is never excused.
- `public.publish_manual_version` re-defined (supersedes 2600) — single delta: query B now calls
  `public.publish_warning_blockers`. Everything else byte-identical.

## App
- `lib/validation/evidence.ts::evidenceFingerprint(section, blockId)` — deterministic sha256 of
  the anchored content (block text, or whole-chapter text), computed **server-side** in the
  server action and again at evaluation time (secondary staleness signal; DB triggers are primary).
- `lib/validation/types.ts` — `HUMAN_EVIDENCE_ELIGIBLE`, `HumanEvidence`, `EvidenceStatus`;
  `ItemResult.humanEvidenceEligible` + `humanEvidence`.
- `lib/validation/evaluate.ts::computeScore` — a WARNING with
  `humanEvidence.effectiveResolution === 'RESOLVED_BY_HUMAN_REVIEW'` counts toward the numerator;
  `state` unchanged; a MISSING never counts.
- `features/validation/actions.ts` — `attachHumanEvidence` overlays the live submission per item,
  recomputes the fingerprint (marks stale on drift or template change), derives
  `effectiveResolution`, and re-derives the score. New actions `submitChecklistEvidence`
  (author, computes the fingerprint server-side) and `decideChecklistEvidence` (reviewer).
- `features/validation/validation-panel.tsx` — eligible WARNING + author → `[Sudah ada di manual]`
  → chapter/block/note form. Existing submission → a two-line panel (`Hasil otomatis: …` /
  `Bukti manusia: …`), `[Lihat bukti]`, and for the assigned reviewer `[Terima bukti]` /
  `[Kembalikan]` (+ reason). STALE → "Konten berubah setelah bukti diajukan/diterima." An
  ACCEPTED, non-stale, eligible WARNING moves into a collapsed "N diselesaikan lewat tinjauan
  manusia" group. Ineligible / source-of-truth / MISSING findings never show the button.
- `features/manuals/manual-builder.tsx` — passes a slim `evidenceSections` (chapters + blocks)
  to the inspector for the picker.

## Tests
Unit: `evidence-fingerprint` (5), `human-evidence-eligibility` (4, incl. migration-parity),
`validation-score` (+2 — WARNING resolved counts, MISSING never). Integration (`rls.test.ts`):
14 — eligible WARNING submit ok + automated state unchanged; ineligible rejected; MISSING
rejected; cross-manual block rejected; reviewer/outsider can't submit; non-editable status
rejected; only the assigned reviewer of the current stage decides + type server-derived; RETURN
needs a reason; returned row historical + resubmission inserts a new row; content edit / block
soft-delete → STALE; audit rows; org-B RLS isolation; publish gate excuses eligible+ACCEPTED
only, never ineligible / MISSING / STALE; reviewer N/A override independent.
Totals: unit **570 pass**, integration **148 pass**, typecheck/lint/build clean, migrations **29**.

## UAT follow-up — inspector correctness (no rule / eligibility change)
- `features/validation/validation-panel.tsx` — removed the "Bukti terdeteksi: …" line that dumped
  the raw `checklist_results.evidence` blob (internal `_reason` / `_systemState` /
  `_navigateSectionKey` keys and rule keys like `has247`, `sectionId`) into the UI. The finding's
  `reason` text is the only human-facing evidence. Regression test in `validation-panel-compact`
  asserts no `_`/raw evidence key ever reaches the DOM.
- `app/(workspace)/manuals/[manualId]/edit/page.tsx` — `<ManualBuilder key={vm.manual.id}>` so the
  builder (and its `useState(prop)` seeds — sections, validation view, block counts) remounts
  cleanly when the route switches to a different manual. Before this, a soft navigation between
  two `/manuals/[id]/edit` pages kept the previous manual's `ValidationPanel` state.
- Verified on Preview: opening a throwaway UAT-35 fixture manual as a pure-DEVELOPER user shows its
  own state (`CHK-INSTALL-AUTOTRADING` WARNING under "Bisa kamu perbaiki", `[Sudah ada di manual]`
  present), including after a soft nav from another manual; no raw metadata anywhere; console clean.

## UAT follow-up 2 — validation panel bound to manual/version identity (generic, shared)
Root cause: `ValidationPanel` seeds display state via `useState(prop)` (read once at mount). On a
client navigation between two `/manuals/[id]/edit` routes, if the `ManualBuilder` React instance is
reused (router/back-forward restore, or a refactor without an identity key), the panel keeps the
previous manual's `ValidationView`; the `refreshNonce` effect (0→0) never re-fetches. The earlier
`key={vm.manual.id}` only helps when the parent actually reconciles a changed key — it does not
cover an instance-reuse restore, and did not touch the raw-`evidence` render leak.

Shared fix (every manual, no fixture-specific code):
- `features/validation/validation-panel.tsx` — new required `manualVersionId` prop;
  `identity = "${manualId}::${manualVersionId}"`; a render-phase guard ("adjust state on prop
  change") hard-resets EVERY local state (view ← current `initial`, busy/err, all
  expand/collapse sets, tab, override form, UAT-35 evidence/return forms) the instant identity
  changes — independent of remounting. An `identityRef` + capture-compare in `load()`/`doRefresh()`
  discards an in-flight server-action result whose manual switched mid-flight.
- `features/manuals/manual-builder.tsx` — `.builder-page` carries `data-manual-id` /
  `data-manual-version-id`; the panel `<section>` carries `data-panel-manual-id` /
  `data-panel-version-id`. Resolved identity is now inspectable in any browser and asserted in
  tests. `manualVersionId` threaded page → Inspector → panel.
- `key={vm.manual.id}` on `<ManualBuilder>` kept as defense-in-depth.
- Raw-metadata leak: `evidenceBits` removed entirely — the panel never renders
  `checklist_results.evidence` keys (`_reason`, `_systemState`, `_navigateSectionKey`, `has247`,
  `sectionId`, `channelKinds`, …).

Regression tests: `validation-panel-compact.test.tsx` — a dedicated "bound to manual/version
identity (no cross-manual leakage)" block with two distinct manual ids / version ids and different
validation results: A→B and B→A reset of counts + grouped findings + human-evidence + score;
expand/collapse state does not carry across a switch; same manualId + new manualVersionId also
resets; no raw evidence metadata in either manual with every finding expanded; the
`data-panel-*` attributes track the current identity.

Verified on Preview across VMax EA UAT (96% / 1 action) → DEMO fixture (17% / 20 actions,
`CHK-INSTALL-AUTOTRADING` WARNING + `Sudah ada di manual`) → "viqah" (18% / 18 actions) → back to
VMax (96% / 1 restored); hard-refresh of each == soft-nav; builder id == panel id == route id at
every step; no raw metadata; console clean. Unit **576 pass**, integration **148 pass**,
migrations **29**.

## UAT follow-up 3 — validation payload carries its own manual_version identity + ?diag read-out
End-to-end server trace (documented): `page.tsx` reads the `[manualId]` route param →
`assembleManualViewModel(source, manualId)` → `SupabaseManualDataSource.loadManualVersionByManualId`
which filters `.eq("manual_id", manualId).order("created_at" desc).limit(1)` (never by EA/product) →
`getValidation({ manualId })` → `loadExistingResults(vm.manualVersion.id)` filters
`.eq("manual_version_id", …)`. No `unstable_cache` / `revalidate` / module memo anywhere in the
auth, view-model, data-source, or validation path; `getWorkspaceContext` uses React `cache()`
(per-request only). The server path resolves the correct manual for every request.

Generic hardening (every manual, no fixture-specific code):
- `ValidationView` now carries `manualVersionId` — the manual_version it was computed for.
  `evaluateManual` stamps it from `vm`; `shapeFromRows` takes it explicitly; `attachHumanEvidence`
  preserves it.
- `ValidationPanel` — **PAYLOAD GUARD**: once the identity guard has settled
  (`identity === boundIdentity`), if the `view` about to render has a `manualVersionId` that does
  not match the panel's `manualVersionId` prop, `view` is dropped and a `healFor` state flag (not
  a bare ref, so it survives render-phase churn) drives a one-shot `getValidation` re-fetch for the
  correct version. Loop-proof (one heal per identity), reset on genuine navigation. `<section>`
  gains `data-view-version-id` = the rendered view's version.
- During UAT a temporary `?diag` read-out strip (`BuilderDiagnostic`) surfaced route/loaded/payload
  ids in the browser; it was **removed before finalisation**. The permanent observables that
  remain are the `data-panel-manual-id` / `data-panel-version-id` / `data-view-version-id`
  attributes on the validation `<section>` (referenced by the regression tests; no visual output).

Regression tests: `validation-panel-compact.test.tsx` — added "PAYLOAD GUARD: a `view` computed
for the WRONG version is never rendered — it is dropped and re-fetched" (panel bound to version X,
handed a payload stamped Y → X's findings never appear, `getValidation` is called, the corrected
payload then renders, `data-view-version-id` = X). All identity-block tests updated to keep
`manualVersionId` consistent between the payload and the prop.

Verified on Preview: opening a manual's own route → the panel's `data-view-version-id` and the
`data-panel-version-id` both equal that manual's current `manual_version.id`; soft-navigating
between manuals with very different validation states swaps counts/findings correctly and restores
the original on return; hard-refresh parity holds. Console clean.

## UAT follow-up 4 — UAT-35 eligibility is now systematic (owner ∧ WARNING-capable), not a 2-check list
The `Sudah ada di manual` action is no longer a hardcoded `{CHK-INSTALL-AUTOTRADING, CHK-PACKAGE-FILES}`
allowlist. It is DERIVED:

    humanEvidenceEligible(check)  ⇔  checklistOwner(check) === "author"  AND  the rule is WARNING-capable

- `lib/validation/types.ts` — `WARNING_CAPABLE` set (audited against every rule function in
  rules.ts; `human-evidence-eligibility.test.ts` re-derives each rule's real output and fails on
  drift). `isHumanEvidenceEligible(check)` = `checklistOwner(check) === "author" && WARNING_CAPABLE.has(check)`.
  `HUMAN_EVIDENCE_ELIGIBLE` is now the *computed* set, not a literal.
- Migration **30** (`20260901002900_phase8_human_evidence_eligible_sync.sql`) — sets
  `checklist_items.human_evidence_eligible = (check_key in ('CHK-VERSI-DUA','CHK-INSTALL-AUTOTRADING','CHK-PACKAGE-FILES'))`
  (true for the 3, false for every other row — self-correcting; migration 29 had flagged only 2).

Resolved eligible set for template v1: **CHK-VERSI-DUA, CHK-INSTALL-AUTOTRADING, CHK-PACKAGE-FILES**
(the author-owned rules that can emit WARNING). All 28 other checks are permanently ineligible —
7 author-owned rules that are only ever PASS/MISSING, and 21 rules owned by
organisation / compliance / source-of-truth. Full matrix in the response.

Strict boundaries unchanged: MISSING is never submittable (RPC rejects `!= 'WARNING'`);
organisation / compliance / source-of-truth checks are rejected by the RPC's
`checklist_items.human_evidence_eligible` gate even when they *are* WARNING; `systemState` is never
mutated; acceptance still requires a reviewer and goes STALE on content change.

Tests: `human-evidence-eligibility.test.ts` rewritten — the systematic invariant for all 31 checks,
the resolved set == author ∧ WARNING-capable, migration-30 parity, "never eligible: any non-author
owner even when WARNING-capable" (CHK-KONTAK / CHK-DEV-LEGAL / CHK-CARA-KERJA / CHK-PARAM-DEFAULT-MATCH
/ CHK-UNITS-DEFINED / CHK-PERFORMANCE-KONDISI / CHK-NO-PROHIBITED-CLAIMS / CHK-TRANSPARANSI),
"never eligible: author-owned binary rules", and a soundness check that no rule emits an un-audited
WARNING across representative manuals. Integration (`rls.test.ts` UAT-35 group): added
"a second ELIGIBLE author-owned WARNING (CHK-VERSI-DUA) accepts a submission" and
"WARNING-capable but NON-author checks are ALL rejected" (6 keys across the 3 non-author owners).

Verified on Preview: DEMO fixture — `CHK-INSTALL-AUTOTRADING` genuinely WARNING → `Sudah ada di
manual` present. "viqah" (a normal user manual) — `CHK-VERSI-DUA` genuinely WARNING under
`Bisa kamu perbaiki` → eligible. VMax EA UAT — no eligible check evaluates to WARNING → no button
(correct; nothing manufactured). Panel provably stable (0 DOM mutations / 3 s, no console errors).
Unit **580 pass**, integration **149 pass**, typecheck/lint/build clean, migrations **30**.

## UAT follow-up 5 — UAT-35 eligibility re-audited to an EXPLICIT per-rule set (not ownership inference)
`humanEvidenceEligible = owner('author') ∧ WARNING-capable` was too broad. Re-classified individually
against 5 criteria: (a) author controls the manual PROSE; (b) the WARNING may be a genuine
prose-detection false negative; (c) a reviewer can verify by reading the referenced chapter/block;
(d) acceptance overrides no structured / system / source-of-truth fact; (e) acceptance repairs no
malformed / invalid data.

- `lib/validation/types.ts` — `HUMAN_EVIDENCE_ELIGIBLE` is now an **explicit literal set**
  `{ CHK-INSTALL-AUTOTRADING, CHK-PACKAGE-FILES }` with the exact false-negative scenario documented
  per eligible rule and the disqualification documented per audited-out rule. `isHumanEvidenceEligible`
  reads the set directly — no `checklistOwner` inference. `WARNING_CAPABLE` stays only for the
  "no rule emits an un-audited WARNING" soundness test.
- **CHK-VERSI-DUA is now INELIGIBLE.** Its WARNING = "EA/Manual version string is not valid SemVer" —
  a data-quality defect in a metadata field. No chapter a reviewer reads makes `"1.0"` valid; the fix
  is to correct the version field. Fails (b), (c), (e).
- Migration **31** (`20260901003000_phase8_human_evidence_eligible_reaudit.sql`) sets
  `checklist_items.human_evidence_eligible = (check_key in ('CHK-INSTALL-AUTOTRADING','CHK-PACKAGE-FILES'))`
  — supersedes migration 30. Self-correcting.
- `features/validation/validation-panel.tsx` — each `.v-finding <li>` now carries
  `data-check-key` / `data-state` / `data-he-eligible` (generic diagnostic, like `data-panel-*`).

Eligible (2) — false-negative each covers:
  • CHK-INSTALL-AUTOTRADING — the manual DOES describe how to confirm automated trading is active
    (e.g. "robot muncul di tab Experts", "ikon wajah tersenyum", "baris 'EA loaded' di Journal")
    in wording outside the detector's keyword set.
  • CHK-PACKAGE-FILES — the manual DOES enumerate the shipped files + where they go, using folder
    names as words ("folder Experts") rather than path tokens (`Experts\`, `.ex5`).
Ineligible: CHK-VERSI-DUA (invalid-SemVer data); 7 author-owned rules that are only ever PASS/MISSING
(MISSING is a truly absent fact); 21 rules owned by organisation / compliance / source-of-truth.

Tests: `human-evidence-eligibility.test.ts` rewritten (explicit set; CHK-VERSI-DUA ineligible with
reason; migration-31 parity; non-author owners never eligible even when WARNING-capable; author
binary rules never eligible; evaluateManual stamps eligible=false on the CHK-VERSI-DUA WARNING and
true on the Algo-Trading WARNING). `validation-panel-compact.test.tsx` — new block: a
prose-detection WARNING (Algo-Trading, eligible) SHOWS `Sudah ada di manual`; an invalid-SemVer
WARNING (CHK-VERSI-DUA, ineligible) does NOT; MISSING never shows it; PASS never shows it.
Integration `rls.test.ts` UAT-35 group: "INELIGIBLE WARNING checks are ALL rejected" now includes
CHK-VERSI-DUA alongside the source-of-truth / organisation / compliance keys.

Verified on Preview (via `data-he-eligible`, no interaction needed):
  • DEMO fixture — `CHK-INSTALL-AUTOTRADING` WARNING, `data-he-eligible="true"` → button.
  • "viqah" (real user manual) — `CHK-VERSI-DUA` WARNING, `data-he-eligible="false"`,
    `.v-ev-open` count = 0 → NO button.
  • VMax EA UAT — no WARNING → no button. Console clean.
Unit **585 pass**, integration **148 pass**, typecheck/lint/build clean, migrations **31**.

---

# Phase 8A — CLOSED

All findings above (8A-P0 correctness blockers, 8A-P1+P2 authoring/validator/presentation pass,
8A-FINAL validation UX correction, UAT-35 human-evidence workflow + its two eligibility
re-audits) are resolved and verified. Final state: unit **585 pass**, integration **148 pass**,
migrations **1–31**, typecheck/lint/build clean. No open 8A finding remains (`docs/UAT_FINDINGS.md`
has no row without a `FIXED`/`IMPLEMENTED`/`IMPROVED` status).

---

# Phase 8A.5 — Supabase environment isolation + Production persistence/navigation hardening — CLOSED

Not a UAT slice — triggered by discovering that Vercel Preview *and* Production shared one
Supabase project (`tmrwhkhydkjaubpuegqa`), then by a real Production data-integrity defect found
during the resulting cutover UAT. Full guard/mapping detail lives in
[`docs/ENVIRONMENTS.md`](./ENVIRONMENTS.md); this section is the narrative record.

## Environment isolation

DEV/Preview and Production now use separate Supabase projects (`tmrwhkhydkjaubpuegqa` /
`wotidyhpbltoxmzvdqkj`). `lib/env.ts` → `assertSupabaseProjectMatchesEnv()` is a **hard** runtime
guard at the server/service Supabase client boundary: `production` may only use the PROD ref,
`development`/`preview` may only use the DEV ref, an unrecognised ref or a mismatch throws and
stops client creation. `/api/health` surfaces the same check non-fatally (`env` + "APP_ENV/project
match"). A parallel guard (`tests/integration/_guard.ts`) keeps the integration suite DEV-only,
and `scripts/fixtures/_guard.mjs` keeps ad-hoc fixture/UAT scripts DEV-only + explicit-opt-in.
First Production identity was bootstrapped via `supabase/prod-bootstrap.sql` (a template, no real
values committed) — one real organisation, one ADMIN membership, no demo/UAT data.

## Migration 32 — `client_token` idempotency (`20260901003100_phase8a5_block_client_token.sql`)

**Root cause found live on Production** (a hand-authored manual, not a fixture): the Manual
Builder's autosave queue could coalesce a second save for a still-new block immediately after
`createBlock` succeeded, before the returned id was reconciled into the React-deferred
`blocksRef` — so the coalesced save re-ran the CREATE path and produced a **second**
`manual_blocks` row that the client then abandoned (an orphan live row, reappearing on reload as
apparent duplication). A second, related defect: chapter navigation had no save barrier, so a
fast chapter switch could drop a pending debounced edit (`dispose()` on unmount cleared timers
without flushing) — the same class of bug as UAT-01, recurring at a lower layer.

**Database-level fix (forward migration, not a rewrite of 1–31):** `manual_blocks.client_token
uuid` — a stable, content-independent identity generated once when a draft block is created,
resent on every create retry, never derived from text. Partial unique index
`(manual_section_id, client_token) WHERE client_token IS NOT NULL AND deleted_at IS NULL` — at
most one **live** row per logical client-created block; a duplicate create attempt with the same
token reconciles to the existing row (pre-check, plus a `23505`-recovery path for the concurrent
case) instead of inserting another. Legacy rows keep `client_token = NULL`, unconstrained, never
backfilled.

**Application-level fix:**
- `features/manuals/editor/section-editor.tsx` — the create→update decision is resolved from
  `keyToId` (a synchronous ref updated the instant a create succeeds), never from React render
  timing.
- `lib/editor/autosave-queue.ts` — `flushAll()`: a single awaitable, ~15s-bounded save barrier
  that drains every pending/in-flight/coalesced write and reports which entities did not reach a
  clean persisted state; `dispose()` is reduced to best-effort only — correctness comes from an
  explicit `await flushPending()` before every chapter/section switch and before Preview
  navigation, never from unmount cleanup. A failed flush blocks navigation and shows an explicit
  message instead of silently proceeding or losing the edit.
- `features/manuals/preview-nav.ts` — `openPreviewTransition()`: a synchronous re-entrancy guard
  (a repeated click before React re-renders is a no-op) → the save barrier → fire-and-forget route
  revalidation → navigate exactly once. The Preview control is a `<button>` (never a prefetched
  `<Link>`); `/preview` stays `force-dynamic`, so navigation always renders current data with no
  hard refresh. The button shows "Membuka preview…" and stays disabled for the whole transition.
- `features/blocks/actions.ts` — `createBlock`/`updateBlock`/`softDeleteBlock` also
  `revalidatePath` the manual's `/edit` + `/preview` routes on every successful write.

**UAT-25 correction** (does not delete the original finding — see `docs/UAT_FINDINGS.md`): the
8A-P2 fix for UAT-25 used `<Link prefetch>` to mask Edit↔Preview latency, which reintroduced a
staleness risk the barrier above now removes properly.

**Verification:** unit **644 pass** (autosave-queue-barrier ×8, preview-nav ×7,
section-editor-persistence ×5, block-spacing ×9, chapter-nav-delete ×7, env-guards ×24, plus the
existing suite), integration **152 pass** on DEV (incl. 4 `client_token` DB-constraint
assertions), typecheck/lint/build clean. Migration 32 applied to DEV first, full regression green,
Preview UAT passed, only then applied to Production (drift 0 on both). Post-fix Production DB
inspection: exactly one live row per non-null `client_token`, 0 new NULL-token duplicates, 0
exact-payload duplicate groups. The one pre-existing duplicate (created before the fix, on the
Production smoke-test manual) is a soft-deleted, non-live row — left untouched per instruction.

## Block spacing (style, not a defect fix)

Two adjacent chapter blocks (e.g. Text→Text) could render with no visible gap. Fixed with one
layout-level token (`--block-stack-gap` on `.generic-chapter`, an owl rule + `:first-child` reset)
instead of per-block-type margins — consistent across Editor read-view, Preview, Public Manual,
and PDF; in-block paragraph spacing untouched and stays visibly smaller. No content mutation.
Shipped as its own commit (`5bd8582`) after the persistence fix (`32c63dd`) landed and was smoke-
verified. Tests: `tests/unit/block-spacing.test.tsx` (9).

## DEV-only cleanup

Two pre-existing orphan scratch functions (`public._c_guard()`, `public._do_del(int)`) —
unreferenced by any migration, trigger, RPC, test, or application code; their bodies referenced
tables (`_log`, `_c`) that don't exist in the schema — were dropped from DEV only (Phase 8B-2). No
Production migration; Production never had them.

---

# Phase 8B — Final Quality & Release Closeout — IN PROGRESS

Closes the original `AC-P8-1..10` (never formally walked before now), tracked as a closure matrix
in the final slice of this document. No new product feature; no Phase 9.

## 8B-1 — Documentation synchronisation (this update)
`docs/PHASE_8.md` (this file), `docs/UAT_FINDINGS.md` (UAT-25 correction, no history deleted),
`docs/ENVIRONMENTS.md` (status refresh), `docs/IMPLEMENTATION_PLAN.md` (Phase 8 row: 8A/8A.5
closed, 8B in progress — **not** yet marked complete).

## 8B-2 — DEV-only cleanup
Done — see "DEV-only cleanup" above.

## 8B-3 — CI integration gate
`.github/workflows/ci.yml` gained an `integration` job (`needs: verify`, i.e. runs only after
lint/typecheck/unit/build are green) using repo secrets `SUPABASE_TEST_URL` /
`SUPABASE_TEST_ANON_KEY` / `SUPABASE_TEST_SECRET_KEY` + `APP_ENV=development`. The existing
`tests/integration/_guard.ts` fail-closed project-ref check (DEV ref only, Production ref
hard-aborts) is unchanged and remains the sole target-safety enforcement — nothing below weakens
or replaces it.

Hardened secret-presence handling (so a missing secret can never look like a green pass): a PR
from a fork is detected (`github.event.pull_request.head.repo.full_name != github.repository`)
and explicitly **skipped** with a logged reason — GitHub never exposes repository secrets to fork
PRs, so this is expected, not a failure. On the authoritative repository (a push to `main`, or a
PR from a branch of this same repo) a step asserts all three secrets are non-empty *before* the
suite runs; if any is missing, the job **fails** with `::error::` naming which secret(s) are
missing (never the values) instead of letting the suite's own `describe.skipIf` self-skip report
a false green. **Operational once the three secrets are added in the repository settings**
(secret *values* are never committed).

## 8B-4 — Chapter delete safety
Deleting a custom chapter had neither confirmation nor undo (unlike block delete, which stashes
the removed block and offers a restore control). Fixed with the smallest safe UX:
`features/manuals/editor/chapter-nav.tsx` — the first "Hapus bab" click now only opens an inline
confirmation naming the chapter title ("Hapus bab "…"? Tidak dapat dibatalkan."); Cancel is the
default-focused action (Enter is always safe); Escape cancels; only an explicit click (or Enter
with that button itself focused) on "Ya, hapus bab …" calls the real delete. No change to reorder,
rename, add, or block-level behaviour. Tests: `tests/unit/chapter-nav-delete.test.tsx` (7).

## 8B-5 — Live accessibility + responsive audit — CLOSED

Real-browser audit (375 / 768 / 1024 / 1440 px) against a local dev server on Supabase DEV,
across Login, Dashboard, Manual Book list, Produk EA, Manual Builder, Preview, Review Teknis, and
the public manual page. Three P1 defects fixed:

- **Duplicate manual rows** — `features/manuals/queries.ts` `listManuals()` returned one row per
  `manual_version`, so a manual with >1 version produced duplicate `manualId`s (React duplicate-key
  warning on Dashboard "Manual terbaru" and `/manuals`, and a wrong displayed count). Fixed with a
  pure, unit-tested `dedupeLatestManualVersion` (`lib/manual/list-dedupe.ts`): one row per manual,
  representative version chosen by **parsed semver number** (`major`, then `minor`, then `patch`) —
  never by `updated_at` (an older version can be touched later) and never by incidental DB row
  order (ties are non-deterministic). List *order* still follows `updated_at DESC`.
- **Mobile nav drawer had no focus trap** — `components/app-shell/app-shell.tsx`: the drawer is a
  modal overlay but Tab could escape to the page behind the scrim. Added `role="dialog"` +
  `aria-modal="true"`, focus-in on open, Tab/Shift+Tab wrap, Escape-to-close, and focus restore to
  the trigger on close.
- **Manual Builder top bar unusable at 375 px** — `app/globals.css` mobile breakpoint: the
  breadcrumb was crushed to ~12 px. Root cause was a nested `.review-controls` flex item with no
  `min-width: 0` of its own; `min-width: 0` on the parent alone was not enough. Fixed with
  `min-width: 0` + an explicit `max-width` on the nested item so the summary text wraps.

Tests: `tests/unit/manual-list-dedupe.test.ts` (8), `tests/unit/app-shell-drawer.test.tsx` (5).
P2 backlog (non-blocking): public-manual footer ~1-char clip at 375 px; Preview occasionally
loads pre-scrolled; `prefers-reduced-motion` not independently re-verified live.
Committed `54eb591`; CI `verify` + real DEV `integration` green; Production `/api/health` green.

## 8B-6 — Empty / loading / error / retry audit — CLOSED

Audited every user-facing async surface (login, list loading, empty states, create product /
version / manual, autosave, chapter nav, Preview transition, image upload, parameter + changelog
mutations, validation refresh, human-evidence, review actions, reviewer comments, publish,
archive, clone, PDF). Most surfaces already handle busy/error/retry from prior phases. Two P1
defects fixed, plus one concurrency race found during live verification.

- **P1 — chapter add / rename / reorder / delete swallowed server failure.**
  `features/manuals/manual-builder.tsx` fired the section-mutation server actions and ignored the
  result (`.then(res => { if (res.ok) … })` with no `else`). reorder / rename / delete apply an
  **optimistic** change to `sections` *before* the request resolves, so a failure (permission,
  network, stale row) left the chapter list silently diverged from the server with no feedback —
  and `ChapterNav` had no error surface at all. Fix: each handler snapshots state before its
  optimistic write, and on failure reverts (sections + selected chapter for delete) and sets a
  visible Indonesian `role="alert"` message rendered in `ChapterNav` (`error` prop). No workflow,
  RLS, or schema change — client optimistic-UI + error surfacing only.

- **P1 — PDF transient download failure was indistinguishable from "no artifact".**
  `components/public-manual/pdf-download-button.tsx`: a failed `fetch` of a **READY** artifact
  (network blip) collapsed into the same terminal state as a missing artifact — a disabled
  "PDF belum tersedia" button, recoverable only by a full page reload (undiscoverable), on the
  public manual page's primary CTA. Fix: a local fetch failure now renders its own
  "Gagal mengunduh — coba lagi" retry that re-attempts the plain download, independent of the
  admin `retryAction`; never the "artifact missing" message.

- **Concurrency race (found during verification) — resolved.** The revert restores a snapshot
  taken *before that handler's own optimistic write*; with two mutations overlapping, a failing
  older request could restore a snapshot predating a later successful mutation and wipe it
  (`A optimistic → B optimistic → A fails → A restores pre-A state`). Resolved by **serializing —
  one chapter structural mutation in flight at a time**: `chapterMutInFlightRef` is a synchronous
  re-entrancy guard (a second call, incl. a rapid double-click or a drag mid-request, is ignored
  and never issues a duplicate request); `chapterMutPending` disables every mutation control in
  `ChapterNav` (drag handle, move ▲/▼, rename, delete, delete-confirm, add-toggle, both form
  submits) and early-returns from `moveTo` and the form `onSubmit`s. `.catch` + `.finally` added
  to all four handlers so a hard reject reverts and always releases the guard.

**Live DEV failure-injection evidence** (browser-tab `fetch` wrapper rejecting `next-action`
requests; server behaviour never weakened; Production untouched; one custom chapter added then
deleted, post-test reload confirmed the manual back to its original 18 chapters):

- add / rename / reorder / delete each restored the last confirmed server state on failure, showed
  the Indonesian `role="alert"` error, kept a valid selected chapter, produced no false success,
  succeeded on retry after "connectivity" was restored, and matched the server exactly after a
  reload;
- in a delayed-success run, all mutation controls read `disabled` while a reorder was in flight;
  **5 rapid extra clicks during the in-flight window produced a net move of exactly 1**; 6 rapid
  clicks on delete-confirm issued **exactly 1** server-action request;
- PDF: on `/manual/p7-pdf-normal/1.0.0` (real READY artifact) a transient failure showed
  "Gagal mengunduh — coba lagi" (not "PDF belum tersedia", not disabled); after recovery the retry
  fetched the real artifact and triggered the download with **no page reload**.

Tests: `tests/unit/chapter-nav-concurrency.test.tsx` (8), `tests/unit/chapter-nav-error.test.tsx`
(2), `tests/unit/pdf-download-button.test.tsx` (4). Unit baseline after this slice: **671 passed**
(54 files). No DB schema / RLS / permission / workflow-state-machine / publishing-invariant change.

P2 backlog (carried, non-blocking): `parameter-manager.tsx` + `review-comments-panel.tsx` call
`router.refresh()` per fine-grained mutation (full-route refetch, no state corruption — a polish
item; `parameter-manager` is already flagged in-code as a Phase 3 placeholder); plus the three
8B-5 P2 items above.

## 8B-7 — Security / RBAC / RLS closure — CLOSED

Verification / hardening slice — **no code change made, none required**. Audited the current
implementation against the live DEV database + application. **No P0 or P1 security/integrity
defect found.**

Surfaces covered and confirmed: org isolation across every data family; anonymous access (zero
`anon` table/function grants anywhere — anon reaches only the unauthenticated public route);
DEVELOPER / TECHNICAL_REVIEWER / COMPLIANCE_REVIEWER / ADMIN capability matrix; multi-role users
(union of capabilities, no admin gain); reviewer-assignment boundaries (wrong-role / cross-org /
inactive rejected; non-admin cannot assign); self-approval prevention (a reviewer who is a
`manual_version_contributors` row for the version cannot approve — technical + compliance);
cross-org UUID/reference injection (composite FKs reject foreign-org product/version/group refs on
insert and update); direct-table mutation that should require RPC (no client write policy on
`reviews`, `review_comments`, `checklist_results`, `published_snapshots`,
`manual_version_contributors`, `changelog_entries`, `ai_revisions`,
`checklist_evidence_submissions`); DRAFT vs non-DRAFT edit protection (server-side trigger, not
just a disabled editor); review-round integrity (optimistic `status = ? and review_round = ?`
guards; concurrent decisions converge); public vs private manual access (public route outside
`app/(workspace)`, reads published snapshot only, DRAFT/never-published → 404); published-snapshot
immutability (byte-identical after mutation attempts; a live EA-fact change does not alter the
snapshot or its hash); archive (ADMIN-only, snapshot intact, second archive rejected); private
storage + signed URLs (both buckets `public:false`; `manual-pdf-artifacts` has no anon/authenticated
policy at all; `manual-images` org-scoped read / `can_author` write; `signImageUrl` 30-min TTL,
org-scoped); PDF-artifact isolation (lifecycle, DB generation lock, READY immutability, cross-org
+ anon isolation); human-evidence author/reviewer boundaries + eligible-vs-ineligible checks
(author-only submit; assigned-reviewer-of-current-stage-only decide; ineligible / MISSING / STALE
never excused; cross-org read blocked); audit-event immutability (`app.reject_audit_mutation()`
rejects UPDATE/DELETE for every application identity **including `service_role`** — only raw
`postgres` / `supabase_admin`); service-role boundaries (8 call sites, all server-only trusted;
no `"use client"` importer; `lib/supabase/service.ts` is `import "server-only"`); environment
guards (`assertSupabaseProjectMatchesEnv` fail-closed at the server + service client boundary);
destructive-fixture guards (`scripts/fixtures/_guard.mjs` + `tests/integration/_guard.ts` — DEV
ref **and** `APP_ENV != production` **and** explicit `ALLOW_DESTRUCTIVE_FIXTURES=yes-dev` opt-in);
accidental Production targeting (same guards abort on PROD ref or `APP_ENV=production`); secret
exposure (no `.env*` tracked but `.env.example` names-only; no hard-coded key literals in source;
server-only secrets referenced only in server modules; client bundle scan shows no server-secret
names or values — the one `AI_API_KEY` hit is a UI error-string literal; browser Supabase client
uses the publishable key; AI transport errors are typed/generic and never include the key; CI job
log masks every secret as `***`).

**`SECURITY DEFINER` — precise evidence statement:**
- All **70** `SECURITY DEFINER` functions were **statically verified in migration source** to
  declare `SET search_path = public`.
- Their runtime authorization / state-machine behaviour is exercised by the DEV integration suite
  (152 tests) run against the real DEV database.
- Live `pg_proc.prosecdef` / `pg_proc.proconfig` catalog inspection was **not available** — no
  direct database password / `psql` access was present in this environment.
- This is an **evidence limitation, not a discovered defect**. `SET search_path = public` is the
  Supabase-documented pattern and is pinned per-call via `proconfig`, so a caller cannot override
  it.

Authoritative evidence: **CI DEV integration 152/152** (run `34008397336`, commit `b02e3d1` —
real job executed, not skipped; no secret values in logs); **local DEV integration 152/152**
(DEV ref `tmrwhkhydkjaubpuegqa`, `APP_ENV=development`, 99.0s, exit 0). Unit `671 passed`; `tsc`,
lint, build clean; Production `/api/health` → `ok:true, ready:true, env:"production"`.

**P2 hardening backlog (non-blocking — no security change made to remove any of these in this
release):**
1. SD functions use `SET search_path = public` rather than the stricter `SET search_path = ''`
   with fully-qualified identifiers (or `pg_catalog, pg_temp`). Current form is safe and matches
   Supabase docs; optional future hardening.
2. `authenticated` holds broad table-level INSERT/UPDATE/DELETE on the authoring tables with RLS
   as the sole enforcement boundary (by design). Keep the negative-case integration suite as a
   required merge gate so a policy regression cannot ship silently.
3. Unauthenticated code paths (`lib/publication/get-public-manual.ts`,
   `lib/publication/public-image-bytes.ts`, the PDF modules) use the service-role client. Safe
   today because every query is publication-state-scoped; add an in-module convention that any
   new query there must filter by publication state.
4. DX: `.env.local` has no dedicated `SUPABASE_TEST_*` vars, so a local integration run must map
   the DEV `NEXT_PUBLIC_*` / `SUPABASE_SECRET_KEY` values into those names (the `_guard` still
   verifies the DEV ref). Documentation note only.

_Slices 8B-8 through 8B-12 (performance evidence, dependency/dead-code review, full DEV/Preview
E2E lifecycle, the `AC-P8-1..10` evidence matrix, and final release/handover) are not yet
started._
