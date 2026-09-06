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

## 8B-8 — Performance evidence & optimization — CLOSED

Measurement-driven. Local dev server against DEV Supabase, with a temporary `globalThis.fetch`
tracer (`instrumentation.ts`, since deleted) counting every PostgREST / Storage round-trip. Test
data: the "Smoke test" manual (18 chapters / 18 blocks / 0 blocks referencing image assets; org
image library = 3 images) + the published `p7-pdf-normal` / `p7-pdf-large` fixtures. Dev-mode
wall-clock is inflated (Turbopack, ap-southeast-1 latency) — **round-trip counts and waterfall
shape are the evidence.**

**P0 / P1 fixed:**

- **Sequential per-image signed-URL generation on every Builder load.** `features/images/queries.ts`
  `listOrgImages` (`limit = 60`, runs on every builder load) and `features/manuals/data-source.ts`
  each signed URLs in an `await`-in-`for` loop — one Storage round-trip per image. Extracted
  `lib/images/sign-urls.ts` `signManualImageUrls()` (one batched `createSignedUrls(keys, 1800)`
  → `key → url|null` map, positional match, failed item isolated); both call sites use it. Same
  30-minute TTL, same private `manual-images` bucket, same authorization — only the round-trip
  count changes.
  - **Builder initial load, reconciled from the raw trace: 26 → 24 round-trips** (23 PostgREST
    unchanged; **3 sequential singular `createSignedUrl` → 1 batched `createSignedUrls`**; 0
    Storage object). On this manual **all 3 "before" signing calls belong to `listOrgImages`**;
    `data-source.ts` contributes 0 because the manual references no image assets. (An earlier draft
    claimed two batch calls collapsing via Next `fetch` dedup — **that was incorrect and is
    withdrawn**; there is only ever one signing call after the fix on this journey.) Savings are
    linear in image count — a 20-image manual saves ~1 s, a full 60-image picker several seconds.

- **Published-image route issued an unused query per image.** `loadVerifiedPublishedSnapshot`
  always ran the sibling-`publishedVersions` query, but the per-image callers
  (`getPublicImageDescriptor`, `openPublicImageSource`) never read it. Added
  `{ withPublishedVersions = true }`; image paths pass `false`.
  - **`/manual/<slug>/<v>/image/<idx>`: 5 → 4 round-trips per image request** (trace: the second
    `public_manual_versions` query removed). Zero behavior change — publication-state resolution
    and snapshot hash verification are unaffected (regression-tested).

No schema / index / RLS / RPC / permission / publishing-invariant change — client batching +
error-surfacing + dead-query removal only.

**Regression tests (21):** `tests/unit/sign-image-urls.test.ts` (7 — one `createSignedUrls` for N
keys, never per-key `createSignedUrl`; 1800 s TTL; bucket; positional map; failed item isolated;
whole-batch failure; empty input), `tests/unit/list-org-images-batch.test.ts` (3 — real
`listOrgImages` query path), `tests/unit/data-source-image-signing.test.ts` (3 — real
`SupabaseManualDataSource` call site with 3 referenced assets: one batched call, asset-id→URL
map, isolated failure, no-reference → no call), `tests/unit/publication-loader-versions-opt.test.ts`
(8 — default keeps the versions list; `false` skips exactly that one query; publication-state +
hash verification unchanged either way; `getPublicManual` vs `getPublicImageDescriptor` wire the
option correctly).

**Gates:** `tsc` clean, lint clean, unit **692 / 692** (58 files, +21), build ok, DEV integration
**152 / 152** on this exact source. `git diff --check` clean.

**P2 performance backlog (non-blocking — not implemented):**
1. Public reading page resolves the slug → snapshot chain twice (`getPublicManual` +
   `pdfArtifactUiStatus`); thread the resolved `publishedSnapshotId` through. ~60–100 ms.
2. Cold published-image route re-fetches the FULL `render_json` + recomputes a full SHA-256 per
   image; `Cache-Control: immutable` limits it to first-paint-per-viewer. A real fix needs a
   stored image-descriptor projection (schema change → out of scope).
3. `getValidation` re-invokes `assembleManualViewModel`; free today via Next per-request `fetch`
   dedup (measured: no extra queries) but fragile — thread the page's `vm` in.
4. Auth context (`profiles` + `memberships`) re-queried per navigation (~2 queries, ~35–90 ms);
   deduped within a render.
5. Two differently-shaped parameter-group reads per builder load (`data-source` ea-version-scoped
   vs page `listParameterGroups` org-scoped) — consolidatable with care.
6. Middleware (`proxy.ts`) 60–600 ms/navigation in dev — measure in production before acting.
7. PDF generation-required path — measure on Preview (real Chromium) during 8B-10 E2E.

## 8B-9 — Dependency, dead-code & repository hygiene — CLOSED

Release hygiene audit. `npm audit` **0 vulnerabilities** (prod-only + full). No P0. Two P1
deprecations resolved; two dead files removed; P2 backlog recorded (not touched).

**P1 — Next 16 `middleware` → `proxy` convention (build deprecation warning).**
`middleware.ts` was inspected first: no explicit `runtime` config, no Edge-only or Node-only
APIs (`crypto.randomUUID()` is a global on both runtimes), no middleware-specific Next config
flags, `config.matcher` is a static literal. Fully compatible with the Proxy convention (which
defaults to the Node.js runtime). Minimal official migration applied: `git mv middleware.ts
proxy.ts`; `export async function middleware()` → `proxy()`; `config.matcher` byte-identical;
no `next.config.ts` change (no middleware/proxy flags in this repo). Updated one test that reads
the file by name (`schema-parity.test.ts`) and two doc comments. Live-verified behaviour is
unchanged: unauthenticated workspace routes still `307 → /login`; authenticated developer routes
still `200`; public manual still `200`; `/api/health` + `/_next/static` still excluded by the
matcher (no `x-request-id`, proxy not run); caller-supplied `x-request-id` still reused, absent
one still generated. Build no longer emits the `middleware` deprecation warning.

**P1 — GitHub Actions Node-20 runtime deprecation (`actions/checkout@v4`, `actions/setup-node@v4`).**
Verified from each action's `action.yml`: v4 = `using: node20` (the warning source); v5/v6/v7 =
`using: node24`. Bumped both to **`@v5`** — the minimum major that clears the warning — in both
CI jobs. Breaking-change review: `checkout@v5` = runtime bump only, and this workflow passes zero
`checkout` inputs; `setup-node@v5`'s breaking change (auto npm cache when `package.json` has a
`packageManager` field) does **not** apply — no such field, and the explicit `cache: npm` is
preserved. **App test runtime stays Node 22** (`setup-node` `node-version: 22` unchanged). `npm
ci`, the fork-PR skip `if:`, the authoritative-repo fail-closed secret check, and the real DEV
integration step are textually unchanged.

**Proven dead code removed** (only two unused top-level exports in the whole codebase):
`lib/supabase/client.ts` (`getSupabaseBrowserClient` — zero importers; the app is fully
SSR/server-actions/service-client; last touched Phase 2) and `features/manuals/use-autosave.ts`
(`useAutosave` — superseded by `lib/editor/autosave-queue.ts` `createAutosaveQueue`; zero
importers; last touched Phase 2). No TODO/FIXME markers, no commented-out code, no
`console.log`/`debugger`, no stale feature flags anywhere in app code.

**Repository hygiene:** `.gitignore` adequate; no tracked logs/temp/screenshots/binaries/secrets
(only `.env.example`, names-only). 32 migrations, monotonic, no duplicate timestamps (the `*_fix`
/ `*_guard_bypass` names are the append-only forward-correction discipline, not duplicates).
`AGENTS.md` / `CLAUDE.md` are per-developer `next dev`-generated artifacts (fixed vendor template,
no project content); the repo keeps its real guidance in `docs/` — untracked copies removed, no
`.gitignore` rule added (**P2 recommendation only**).

**P2 maintenance backlog (not implemented):** 19 minor/patch dependency updates; `eslint` 9→10
(major, 9.x deprecated) and `typescript` 6→7 (major) — deferred; `package.json` `db:types` script
targets a nonexistent `database.generated.ts` and uses `--local` (retarget or remove);
`.gitignore` `/AGENTS.md` + `/CLAUDE.md`; optional `engines.node >=22`; duplicate private helpers
(`authFail` ×13, `mapRpcError` ×4, `resolveVersion` ×2, `fmt` ×2, `safePlain` ×4, `parseSemver`
×2) — consolidating the server-action ones risks error-path behaviour changes.

**Gates:** `git diff --check` clean, `tsc` clean, lint clean, unit **692 / 692** (58 files),
build ok (no `middleware` deprecation warning), DEV integration **152 / 152** (run because
`middleware → proxy` changes a runtime entrypoint).

## 8B-10 — Full DEV / Preview end-to-end lifecycle — CLOSED

Primary evidence for **AC-P8-5** (cross-org role/RLS isolation) and **AC-P8-8** (end-to-end
permission + publishing boundary). Baseline `de0ae46`. No product/schema change; two new test
suites; the PDF generation-required measurement that PHASE_8.md deferred to this slice.

**Scope:** one continuous real-workflow run on a disposable fixture — authoring (all 6 block
kinds) → reviewer assignment → technical request-changes → resubmission → technical approval →
compliance approval → publish → published immutability → archive — every server-side boundary
asserted through the actual authenticated user path (never a hidden button, never the service
path for a user action), plus cross-org isolation, human-evidence regression, audit integrity,
and, on a deployed uncommitted Preview, the public-route boundary and the real-Chromium PDF
generation-required path.

**Fixture strategy:** per-run unique EA Product + EA Version + Manual Version, all prefixed
`E2E-8B10-<YYYYMMDDhhmmss>` / slug `e2e-8b10-<run>`. Every fixture is cascade-deleted in
`afterAll`; only `audit_events` rows persist (strictly append-only by design, migration
20260901002400) and are retained as E2E-prefixed DEV evidence. Shared Phase 7/8 fixtures
(`p7-pdf-*`, VMax, `slice6-pub-ea`) are never touched. Verified: post-run DEV orphan scan is
empty (`ea_products` / `published_snapshots` matching the E2E prefix → `[]`).

**Suites added:**
- `tests/integration/e2e-lifecycle-8b10.test.ts` — 20 tests, DEV only, guarded by
  `assertIntegrationTargetIsDev()`; self-skips with no credentials. Runs the full lifecycle on one
  fixture.
- `tests/e2e/lifecycle-pdf-8b10.e2e.test.ts` — 6 tests against a deployed Preview; creates + drops
  its own freshly-published `e2e-8b10-pdf-<run>` fixture (no artifact) and drives the real
  generation path.

**DEV lifecycle result — 20/20:** environment guard (target = DEV ref `tmrwhkhydkjaubpuegqa`, not
Prod `wotidyhpbltoxmzvdqkj`); canonical chapters instantiated from the system template;
representative blocks (text / callout / steps / parameterTable-by-ref / faq-multi / structured
changelog via `create_changelog_entry`); non-DRAFT edit server-refused, DRAFT edit round-trips.
**DEVELOPER negatives (server-side, forged direct RPC/table calls):** cannot `assign_reviewers`,
cannot `record_technical_decision` / `record_compliance_decision`, cannot `publish_manual_version`
(forged DEVELOPER `p_actor_id` → `only an ADMIN`), cannot forge a cross-org `ea_version`.
**Reviewer assignment:** ADMIN assigns → exactly one `manual_version:assign_reviewers` audit;
DEVELOPER re-assign refused; wrong-role and cross-org assignees refused. **Technical review:**
submit → `TECHNICAL_REVIEW` + one `submit_review` audit + content becomes server-side read-only;
manual/section/block anchored comments; empty request-changes summary refused; `REQUEST_CHANGES`
→ `CHANGES_REQUESTED` + one audit + exactly one r1 technical `reviews` row + prior 3 comments
retained. **Resubmission:** `begin_revision` → `DRAFT` (editable again) → `submit_for_technical_review`
→ `TECHNICAL_REVIEW` round 2 — never `COMPLIANCE_REVIEW`. **Technical approval:** DEVELOPER and
the unassigned (compliance) reviewer cannot approve; **§9 self-approval** — assigning
`developer@` (a contributor to the version) as technical reviewer and attempting APPROVE →
typed `self approval forbidden … authored or edited`; stale content hash → `stale content`;
independent assigned reviewer APPROVE → `COMPLIANCE_REVIEW` + exactly one r2 technical APPROVE
`reviews` row (correct `reviewer_id` + `decided_at`) + one `technical_approve` audit.
**Compliance:** DEVELOPER / technical reviewer cannot make a compliance decision; assigned
compliance APPROVE → `APPROVED` + one r2 compliance APPROVE row + one `compliance_approve` audit.
**Publish:** non-admin actor ids (`DEV`/`REV`/`COMP`) → `only an ADMIN`; ADMIN before checklist →
validation error; ADMIN + full 31-PASS checklist → `PUBLISHED`, one `published_snapshots` row
(`content_hash` == `computeSnapshotHash(render_json)`, correct `public_slug`/`public_version`),
`published_at` set, one `publish` audit, `public_manuals` + `public_manual_versions` index rows
present and `PUBLISHED`. **Published immutability:** block update / soft-delete / insert and
section update are all server-rejected; frozen snapshot bytes recompute to the stored hash.
**Archive:** DEVELOPER archive refused; ADMIN archive → `ARCHIVED` + `archived_at` + one `archive`
audit; snapshot hash-stable; the public index row for the version flips to `ARCHIVED`.
**Cross-org (AC-P8-5), through normal authenticated user paths:** an Org B member (`outsider@`)
reads `[]` for the E2E product / ea_version / manual / manual_version / sections / blocks /
reviews / review_comments / checklist_results / published_snapshots; cross-org mutations affect 0
rows; forged `create_review_comment` / `record_technical_decision` on the Org A mv → typed denial;
a forged Org B ADMIN `p_actor_id` on `publish_manual_version` / `archive_manual_version` of the
Org A mv → rejected (not an admin *of Org A*). **Human-evidence (UAT-35):** on a throwaway sibling
mv, an author evidence submission on an eligible WARNING never flips the automated state to PASS;
the author cannot decide their own evidence; editing the anchored block STALEs the live
submission; an evidence submission against an authoritative REQUIRED-MISSING check is rejected
outright; an Org B member reads `[]` of the org's evidence rows. **Audit integrity:** exactly one
event per privileged command (`assign_reviewers` ≥1, `submit_review` 2, `technical_request_changes`
1, `technical_approve` 1, `compliance_approve` 1, `publish` 1, `archive` 1); every row carries a
real `actor_id`, `entity_type = manual_version`, a timestamp, and secret-free metadata; UPDATE and
DELETE of an `audit_events` row are rejected for an authenticated caller **and for the
service_role**.

**Deployed Preview result — 6/6** (`dpl_7D138MxNv9KSN8PdFD28gXM75cic`, uncommitted, `target: preview`,
`APP_ENV=preview`, `/api/health` `env:"preview"` + `APP_ENV/project match` ok → DEV Supabase):
- **Public route boundary:** PUBLISHED `slug/1.0.0` → 200 (HTML free of `storage_key` /
  `render_json` / `service_role` / `supabase.co/storage`); unknown version → 404; unknown slug →
  404; sibling DRAFT `1.0.1` (never published) → 404.
- **PDF generation-required (real `@sparticuz/chromium` on Vercel):** first trigger of a
  never-generated snapshot ran a real Chromium generation and returned `outcome: "generated"`,
  `status: "READY"`, `sha256`, `byteSize ≈ 25 KB`, `pageCount 3`. **Timing — see the KNOWN
  PERFORMANCE RISK below** (warm ≈ 12–19 s; cold > 180 s observed; carried into AC-P8-7).
- **Idempotency:** re-triggering the same snapshot returns `outcome: "ready"` (never a second
  `generated`) — no second Chromium run.
- **READY GET:** `GET /manual/<slug>/1.0.0/pdf` → 200 in **≈ 3.3 s** (stored-artifact read, no
  Chromium), `%PDF-`, byte length and SHA-256 **byte-identical** to the generated artifact,
  `Cache-Control: immutable`, `X-Content-Type-Options: nosniff`, `Content-Disposition` filename
  `Manual_E2E-8B10-PDF-<run>_EA_v1.0.0.pdf` (matches `Manual_<EAName>_v<X.Y.Z>.pdf`); bytes +
  headers carry no `render_json` / `storage_key` / `service_role` / `PDF_PRINT_SECRET` /
  `x-smartin-print-token` / `lease_token`.
- **Print-token boundary:** `/print` → 404 with no token, 404 with a garbage token, 404 with a
  legacy `?t=`; 200 with a valid HMAC print token.
- **Web / PDF parity:** the deployed public page and the same-snapshot PDF both carry the same
  chapter titles ("… Identitas Produk", "Instalasi"), the same EA name, the same version, and the
  authored intro text + a step instruction render; neither surface contains
  `disetujui regulator` / `regulator-approved` / `bappebti approved` / `certified compliant`.

**Phase 7 output-parity / visual-parity — INHERITED, NOT rerun in 8B-10.**
`tests/e2e/output-parity.e2e.test.ts` and `tests/e2e/visual-parity.e2e.test.ts` were **not
rerun** in this slice: the environment lacked `pdftotext` and the required headless-browser
tooling. Their status is **inherited Phase 7 evidence** (AC-P7-4 content-model diff + AC-P7-10
regulatory-language sweep, PASS in Phase 7). The renderer / generator / output / parity code is
**unchanged in 8B-10** (`git diff --stat` for this slice = `docs/PHASE_8.md` + two new test files
only), so the Phase 7 result stands by construction. This is **not** a fresh 8B-10 PASS. 8B-10's
own deployed parity check (`lifecycle-pdf-8b10.e2e.test.ts`) is title / identity / authored-text
level on a hand-built `render_json` stub (real `snapshotToViewModel` payload shapes), not a
block-by-block diff.

**KNOWN PERFORMANCE RISK — PDF cold-start generation > 180 s (carried into AC-P8-7).**
Not a correctness blocker for 8B-10, but recorded here and to be resolved / decided in the
AC-P8-7 evidence & decision matrix (8B-11):
- **Warm generation:** trigger → READY round trip ≈ **12–19 s**.
- **Cold generation:** > **180 s** observed (a cold first run exceeded a 180 s client wait; the
  route's `maxDuration` is 300 s and the artifact still became durably READY server-side).
- **Root cause:** Vercel Lambda + `@sparticuz/chromium` **cold start dominates** and varies per
  invocation; the render itself is a small fraction.
- **`maxDuration` remains 300 s** (`vercel.json` for `app/manual/[eaSlug]/[version]/pdf/route.ts`
  — unchanged in 8B-10).
- **READY-artifact GET is unaffected:** ≈ 3.3 s stored-bytes read, **never invokes Chromium**;
  bytes + SHA-256 byte-identical to the generated artifact.
- **No product-code change made for this in 8B-10.**

**Environment isolation proof:** every destructive write went through a client whose
`SUPABASE_TEST_URL` resolves to the DEV ref `tmrwhkhydkjaubpuegqa` (asserted in-test); the Preview
is bound to the same DEV project (`/api/health` `env:"preview"`, `APP_ENV/project match` ok). No
migration was authored in 8B-10 → the DEV and Production migration set is unchanged (32 files).
No Production Supabase credential was used; no Production fixture, review, audit row, schema
change, or PDF artifact was created. The two canonical DEV `p7-pdf-*` READY artifacts are
untouched (still `byte_size` 287493 / 2536304).

**Gates:** `git diff --check` clean; `tsc --noEmit` clean; `lint` clean; unit **692/692**; DEV
integration **172/172** (152 existing + 20 new 8B-10 lifecycle tests); `build` OK
(`ƒ Proxy (Middleware)`, no deprecation warning); deployed Preview E2E **6/6**. Phase 7
output-parity / visual-parity: inherited, not rerun (see above).

## 8B-11 — AC-P8-1..10 evidence & closure matrix — CLOSED

Evidence / audit / decision slice. Baseline `4fc83e3`. **Docs only** — no product / schema /
migration / RBAC / workflow change; no Preview or Production deploy. All ten MUST/SHOULD
acceptance criteria are supported (see the final matrix); Phase 8 is **not** marked complete
(that is 8B-12).

**Evidence-freshness vocabulary** — FRESH (verified in 8B-11 or the final green 8B-10 CI where
still applicable) · RECENT-INHERITED (verified in 8B-9 / 8B-10, relevant code unchanged since) ·
HISTORICAL-INHERITED (verified in an earlier Phase 7/8 slice, implementation unchanged; source
named) · DOCUMENTARY (code / config / schema inspection) · DEFERRED (owner + date + reason).

---

### AC-P8-1 — GI-1..GI-12 hold across the whole app — **PASS**

| GI | Requirement (abbrev.) | Current implementation | Evidence | Freshness | Status |
|---|---|---|---|---|---|
| GI-1 | No "Approved / Bappebti Approved / Certified / Compliant" on any screen, PDF, log, API — only "ready for compliance review" / internal-decision wording | `INTERNAL_NOTE` constants in `publish-controls.tsx` / `review-controls.tsx` / `review-history.tsx`; builder note `features/manuals/manual-builder.tsx:275`; compliance-note on `resources/compliance/page.tsx`, `reviews/compliance/page.tsx` | AC-P5-9 (rendered-output scan, Phase 5) + AC-P7-10 (public web + PDF scan, Phase 7) + 8B-10 deployed web/PDF language sweep (`disetujui regulator` / `regulator-approved` / `bappebti approved` / `certified compliant` → 0) + 8B-11 source scan (only hit = a *search-keyword* string in `resources/guide/page.tsx:99` listing forbidden claims for an author-guidance article — not rendered as a claim) | HISTORICAL-INHERITED (P5/P7) + FRESH (8B-10 CI, 8B-11 scan) | PASS |
| GI-2 | Manual X never shows another EA's data (no VMax bleed); every value is for the route's manual | `assembleManualViewModel` loads by explicit `manualId`, never "a" manual; `lib/manual/list-dedupe.ts` (8B-5) picks the route manual's own latest version | AC-P2-12 (Polaris end-to-end assertion, Phase 2) + `tests/unit/manual-list-dedupe.test.ts` (8) + 8B-10 lifecycle authored + rendered its own fixture only | HISTORICAL-INHERITED (P2) + RECENT-INHERITED (8B-5/8B-10) | PASS |
| GI-3 | `lint`, `typecheck`, `next build` pass, zero errors | — | 8B-11 FRESH: `tsc --noEmit` clean, `eslint .` clean (0/0), `next build` `✓ Compiled successfully`; final green 8B-10 CI `verify` job (Lint/Typecheck/Unit/Build all success) | FRESH | PASS |
| GI-4 | Browser console free of errors/warnings on the main workflow | — | 8B-5 live real-browser audit (login → dashboard → list → builder → preview → public) + 8B-8 live perf pass; `preview_logs` server-side "no errors"; the 3 fixed 8B-5/8B-6 P1s removed the known console warnings (duplicate React key, focus trap, chapter-action swallowed error) | RECENT-INHERITED (8B-5/8B-6/8B-8) | PASS |
| GI-5 | No document-level horizontal scroll; builder centre column no nested h-scroll at 375/768/1024/1440 | `.builder-grid` centre track = `minmax(0, 1fr)`; `.responsive-table-wrap { overflow-x:auto }` contains table scroll; 8B-5 fixed the 375 px top-bar crush | 8B-5 live responsive audit at all 4 widths (this slice's own audit); `app/globals.css` inspection | RECENT-INHERITED (8B-5) + DOCUMENTARY | PASS |
| GI-6 | Every disabled control has a visible reason; no inert buttons | `title=` on all `disabled` controls (publish "Terbitkan manual…", preview "Ekspor PDF", review "Belum siap dikirim", param manager, etc.); `button:disabled { opacity:.52 }` + adjacent blocker copy | AC-P1-12 (Phase 1) + 8B-6 empty/loading/error audit confirmed disabled-with-reason across all async controls | HISTORICAL-INHERITED (P1) + RECENT-INHERITED (8B-6) | PASS |
| GI-7 | Icon+text status (never colour alone); visible focus rings; 44 px targets; `prefers-reduced-motion` | `StateIcon`/`StatusBadge` render icon **and** label; `:focus-visible { outline: 3px solid … }`; `touch-action: manipulation`; status pills carry text | 8B-5 live a11y audit (§AC-P8-3 table below); `app/globals.css` | RECENT-INHERITED (8B-5) + DOCUMENTARY | PASS |
| GI-8 | Org A member cannot list/read/mutate any Org B entity | RLS on every table + composite FKs + SD RPC actor checks | AC-P8-5 (this slice's row) — `tests/integration/rls.test.ts` (152) + `tests/integration/e2e-lifecycle-8b10.test.ts` (20, cross-org section); final green 8B-10 CI **172/172** | FRESH (8B-10 CI) + RECENT-INHERITED (8B-7 static RLS review) | PASS |
| GI-9 | Supabase secret/service key absent from the browser bundle | Secret read only in `lib/env.ts` + `lib/supabase/service.ts` (both `import "server-only"`); browser client uses the publishable key | 8B-7 security closure + 8B-11 FRESH: `grep .next/static/` for `SUPABASE_SECRET_KEY` / `PDF_PRINT_SECRET` / `VERCEL_AUTOMATION_BYPASS_SECRET` / `service_role` / `sb_secret_…` / service-role JWT → **0** | RECENT-INHERITED (8B-7) + FRESH (8B-11 bundle scan) | PASS |
| GI-10 | A supported `symbol × timeframe` exists only as an explicit `ea_version_setups` row; nothing infers a combination | `ea_version_setups` rows; renderer + validation + AI bundle read the stored rows, never a cross-product of distinct symbols/timeframes | AC-P2-9a (UI + code review + fixture, Phase 2) + AC-P3-10 (render test, Phase 3); `create_ea_version_with_setups` stores explicit rows | HISTORICAL-INHERITED (P2/P3) | PASS |
| GI-11 | Parameter definitions owned by `ea_versions`, never `manual_versions`; two manual versions of one EA version resolve to identical definitions | `parameter_groups` / `ea_parameters` FK → `ea_versions` (no `manual_version_id` column); `parameterTable` block references groups of the manual version's single linked EA version; cross-EA-version group rejected | AC-P2-18a (schema inspection + test) + AC-P2-18b (propagation test) + AC-P3-8 (two-manual-version propagation) + `rls.test.ts` "Phase 3 — parameter definition edits propagate…" + 8B-10 authored a `parameterTable`-by-ref block | HISTORICAL-INHERITED (P2/P3) + RECENT-INHERITED (8B-10) | PASS |
| GI-12 | Any "minimum lot" is labelled *Tested Minimum Lot* (developer data) with the broker-spec statement; no EA-controlled universal minimum lot | `BROKER_MIN_LOT_NOTE_ID` note in the setup editor; "tested data — bukan minimum broker" small text; version detail + Ch.2/9 render "Tested Minimum Lot" | AC-P2-9c (UI + output scan, Phase 2) | HISTORICAL-INHERITED (P2) | PASS |

**AC-P8-1 status: PASS.** GI-3, GI-8, GI-9 have FRESH 8B-11 / final-8B-10-CI evidence; the rest are HISTORICAL- or RECENT-INHERITED against unchanged implementations (verified no relevant code changed after each source slice).

---

### AC-P8-2 — route loading / empty / error / retry matrix — **PASS**

Routes enumerated from `app/`. The `(workspace)` group shares one boundary: `app/(workspace)/loading.tsx`
(skeleton, `aria-busy` + `aria-live` + `.sr-only "Memuat…"`) and `app/(workspace)/error.tsx`
(`role`-less `route-state-page`, generic Indonesian copy, **"Coba lagi"** button calling `reset()`,
no data/secret leak). Empty/error states within a route are the component-level ones audited in 8B-6.

| Route | Scope | Loading | Empty | Error | Retry / next action | Evidence | Status |
|---|---|---|---|---|---|---|---|
| `/` | public | n/a (redirect) | n/a | n/a | redirects to `/dashboard` or `/login` | `app/page.tsx` | PASS |
| `/login` | auth | `useActionState` `pending` → "Memproses…" button | n/a | `state.error` + `!configured` → `role="alert"` field-error | inline error; resubmit | `login-form.tsx` (8B-6) | PASS |
| `/no-membership` | auth | static | static (is itself the empty/exception state) | static | link back | `no-membership/page.tsx` | PASS |
| `/not-found` (global 404) | any | n/a | is the empty state | n/a | "Kembali ke dashboard" link | `app/not-found.tsx` | PASS |
| `/dashboard` | workspace | group `loading.tsx` skeleton | `ManualTable` `rows.length===0` → "Belum ada manual" + "Buat manual" (if `canCreate`) | group `error.tsx` + "Coba lagi" | create-manual CTA / retry | `dashboard/page.tsx`, `manual-table.tsx` (8B-6) | PASS |
| `/manuals` | workspace | group skeleton | `rows.length===0` "Belum ada manual"; `displayed.length===0` (filtered) "Manual tidak ditemukan" + **Reset filter** | group `error.tsx` + "Coba lagi" | create / reset-filter / retry | `manuals/page.tsx`, `manual-table.tsx` (8B-6) | PASS |
| `/manuals/new` | workspace (create) | wizard `pending` → "Membuat…" | n/a (form) | `formError` `role="alert"` error-summary + per-row `field-error` | fix + resubmit | `create-manual-wizard.tsx` (8B-6) | PASS |
| `/manuals/[id]/edit` | manual authoring | group skeleton + inner `SectionEditor` optimistic; `save-state` role="status" | empty chapter → "Apa yang perlu diisi di bab ini?" guidance; 0 blocks → block-count "0 blok" + guidance | group `error.tsx`; block save failure → per-block `field-error`; chapter-action failure → `ChapterNav` `role="alert"` (8B-6); nav-flush failure → `save-state-warn` | retry save / "coba lagi" / fix block; chapter mutations serialized + reverted | `manual-builder.tsx`, `section-editor.tsx`, `chapter-nav.tsx` (8B-6) | PASS |
| `/manuals/[id]/preview` | preview | group skeleton; "Membuka preview…" transition button | read-only view of the manual (guidance shown where chapters empty) | group `error.tsx`; PDF button: FAILED → "PDF belum tersedia", transient fetch fail → **"Gagal mengunduh — coba lagi"** (8B-6) | retry PDF download; "Edit manual" link | `preview/page.tsx`, `pdf-download-button.tsx` (8B-6) | PASS |
| `/manuals/[id]/reviews` | review | group skeleton | `review-history.tsx` — "Belum ada" states per section | group `error.tsx` + "Coba lagi" | n/a (history view) | `reviews/page.tsx`, `review-history.tsx` (8B-6) | PASS |
| `/reviews/technical`, `/reviews/compliance` | review | group skeleton | assignment-scoped queue empty → empty-state copy | group `error.tsx` + "Coba lagi" | n/a (queue) | `reviews/*/page.tsx` (8B-6) | PASS |
| `/settings` | workspace | group skeleton | static content | group `error.tsx` + "Coba lagi" | n/a | `settings/page.tsx` | PASS |
| `/templates` | workspace | group skeleton | template list (seeded system template always present) | group `error.tsx` + "Coba lagi" | n/a | `templates/page.tsx` | PASS |
| `/resources/guide`, `/resources/compliance` | workspace | group skeleton | static reference content | group `error.tsx` + "Coba lagi" | n/a | `resources/*/page.tsx` | PASS |
| `/ea-products` | workspace | group skeleton | 0 products → `card empty-state` "Belum ada produk EA" + "Tambah produk" | group `error.tsx` + "Coba lagi" | create-product CTA | `ea-products/page.tsx` (8B-6) | PASS |
| `/ea-products/[id]` | workspace | group skeleton | 0 versions → empty-state + "Buat versi EA"; `ProductNotFound` → 404 | group `error.tsx` + "Coba lagi" | create-version / back | `ea-products/[productId]/page.tsx` (8B-6) | PASS |
| `/manual/[slug]/[version]` | public manual | `dynamic` server render (no client loading needed) | never-published / unknown slug or version → **404** (`notFound()`); ARCHIVED → 200 + neutral banner | `PublicSnapshotCorruptError` → generic 500, no DB detail | "view latest published" link on archived | `manual/[eaSlug]/[version]/page.tsx` + 8B-10 boundary test | PASS |
| `/manual/[slug]/[version]/print` | public (token) | server render | invalid/absent token → **404** (non-enumerating) | generic 404 | n/a | `print/page.tsx` + 8B-10 token-boundary test | PASS |
| `/api/health`, `/api/internal/pdf-artifact`, `/manual/.../image/[idx]`, `/manual/.../pdf` | API (not navigable UI) | n/a | n/a | typed JSON / bare 404 / 502; no leak | 8B-10 + `pdf-endpoint.e2e.test.ts` | PASS (API — no UI state required) |

**AC-P8-2 status: PASS.** Every user-navigable route has a defined loading, empty, and error state
with a retry or clear next action. Evidence = the 8B-6 empty/loading/error/retry audit (which
fixed the 2 real P1 gaps) + the shared `(workspace)` `loading.tsx`/`error.tsx` boundary + 8B-10's
public-route boundary tests. Freshness: RECENT-INHERITED (8B-6) + FRESH (8B-10 CI for the public
routes). No MUST gap remains.

---

### AC-P8-3 — accessibility (WCAG 2.1 AA against this project's acceptance) — **PASS**

Source: **8B-5 live real-browser accessibility + responsive audit** (this slice's own audit, real
DEV data, keyboard + screen-reader-oriented checks), plus `app/globals.css` / component inspection.

| Requirement | Implementation | Evidence | Freshness | State |
|---|---|---|---|---|
| Contrast ≥ 4.5:1 (body/label text) | token palette (`--primary #0f172a` on `--surface #fff`, `--muted-foreground #475569`); status colours paired with text | 8B-5 audit; token inspection | RECENT-INHERITED (8B-5) | conforms |
| Visible focus | `:focus-visible { outline: 3px solid rgba(37,99,235,.38); outline-offset: 2px }` global | `app/globals.css:37` | DOCUMENTARY | conforms |
| 44 px touch targets | `touch-action: manipulation`; button/nav sizing meets 44 px on the mobile breakpoint | 8B-5 audit at 375 px | RECENT-INHERITED (8B-5) | conforms |
| Icon **and** text status | `StateIcon` + `COMPLETION_LABEL`, `StatusBadge` icon + `STATUS_LABELS`, review pills carry text | component code; 8B-5 | DOCUMENTARY + RECENT-INHERITED | conforms |
| Keyboard alternative for every drag/reorder | ChapterNav ▲/▼ move buttons alongside the drag handle; block reorder ▲/▼; setup-row ▲/▼ | AC-P3-5 (keyboard + pointer test, Phase 3) + 8B-6 concurrency tests exercise the move buttons | HISTORICAL-INHERITED (P3) + RECENT-INHERITED (8B-6) | conforms |
| `prefers-reduced-motion` | honoured in `app/globals.css`; **not independently re-verified live in 8B-5** | 8B-5 P2 backlog item (carried) | RECENT-INHERITED + open P2 spot-check | conforms (P2 spot-check outstanding) |
| Landmarks | `app-shell` `<aside aria-label="Navigasi utama">`, `<header>`, `<main id="main-content" tabIndex={-1}>`, skip link "Lewati ke konten utama" | `components/app-shell/app-shell.tsx` | DOCUMENTARY | conforms |
| Heading structure | one `<h1 id="chapter-title">` per builder view; public manual `<h1>` cover + `<h2>` per chapter | 8B-10 rendered-HTML inspection (`<h1>`/`<h2>` hierarchy); component code | FRESH (8B-10 HTML) + DOCUMENTARY | conforms |
| Labelled controls | every `<input>`/`<select>` in a `<label>` or with `aria-label`; search fields carry `.sr-only` labels | 8B-5 audit; component code | RECENT-INHERITED + DOCUMENTARY | conforms |
| Inline + summary form errors | wizard `error-summary` `role="alert"` + per-row `field-error`; login `role="alert"`; changelog per-entry `cl-error` | AC-P8-2 evidence; 8B-6 | RECENT-INHERITED (8B-6) | conforms |
| Modal focus trap (mobile nav drawer) | `role="dialog"` + `aria-modal`, Tab/Shift+Tab wrap, focus-in on open, focus-restore on close | **8B-5 fix** + `tests/unit/app-shell-drawer.test.tsx` (5) | RECENT-INHERITED (8B-5) | conforms |

**Automated tooling:** the repo ships no axe/pa11y harness; none added (per the slice constraint —
not "genuinely necessary" when the 8B-5 live audit + `app-shell-drawer` unit tests + DOCUMENTARY
CSS/landmark evidence cover the acceptance wording). **Known exception / open P2:**
`prefers-reduced-motion` was fixed in code but not independently re-verified in a live 8B-5 pass —
carried as a P2 spot-check (owner: release engineer; target: 8B-12 handover checklist). This does
not block AC-P8-3: the acceptance criterion's listed items are each supported by live-audit or
code evidence; the reduced-motion rule *is present in the stylesheet*, only its live re-check is
outstanding.

**AC-P8-3 status: PASS** (conformance evidence against this project's acceptance criterion — not a
formal external WCAG certification).

---

### AC-P8-4 — responsive at 375 / 768 / 1024 / 1440 px — **PASS**

Source: **8B-5 live responsive audit** (real browser, real DEV data, all 4 widths, across Login,
Dashboard, Manual Book list, Produk EA, Manual Builder (chapter nav / block editor / add-delete
chapter), Preview, Review Teknis, Public Manual).

| Surface | 375 | 768 | 1024 | 1440 | Notes | Evidence | Status |
|---|---|---|---|---|---|---|---|
| Login | ok | ok | ok | ok | single card, centred | 8B-5 | PASS |
| Dashboard | ok | ok | ok | ok | metric grid + `responsive-table-wrap` (`overflow-x:auto`) contains the table | 8B-5 | PASS |
| Manual Book list | ok | ok | ok | ok | filter bar wraps; table scroll contained; **duplicate-key bug fixed in 8B-5** | 8B-5 | PASS |
| Produk EA (list + detail) | ok | ok | ok | ok | product grid → 1 col on mobile | 8B-5 | PASS |
| **Manual Builder** | **fixed in 8B-5** | ok | ok | ok | 375 px top-bar breadcrumb crush fixed (`min-width:0` + nested `max-width`); mobile drawers for Bab/Inspector; **centre column = `minmax(0,1fr)` → no document h-scroll, no nested h-scroll** | 8B-5 (fix + re-verify) | PASS |
| Validation inspector / inline parameter manager | ok | ok | ok | ok | inspector is a mobile drawer < 768; param tables in `param-table-editor` flex column; long param table → contained region | 8B-5 | PASS |
| Review pages (technical / compliance / reviews history) | ok | ok | ok | ok | queue lists + comment panel stack on mobile | 8B-5 | PASS |
| Settings / Templates / Resources | ok | ok | ok | ok | static content, single column | 8B-5 (spot-check) | PASS |
| Preview | ok | ok | ok | ok | A4 doc scales; **P2: occasionally loads pre-scrolled** (carried) | 8B-5 | PASS (P2 noted) |
| Public manual | ok | **P2** | ok | ok | **P2: footer text ~1-char clip at 375 px** (carried, non-blocking) | 8B-5 + 8B-10 (deployed render inspected) | PASS (P2 noted) |

**AC-P8-4 status: PASS.** No document-level horizontal scroll and no nested h-scroll in the builder
centre column at any of the 4 widths (the two conditions the criterion calls out). Two cosmetic
P2s remain (public-manual footer ~1-char clip at 375 px; Preview occasionally pre-scrolled) —
carried in the 8B-5 backlog, neither is a horizontal-scroll or layout-break defect. Freshness:
RECENT-INHERITED (8B-5) + FRESH (8B-10 deployed public-manual HTML inspected).

---

### AC-P8-5 — cross-org / RLS test suite (service path disabled) — **PASS**

**Primary evidence: RECENT-INHERITED (8B-10) + FRESH (final green 8B-10 CI).** Relevant code
(RLS / RPC / schema) is unchanged since `4fc83e3` → no destructive browser E2E rerun needed.

| Org B entity family | Org A member (via authenticated user path, no service path) | Test |
|---|---|---|
| EA products | read `[]`; `update` 0 rows | `rls.test.ts` "cross-org isolation" + `e2e-lifecycle-8b10.test.ts` "cross-org" |
| EA versions | read `[]`; forged `create_ea_version_with_setups` referencing a B product id → rejected | both suites |
| ea_version_setups / parameter_groups / ea_parameters | read `[]`; `copy_parameter_definitions` cross-org copy refused, no partial write | `rls.test.ts` "Finding 5" |
| manuals / manual_versions / manual_sections / manual_blocks | read `[]`; `update` 0 rows | `e2e-lifecycle-8b10.test.ts` cross-org |
| reviews / review_comments | read `[]`; forged `create_review_comment` / `record_technical_decision` on the A mv → typed denial | `e2e-lifecycle-8b10.test.ts` |
| checklist_results / checklist_evidence_submissions | read `[]` | `e2e-lifecycle-8b10.test.ts` + `rls.test.ts` UAT-35 block |
| published_snapshots / public index / private image + storage | read `[]`; published-image proxy is snapshot-membership-scoped; private buckets have no anon/authenticated policy | `rls.test.ts` "private image access", "Phase 7 slice 1" |
| reviewer decisions (publish / archive) | forged Org B ADMIN `p_actor_id` on `publish_manual_version` / `archive_manual_version` of the A mv → rejected (not an admin **of Org A**) | `e2e-lifecycle-8b10.test.ts` |

**Fresh CI proof:** run `34020261218` (commit `4fc83e3`) DEV integration **172/172** =
`rls.test.ts` (152) + `e2e-lifecycle-8b10.test.ts` (20). No secret values in the CI log; fork-PR
skip step `=> skipped` (real DEV job executed). Also 8B-7's static RLS review: RLS enabled on
every table, zero `anon` grants, all 70 SECURITY DEFINER functions pin `search_path`.

**AC-P8-5 status: PASS.**

---

### AC-P8-6 — security review — **PASS**

| Requirement | Threat | Control | Evidence | Last verification | Status |
|---|---|---|---|---|---|
| Secret/service key absent from client bundle (GI-9) | key exfiltration via JS bundle | secret read only in `lib/env.ts` + `lib/supabase/service.ts` (`import "server-only"`); browser client uses publishable key | 8B-7 + **8B-11 FRESH** `grep .next/static/` → 0 for `SUPABASE_SECRET_KEY` / `PDF_PRINT_SECRET` / `VERCEL_AUTOMATION_BYPASS_SECRET` / `service_role` / `sb_secret_…` / service-role JWT | 8B-11 | PASS |
| Public routes read only published-safe snapshots | draft/private data on a public URL | `app/manual/[eaSlug]/[version]/*` + `lib/publication/get-public-manual.ts` query only `public_manuals` / `public_manual_versions` / `published_snapshots`; DRAFT/never-published → 404; `snapshotToViewModel` strips DB ids | AC-P7-2 (Phase 7) + 8B-8 read-path review + 8B-10 deployed HTML free of `storage_key` / `render_json` / `service_role` / `supabase.co/storage` | 8B-10 CI | PASS |
| AI payload carries only the grounded bundle | prompt exfiltration of unrelated data | `lib/ai/fact-bundle.ts` builds a bounded bundle; `lib/ai/transport/anthropic.ts` sends only `system` + `user`; errors are typed and never echo the key or body | AC-P4 (Phase 4) + 8B-7 transport review | 8B-7 | PASS (HISTORICAL/RECENT-INHERITED) |
| Private buckets reject unsigned access | direct object fetch | both buckets `public:false`; `manual-pdf-artifacts` has **no** anon/authenticated storage policy; `manual-images` policies org-scoped; signed URLs 30-min TTL | `rls.test.ts` "private image access" (other-org cannot sign; object not reachable unsigned; URL expires) | 8B-10 CI | PASS |
| `audit_events` append-only | tamper / delete of the trail | `app.reject_audit_mutation()` rejects UPDATE/DELETE for **every** app identity incl. `service_role`; only raw `postgres` | `rls.test.ts` "neither authenticated NOR service_role can UPDATE/DELETE" + `e2e-lifecycle-8b10.test.ts` "audit integrity" | 8B-10 CI | PASS |
| Logs scrubbed | secret/PII in server logs | `lib/observability/request-id.ts` `redact()` drops `token|secret|key|password|authorization|signedurl`; AI/PDF errors typed; CI masks all secrets `***` | 8B-7 log-path review + 8B-11 CI-log scan (0 unmasked) | 8B-11 | PASS |
| No service-role in the browser | RLS bypass from the client | 8 `createSupabaseServiceClient()` sites, all server-only trusted; no `"use client"` importer; `service.ts` is `import "server-only"` | 8B-7 call-site audit | 8B-7 | PASS (RECENT-INHERITED) |
| PDF print token / bypass secret not leaked | token replay / protection bypass | HMAC print token in a header only, TTL ~120 s; bypass secret in a header only; 8B-10: PDF bytes + response headers carry no `x-smartin-print-token` / `PDF_PRINT_SECRET` / `lease_token` / bypass secret | `pdf-endpoint.e2e.test.ts` "does not leak private identifiers" + `lifecycle-pdf-8b10.e2e.test.ts` | 8B-10 (local E2E) | PASS |
| Cross-org isolation | see AC-P8-5 | — | AC-P8-5 row | 8B-10 CI | PASS |
| Preview / Production environment isolation | writing test data to Prod; wrong project | `lib/env.ts` `assertSupabaseProjectMatchesEnv` (fail-closed, DEV↔`tmrwhkhydkjaubpuegqa` / PROD↔`wotidyhpbltoxmzvdqkj`); `_guard.ts` + `scripts/fixtures/_guard.mjs`; `/api/health` `APP_ENV/project match` | 8B-7 guard review + 8B-10 (Preview `env:"preview"` bound to DEV; no Prod write) + 8B-11 (Prod `/api/health` `ok:true` untouched) | 8B-11 | PASS |

**AC-P8-6 status: PASS.** (Formal "review report" = this table + the 8B-7 §Security closure
section.)

---

### AC-P8-7 — performance (SHOULD) — **PASS WITH KNOWN RISK**

**Literal acceptance wording:**

| Condition | Evidence | Freshness | Result |
|---|---|---|---|
| list/dashboard routes render server-side | `/dashboard`, `/manuals`, `/ea-products` are **server components** (no `"use client"`, `dynamic = "force-dynamic"`, data fetched server-side, `Promise.all`-parallelised) | 8B-11 DOCUMENTARY + 8B-8 trace | conforms |
| builder chapter switch feels immediate | **8B-8 measured: 0 DB round-trips — purely client-side** | RECENT-INHERITED (8B-8) | conforms |
| block edit feels immediate | optimistic `SectionEditor`; single-flight debounced autosave; 8B-8 confirmed no blocking work on edit | RECENT-INHERITED (8B-8) | conforms |
| autosave debounce ≤ ~1 s | `DEFAULT_AUTOSAVE_DEBOUNCE_MS = 800` (`lib/domain/autosave.ts`), `createAutosaveQueue` default 800 ms | 8B-11 DOCUMENTARY | conforms (800 ms) |
| large parameter tables scroll within a contained region | `.responsive-table-wrap { overflow-x:auto }`, `.param-table-editor` flex column; builder centre = `minmax(0,1fr)` | 8B-11 DOCUMENTARY + 8B-5 live | conforms |

Every explicit AC-P8-7 condition is satisfied. **8B-8 also delivered two measured optimisations**
(batched image signing: builder load 26 → 24 DB round-trips; published-image route 5 → 4 per
request) and a documented P2 backlog.

**KNOWN RISK carried from 8B-10 — PDF cold-start generation:**
- **Warm generation** (Lambda hot): trigger → durable READY ≈ **12–19 s**.
- **Cold generation** (fresh Lambda + `@sparticuz/chromium` cold start): **> 180 s observed** (a
  cold first run exceeded a 180 s client wait; the artifact still became durably READY server-side;
  route `maxDuration` = 300 s, unchanged).
- **Root cause:** Lambda + Chromium cold start dominates; the render itself is a small fraction.
- **User impact:** a viewer who requests a PDF for a *just-published* manual whose artifact has not
  yet been generated may wait tens of seconds to > 3 min on a cold path. After the first
  generation, **READY-artifact GET ≈ 3.3 s and never invokes Chromium** (byte-identical SHA-256).
  The publish flow also seeds generation server-side, so in normal operation a viewer usually hits
  a warm/READY artifact.
- **Severity:** medium (SHOULD-level, first-request-only, self-healing once READY).
- **Release-blocking?** **No** — AC-P8-7 is a SHOULD and its explicit conditions pass; the PDF path
  is not in the AC-P8-7 wording. Recorded as a follow-up.
- **Owner / target:** platform/perf owner (release engineer); **target: first post-Phase-8
  maintenance window** — options to evaluate then: pre-warm on publish (already partially done),
  a keep-warm ping, `@sparticuz/chromium` version bump, or a queued/async generation UX. **No
  Chromium-architecture change in 8B-11.**

**AC-P8-7 status: PASS WITH KNOWN RISK** (SHOULD criterion — explicit wording satisfied; the PDF
cold-start performance risk is documented, non-blocking, and owned for post-Phase-8).

---

### AC-P8-8 — end-to-end permission + publishing boundary — **PASS**

**Primary evidence: RECENT-INHERITED (8B-10) + FRESH (final green 8B-10 CI 172/172).** Relevant
code unchanged since `4fc83e3` → not rerun in 8B-11.

`tests/integration/e2e-lifecycle-8b10.test.ts` (20/20 in CI run `34020261218`) proves, on one
continuous fixture through real authenticated user paths: developer cannot review
(`assign_reviewers` / `record_*_decision` rejected); content is server-side read-only in every
non-DRAFT state (block edit rejected); **no self-approval** (a contributor assigned as reviewer
cannot APPROVE — typed `self approval forbidden`); non-admin cannot publish (`DEV`/`REV`/`COMP`
`p_actor_id` → `only an ADMIN`); assigned-reviewer boundaries (unassigned reviewer / wrong role
rejected); request-changes → `CHANGES_REQUESTED` (comments retained, one audit, one decision row);
resubmission → `TECHNICAL_REVIEW` round 2 (never straight to `COMPLIANCE_REVIEW`); technical
approve → `COMPLIANCE_REVIEW`; compliance approve → `APPROVED`; ADMIN publish → `PUBLISHED`
(one snapshot, content hash, slug/version, `published_at`, one audit, public index rows); published
immutability (block insert/update/delete + section mutation all rejected; snapshot hash-stable);
archive → `ARCHIVED`; cross-org isolation (see AC-P8-5); human-evidence (WARNING never flips to
PASS; author can't self-decide; block edit STALEs; authoritative MISSING can't use the fallback);
audit integrity (exactly one event per privileged command; append-only for authenticated callers
**and** `service_role`).

**AC-P8-8 status: PASS.**

---

### AC-P8-9 — TypeScript / dependency / npm ci — **PASS**

| Sub-requirement | Evidence | Freshness | Status |
|---|---|---|---|
| `tsc --noEmit` clean | 8B-11 FRESH + final 8B-10 CI `verify` `Typecheck = success` | FRESH | PASS |
| No new TS suppressions since Phase 2 baseline | 8B-11 FRESH scan: `@ts-ignore` **0**, `@ts-expect-error` **0**, `as any` **0** across `app/ lib/ features/ components/`; `eslint-disable` **3** — all pre-existing/justified (`react-hooks/exhaustive-deps` in `section-editor.tsx:512`; two `@next/next/no-img-element` in `manual-renderer.tsx` for proxy/signed URLs). None added in Phase 8. | FRESH | PASS |
| Dependency set = phase-approved only | 8B-9 dependency audit: `npm audit` **0 vulnerabilities**; `package.json` reviewed — only phase-approved packages (Next 16, React 19, `@supabase/*`, `@tiptap/*`, `zod`, `lucide-react`, `playwright-core` + `@sparticuz/chromium` for Phase 7 PDF, `react-hook-form` + `@hookform/resolvers`, Tailwind v4 for the base reset only). No unexplained package. | RECENT-INHERITED (8B-9) | PASS |
| Reproducible `npm ci` | final 8B-10 CI: `npm ci` from lockfile, `cache: npm` hit, Node `v22.23.2` / npm `10.9.8` on `setup-node@v5` | FRESH (8B-10 CI) | PASS |
| Node version appropriate | CI = **Node 22** (`node-version: 22`); Vercel Prod/Preview ≥ 18 (default 22); local dev Node 20 (EBADENGINE warning only, non-shipping) — documented in 8B-9 | RECENT-INHERITED (8B-9) | PASS |
| CI cache behaviour sane | 8B-9 fix: `actions/checkout@v5` + `actions/setup-node@v5` (node24 action runtime); explicit `cache: npm` preserved; `packageManager` field absent so v5 auto-cache inert; cache-hit shown in the CI log | RECENT-INHERITED (8B-9) + FRESH (8B-10 CI) | PASS |

**AC-P8-9 status: PASS.** No `package.json` / lockfile change in 8B-10 or 8B-11 → `npm ci` was
last exercised in the final green 8B-10 CI (`34020261218`); no fresh `npm ci` from a clean state
needed.

---

### AC-P8-10 — close every PRD §25 Open Question — **PASS**

All 12 `PRD-OQ-*` items are decided; the canonical decision table is below. `docs/PRD.md` §25 and
`docs/REQUIREMENTS_TRACEABILITY.md` are synchronised in this slice (the stale "Open" labels are
corrected to point at the actual phase decision record — historical decision text is not
rewritten). **No item remains marked "Open"; no deferred extension is left with "no fixed date".**

Every DEFERRED extension carries a concrete **target review date: 2026-12-31** — a planning
checkpoint for the named owner to reassess scope, **not a committed delivery date** and not a
Phase 8 release gate.

| ID | Question (abbrev.) | Needed by | Final decision | Decision source | Status | Owner | Decision date | Reason / notes |
|---|---|---|---|---|---|---|---|---|
| PRD-OQ-001 | Styling: bespoke CSS vs Tailwind utilities vs shadcn | Phase 2 | **Bespoke `app/globals.css` token stylesheet is authoritative** (1548 lines, 1094 classes, 0 `@apply`/`@layer`/`@theme`). Tailwind v4 is `@import`-ed for its base reset/preflight only; **no** utility classes in components, **no** shadcn. | `docs/PHASE_2.md` §"PRD-OQ-001"; confirmed 8B-11 (grep: ~0 utility-class usage) | RESOLVED | Frontend lead | Phase 2 | Consistency with the Phase 1 design-token system; keeps the CSS surface auditable. |
| PRD-OQ-002 | Inspector tabs: 2 vs 3 | Phase 3–5 | **2 tabs (Validasi, Metadata)** — completion score + per-chapter status live in Validasi; a separate validation tab was revisited at Phase 5 and stayed folded in. | `docs/PHASE_3.md` §10; AC-P3-14 | RESOLVED | UX | Phase 3 | Third tab only meaningful with the Phase 5 checklist engine, which was integrated into Validasi. |
| PRD-OQ-003 | Auth route group `(auth)` vs `app/login/` | Phase 2 | **`app/login/`** (no `(auth)` group); `/login` + `/no-membership` at app root. | `docs/PHASE_2.md` §"PRD-OQ-003" | RESOLVED | Frontend lead | Phase 2 | Simpler tree; no shared auth layout needed. |
| PRD-OQ-004 | Exact checklist item set + rule keys (v1) | Phase 5 | **The full 31-check set of `COMPLIANCE_REQUIREMENTS.md` §12**, with stable `rule_key`s, seeded as checklist template v1; every `rule_key` maps to a registered evaluator (drift guard test). | `docs/PHASE_5.md` §"PRD-OQ-004 — RESOLVED"; AC-P5-13; `rls.test.ts` "31-item set with stable keys" | RESOLVED | Compliance + Product | Phase 5 | — |
| PRD-OQ-005 | Which chapters are truly `required` | Phase 2 (template) / Phase 5 (validation) | **Resolved with the required set + PBK conditionals** — `manual_template_sections.required` on the seeded system template; seven Bappebti-only items become NOT_APPLICABLE for `pbkScope = OUT_OF_SCOPE`. | `docs/PHASE_5.md` §"PRD-OQ-005 — RESOLVED"; AC-P5-13; `rls.test.ts` template-instantiation test | RESOLVED | Compliance + Product | Phase 5 | — |
| PRD-OQ-006 | Supported-setup granularity | Phase 2 | **Resolved** — configuration = `symbol` (broker suffixes) + `timeframe` (controlled MT enum) + optional preset ref + optional Tested Minimum Lot + optional notes + supported flag + order; model **and** input UI both shipped in Phase 2. | PRD §25 (already marked Resolved); `PRD-EA-009`/`PRD-EA-010`; AC-P2-9 | RESOLVED | Product | Phase 2 | — |
| PRD-OQ-007 | Publishing authority: admin-only vs compliance-reviewer | Phase 6 | **ADMIN only.** `COMPLIANCE_REVIEWER` approves the *documentation* (`COMPLIANCE_REVIEW → APPROVED`); only `ADMIN` runs `APPROVED → PUBLISHED`. Not regulatory approval. | `docs/PHASE_6.md` §"PRD-OQ-007"; `publish_manual_version` RPC (`app.is_admin` check); `rls.test.ts` + `e2e-lifecycle-8b10.test.ts` publish negatives | RESOLVED | Product + Compliance | Phase 6 | Enforced server-side; 8B-10 re-proved (non-admin `p_actor_id` → `only an ADMIN`). |
| PRD-OQ-008 | Locale strategy: separate `manuals` rows vs per-locale versions | Post-MVP (affects Phase 2 schema) | **Per-`manuals`-row locale** — `manuals.locale` column; one `manuals` row per (EA product, locale); manual versions are locale-agnostic under it. Multi-locale authoring UI is **deferred post-MVP** (schema is ready; only `id` is authored in the MVP). | `docs/DATA_MODEL.md` (`locale` on `manuals`); shipped schema (`create_manual_with_version(p_locale)`); `docs/PHASE_2.md` §"schema" | RESOLVED (schema decision) / DEFERRED (multi-locale UI) | Product | Phase 2 (schema decision) | Multi-locale UI deferred — owner: **Product**; **target review date: 2026-12-31** (planning checkpoint, not a committed delivery date); impact: none on MVP (single `id` locale ships); not a Phase 8 release gate. |
| PRD-OQ-009 | Image `scan_status` mechanism; unscanned = blocked vs warning | Phase 2 (upload) / Phase 5 (gate) | **Field stored, no scanner in the MVP, NOT a Phase 5 publish gate.** `image_assets.scan_status` exists and defaults such that the current publish gate does not block on it; a real scanner (Supabase extension or external service) is deferred post-MVP. | `docs/PHASE_5.md` §"PRD-OQ-009"; AC-P5-13 ("image scan not a Phase 5 gate"); `docs/PHASE_2.md` §"schema" note 4 | RESOLVED (MVP scope) / DEFERRED (scanner) | Platform/Security | Phase 5 (MVP-scope decision) | Scanner deferred — owner: **Platform/Security**; **target review date: 2026-12-31** (planning checkpoint, not a committed delivery date); not a Phase 8 release gate; impact: images are org-private (RLS + signed URLs) and only appear in a published snapshot after a human review round, so the residual risk is low. |
| PRD-OQ-010 | Changelog ↔ Pasal 8: record-only vs also produce artefact + task | Phase 6 | **Record + remind only.** IN_SCOPE feature/behaviour entry → records the entry + surfaces a Pasal 8 operational reminder; never files, submits, simulates approval, produces a fake client-approval artefact, or marks the obligation complete. OUT_OF_SCOPE → reminder not shown as an applicable Indonesian PBK requirement. | `docs/PHASE_6.md` §"PRD-OQ-010"; PRD-VER-007; AC-P6 changelog tests | RESOLVED | Compliance + Product | Phase 6 | — |
| PRD-OQ-011 | Non-Bappebti EAs: which chapters/checks suppressed | Phase 5 | **Seven Bappebti-only checklist items become NOT_APPLICABLE for `pbkScope = OUT_OF_SCOPE`** (item-level flag in `evaluate.ts`); chapters stay but their PBK-specific checks are suppressed. | `docs/PHASE_5.md` §"PRD-OQ-011"; AC-P5-13; `rls.test.ts` validation-rules coverage | RESOLVED | Compliance | Phase 5 | — |
| PRD-OQ-012 | Template editing depth in v1 | Phase 2 | **v1 ships versioned template tables + the seeded system template + version-recording on manual creation; NO admin template-CRUD UI.** Per-manual-version custom chapters (add/rename/reorder/delete) shipped in Phase 3 at the *manual* level, not the template level. A future admin surface owns `template:manage`. | `docs/PHASE_2.md` §"PRD-OQ-012"; Phase 3 chapter-management (manual-level) | RESOLVED (v1 scope) / DEFERRED (admin template-CRUD) | Product | Phase 2 (v1-scope decision) | Admin template editor deferred — owner: **Product**; **target review date: 2026-12-31** (planning checkpoint, not a committed delivery date); not a Phase 8 release gate; impact: none on MVP (system template is authoritative; manual-level chapter edits cover author needs). |

**Stale traceability entries corrected in 8B-11** (`docs/REQUIREMENTS_TRACEABILITY.md` §Open
questions): PRD-OQ-001, -003, -004, -005, -008, -009, -011, -012 moved from "Open" to their
resolution (source slice cited). PRD-OQ-002, -006, -007, -010 were already marked resolved.
`docs/PRD.md` §25 table: rows -001, -003, -004, -005, -008, -009, -011, -012 annotated with
**RESOLVED** + the phase decision reference (original open-question text kept as
`~~strikethrough~~`); the "Needed by" column updated to `Decided`. `PRD-SEC-008` traceability row's "Planned (rule TBD, PRD-OQ-009)"
updated to "Field-only in MVP; scanner deferred post-MVP (PRD-OQ-009 resolved)".

**AC-P8-10 status: PASS.** Every PRD-OQ is decided. The three with a deferred *extension*
(OQ-008 multi-locale UI — owner Product; OQ-009 image scanner — owner Platform/Security; OQ-012
admin template editor — owner Product) each carry an owner, an explicit **target review date of
2026-12-31** (planning checkpoint, not a committed delivery date), a reason, and a release-impact
assessment confirming the deferment does **not** violate a Phase 8 MUST release gate. No OQ row is
"Open"; no deferment says "no fixed date" or an undated "post-MVP".

---

### Final AC-P8-1..10 matrix

| AC | Type | Requirement (abbrev.) | Evidence | Freshness | Status | Risk / gap |
|---|---|---|---|---|---|---|
| AC-P8-1 | MUST | GI-1..GI-12 across the app | GI matrix above; `tests/unit/*`, `rls.test.ts`, `e2e-lifecycle-8b10.test.ts`; 8B-11 build/bundle scans | FRESH (GI-3/8/9) + HISTORICAL/RECENT-INHERITED | **PASS** | none |
| AC-P8-2 | MUST | every route: loading / empty / error / retry | route-state matrix above; 8B-6 audit; `(workspace)/loading.tsx` + `error.tsx`; 8B-10 public-route boundary tests | RECENT-INHERITED (8B-6) + FRESH (8B-10 CI) | **PASS** | none |
| AC-P8-3 | MUST | WCAG 2.1 AA (project acceptance) | a11y table above; 8B-5 live audit; `app-shell-drawer.test.tsx` (5); `app/globals.css` | RECENT-INHERITED (8B-5) + DOCUMENTARY | **PASS** | P2: `prefers-reduced-motion` live spot-check (owner: release eng; 8B-12) |
| AC-P8-4 | MUST | responsive 375/768/1024/1440; no doc h-scroll; no nested builder h-scroll | route×viewport matrix above; 8B-5 live audit; `.builder-grid minmax(0,1fr)` | RECENT-INHERITED (8B-5) + FRESH (8B-10 HTML) | **PASS** | P2 cosmetic: public-manual footer ~1-char clip @375; Preview occasionally pre-scrolled |
| AC-P8-5 | MUST | cross-org role/RLS suite, service path disabled | AC-P8-5 table; `rls.test.ts` (152) + `e2e-lifecycle-8b10.test.ts` (20); CI run `34020261218` **172/172** | FRESH (8B-10 CI) + RECENT-INHERITED (8B-7) | **PASS** | none |
| AC-P8-6 | MUST | security review report | security matrix above; 8B-7 §Security closure; 8B-11 bundle + CI-log scans | RECENT-INHERITED (8B-7) + FRESH (8B-11) | **PASS** | none |
| AC-P8-7 | SHOULD | list/dashboard SSR; builder immediate; autosave ≤~1s; param tables contained | perf table above; 8B-8 measurements; `DEFAULT_AUTOSAVE_DEBOUNCE_MS = 800`; 8B-11 SSR/CSS inspection | RECENT-INHERITED (8B-8) + FRESH (8B-11 DOCUMENTARY) | **PASS WITH KNOWN RISK** | PDF cold-start > 180 s (medium, first-request-only, self-healing; owner: release eng; target: first post-Phase-8 maintenance window) |
| AC-P8-8 | MUST | full permission + publishing boundary E2E | AC-P8-8 summary; `e2e-lifecycle-8b10.test.ts` (20/20 in CI `34020261218`) | FRESH (8B-10 CI) + RECENT-INHERITED (8B-10) | **PASS** | none |
| AC-P8-9 | MUST | `tsc` clean, no new suppressions, deps reviewed, reproducible `npm ci` | AC-P8-9 table; 8B-11 suppression scan (0/0/0 + 3 baseline `eslint-disable`); 8B-9 dep audit; 8B-10 CI `npm ci` | FRESH (8B-11) + RECENT-INHERITED (8B-9/8B-10) | **PASS** | none |
| AC-P8-10 | MUST | close every PRD §25 OQ | PRD-OQ decision table above; `docs/PRD.md` §25 + `docs/REQUIREMENTS_TRACEABILITY.md` synced in 8B-11 | FRESH (8B-11 audit + sync) | **PASS** | 3 deferred *extensions* (multi-locale UI, image scanner, admin template editor) — each with owner + explicit target review date 2026-12-31 (planning checkpoint, not a delivery commitment) + reason + impact = not a Phase 8 gate |

**Release-blocker check:** every MUST AC is **PASS**; the one SHOULD is **PASS WITH KNOWN RISK**
with a documented, owned, non-blocking follow-up. **No PARTIAL, BLOCKED, or unsupported MUST.**
→ **Slice 8B-11 CLOSED.** Phase 8 is **not** marked complete — that is 8B-12.

**8B-11 gates:** `git diff --check` clean; `tsc --noEmit` clean; `eslint .` clean; unit
**692/692**; `next build` `✓ Compiled successfully` (`ƒ Proxy (Middleware)`, no deprecation
warning). DEV integration **not rerun** — no test/RLS/RPC/product change in 8B-11 (docs only); the
final green 8B-10 CI **172/172** (run `34020261218`, commit `4fc83e3`) stands as RECENT-INHERITED
evidence. No `package.json`/lockfile change → no fresh `npm ci`.

_Slice 8B-12 (final release / handover) is not yet started. Phase 8 is NOT complete._
