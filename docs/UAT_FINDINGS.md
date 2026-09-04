# UAT findings — Smartin Manual Builder

Real-user UAT of the Developer authoring flow (built a full VMax EA UAT manual by hand).
Priority per the Phase 8A brief §28. Status legend: **FIXED (8A-P0)**, **PLANNED (8A-P1)**,
**PLANNED (8A-P2)**, **OPEN**.

| ID | Sev | Area | Summary | Priority | Status |
|---|---|---|---|---|---|
| UAT-01 | HIGH | editor state | Saved blocks vanish when switching chapters; return after refresh only. | P0 #1 | **FIXED (8A-P0)** |
| UAT-04 | HIGH | editor state | Blank draft blocks persist; refresh reveals empty + populated block. | P0 #2 | **FIXED (8A-P0)** |
| UAT-22 | CRITICAL | output | Structured changelog saved but Preview ch.14 shows an internal "(Phase 3)" placeholder. | P0 #3 | **FIXED (8A-P0)** |
| UAT-21 | HIGH | editor state | Changelog Save persists but the UI stays stuck pending/disabled until refresh. | P0 #4 | **FIXED (8A-P0)** |
| UAT-33 | UX/HIGH — **ACCEPTANCE BLOCKER** | authoring UX | Structured changelog was rendered/edited as a separate authoring surface ABOVE the manual page, making BAB 14 feel like two editors. Must live INLINE inside the BAB 14 canvas: saved entries collapse into a compact content card, Edit expands inline, Add Entry opens inline, one authoritative source, parity across Edit/Preview/Public/PDF, no floating/separate panel. **Corrected before 8A-P0 approval (not deferred to P1).** | P0 | **FIXED (8A-P0)** |
| UAT-05 | HIGH | editor state | Structural Undo/Redo effectively unusable during real authoring. | P0 #5 | **FIXED (8A-P0)** |
| UAT-07 | HIGH | authoring | Step image can only pick an already-uploaded asset; no upload in-step. | P1 #7 | **FIXED (8A-P1)** — per-step `Upload gambar` / `Pilih dari library` + preview + ALT + caption + remove; reuses the existing private image infra; old `imageAssetId` step payloads still render |
| UAT-10 | HIGH | authoring | Parameter Table disabled with no explanation / recovery when EA has no groups. | P1 #6 | **FIXED (8A-P1)** — empty state now shows `Belum ada parameter untuk EA Version ini.` + `+ Tambah parameter` opening an inline manager (no page hop) |
| UAT-11 | MED | authoring | Parameter editor can't edit display/technical name — forces delete + recreate. | P1 #6 | **FIXED (8A-P1)** — inline manager edits display name, technical name, type, default, mutability, safe range, order effect; `updateParameter` already supported it, the UI now exposes it |
| UAT-13 | HIGH | authoring | Parameter form assumes enum/terminology knowledge; needs human-facing labels. | P1 #6 | **FIXED (8A-P1)** — “Nama yang tampil di MT5” / “Nama parameter di kode/input EA” / “Tipe data” (with bool/int/double/string help) / “Nilai default” / “Kapan boleh diubah” (human labels over the internal `before_start` enum) |
| UAT-14 | HIGH | authoring | Parameter Table block shows only group name + count; needs in-context preview + add/manage. | P1 #6 | **FIXED (8A-P1)** — the block now renders a compact preview table (Nama / Technical / Type / Default) for the referenced groups + `+ Tambah / Kelola parameter` inline; edits write EA Version, no manual copy; table + validation refresh, no route refetch |
| UAT-19 | HIGH | authoring | Seeded template text behaves like real content. | P1 #9 | **FIXED (8A-P1)** — real gray placeholders on text/callout (RTE overlay), FAQ question, step title/instruction/menu, image ALT/caption, parameter name fields; placeholders are never persisted, never validation evidence, never in output |
| UAT-20 | HIGH | authoring | One FAQ block = one Q/A; multi-item FAQ authoring needed. | P1 #8 | **FIXED (8A-P1)** — FAQ payload v2 `{items:[{question,answer}]}`; one block, add/edit/delete/reorder items, only the edited item expands; `normalizeBlockPayload` upgrades v1→v2 on parse; renderer + parity + AI + search read both; published snapshots untouched; no migration; PDF renders every Q/A expanded |
| UAT-18 | HIGH | authoring | Empty canonical chapters give no guidance. | P1 #10 | **FIXED (8A-P1)** — `lib/domain/chapter-guidance.ts` (all 18 chapters: purpose, what belongs, what NOT to assume, suggested blocks, example) drives a prominent empty-state panel + a compact `<details>` above an existing block list; UI-only, never persisted / output / scored; also feeds the Template + Panduan pages |
| UAT-27 | HIGH | authoring | Chapter completion control buried. | P1 #11 | **FIXED (8A-P1)** — a compact completion `<select>` sits next to the chapter heading in the editor toolbar; when `Selesai` is blocked the exact reason shows inline (no scrolling the validation panel); the sidebar rows carry a coloured completion border |
| UAT-28 | HIGH | authoring | Completion control looks like an action. | P1 #11 | **FIXED (8A-P1)** — completion is now a labelled state pill/select (`Belum lengkap / Sedang dikerjakan / Selesai / Ada masalah`), visually distinct from the checklist `Tandai tidak berlaku` action |
| UAT-17 | MED | authoring | Canonical-chapter lock icon unclear. | P1 #11 | **FIXED (8A-P1)** — the lock now has `title` + descriptive `aria-label`: “Bab wajib dari template Smartin. Judul bab tidak dapat dihapus atau diubah. Isi bab tetap dapat diedit.” |
| UAT-06 | HIGH | validation | Validation inspector extremely long. | P1 #12 | **FIXED (8A-P1)** — progressive disclosure: default `Perlu diperbaiki` tab shows only actionable items grouped by owner accordions; passing items collapse to `✓ N pemeriksaan lainnya lolos`; `Semua pemeriksaan` is the secondary tab; `Tandai tidak berlaku` is a small secondary link |
| UAT-26 | HIGH | validation | Readiness % misread as chapter completion. | P1 #12 | **FIXED (8A-P1)** — explicit line under the score: “Angka ini adalah kesiapan dokumentasi, bukan persentase bab yang ditandai selesai.” |
| UAT-29 | CRITICAL | product | Workflow too validator-driven. | P1 #12 | **FIXED (8A-P1)** — actionable items are grouped by RESOLUTION OWNER (`Bisa kamu perbaiki` / `Butuh data teknis / source-of-truth` / `Butuh Admin / perusahaan` / `Butuh Compliance`) so the author is not told to invent wording for a fact they cannot supply |
| UAT-12A | — | validation | CHK-VERSI-DUA warned on equal semver. | P1 #14 / FINAL #2 | **FIXED (8A-FINAL)** — the rule now PASSes whenever the EA Version field and the Manual Version field both exist and are valid semver; VALUES MAY BE IDENTICAL. The former "berlaku untuk versi X.Y.Z" Cover-body requirement was removed from this rule (it lives on as chapter guidance, not a gate). WARNING only for non-semver, MISSING only for an absent value |
| UAT-12B | — | validation | Algo-trading rule tied to obsolete smiley wording. | P1 #14 | **FIXED (8A-P1)** — CHK-INSTALL-AUTOTRADING accepts ANY concrete verification signal (status icon, “initialized” log line, active-state label, panel indicator); the smiley is no longer required |
| UAT-12C | — | validation | Missing strategy facts framing. | P1 #14 | **FIXED (8A-P1)** — strategy/setting/param-completeness rules still MISSING/WARNING when facts are absent (not weakened), but they now sit under the `Butuh data teknis / source-of-truth` group instead of implying the author should write more |
| UAT-12D | — | validation | Company/compliance facts classification. | P1 #13 | **FIXED (8A-P1)** — support contact / developer-legal / onboarding-margin route to `Butuh Admin / perusahaan`; disclaimer / claim-language / algorithm-language / disclosure route to `Butuh Compliance`; nothing encourages invention; RBAC unchanged |
| UAT-16 | MED | header | Preview / Kirim Review buttons dominate the header. | P2 #18 | **FIXED (8A-P2)** — `Preview` is now a compact secondary action; `Kirim review` stays primary; when blocked it shows `Belum siap dikirim · N hal perlu dilengkapi` with an expandable blocker list |
| UAT-25 | HIGH | performance | Edit ↔ Preview navigation delay. | P2 #19 | **IMPROVED (8A-P2)** — `<Link prefetch>` on both directions warms the RSC payload; the last-edited chapter is restored from `sessionStorage` on return; no route-wide `router.refresh` in the inline editors. Before/after timings in the report |
| UAT-23 | HIGH | rendering | FAQ output cramped. | P2 #16/17 | **FIXED (8A-P2)** — `.manual-faq` items gap + left rule + heading spacing in the SHARED renderer (Preview = Public = PDF); print keeps every Q/A expanded (`break-inside: avoid`) |
| UAT-24 | HIGH | rendering | Formatting not preserved as readable spacing. | P2 #16 | **FIXED (8A-P2)** — base rich-text rhythm on `.manual-content` (paragraph / list / list-indent / heading / bold / italic / link) applied by the ONE shared renderer, so Preview / Public / Print / PDF match; DOM + text unchanged → AC-P7-4 parity holds |
| §20 | — | responsive | Long pages / scroll audit. | P2 #21 | **AUDITED (8A-P2)** — new panels use collapsed/accordion patterns; validation panel is progressive-disclosure; responsive results at 1440/1024/768/390 in the report |
| §1 | HIGH | validation UX | Inspector still too vertically heavy — every finding rendered expanded. | FINAL #1 | **FIXED (8A-FINAL)** — owner groups are collapsible (only the highest-priority group open by default); each finding is a one-line row until expanded; PASS and NOT_APPLICABLE each collapse behind their own toggle; `[Lihat semua]` / `[Tutup semua]` drive every disclosure |
| §4 | — | validation UX | CTA copy should name the data owner. | FINAL #4 | **FIXED (8A-FINAL)** — per-owner CTA line inside an expanded finding: author "Bisa kamu perbaiki langsung di bab terkait."; source-of-truth "Perlu data teknis EA yang dikonfirmasi developer / source-of-truth."; organisation "Data organisasi belum tersedia / perlu dikonfirmasi Admin."; compliance "Perlu verifikasi / data kepatuhan oleh tim Compliance." No new permissions |
| §3D | — | validation | CHK-KONTAK message implied the author should fill support data. | FINAL #3 | **FIXED (8A-FINAL)** — the "no support channel" branch now reads "Data dukungan pada EA Version belum tersedia atau belum lengkap … Perlu dikonfirmasi Admin/perusahaan — bukan diisi oleh penulis manual." Rule state unchanged |
| UAT-34 | HIGH | editor state | Legacy persisted empty Text blocks still render as `TEKS — Tersimpan` in BAB 17; the UAT-04 fix only stops NEW blank drafts. | FINAL #5 | **FIXED (8A-FINAL)** — `isBlockContentEmpty()` (blank Text/Callout, zero/all-blank FAQ, empty/all-blank Steps; never image / parameterTable / unrecognised). `SectionEditor` filters these from an editable DRAFT on load and `softDeleteBlock`s each once; the cleaned set propagates to the builder so A→B→A and reload stay clean. No empty card painted. No migration |
| UAT-35 | HIGH | validation / review | "Sudah ada di manual" human-evidence fallback for eligible checks (author submits chapter + block ref + note → MENUNGGU VERIFIKASI REVIEWER → reviewer Terima/Kembalikan; never auto-PASS; deterministic + human state stay separate). | FINAL #6/7 | **IMPLEMENTED (8A-UAT35, Migration 29 — approved with revisions).** New `checklist_evidence_submissions` table + `submit_checklist_evidence` / `decide_checklist_evidence` SECURITY DEFINER RPCs + STALE triggers + `public.publish_warning_blockers`. STRICT allowlist (`CHK-INSTALL-AUTOTRADING`, `CHK-PACKAGE-FILES`), WARNING-only, content-bound fingerprint, server-derived review type, immutable historical rows, audited. `checklist_results.state` is never rewritten; MISSING can never be cleared. Score + publish gate treat an eligible current ACCEPTED WARNING as resolved, shown as two separate lines. Unit 570 / integration 148 green |

## 8A-P0 resolutions (detail)

### UAT-01 — stale chapter content → **FIXED**
`SectionEditor` now reports committed block state up via `onSectionBlocksCommitted`; the builder
folds it into `sections` state so a per-chapter remount rebuilds from current data. No page
refresh, no extra fetches. Regression test: `tests/unit/manual-builder-state.test.tsx`.

### UAT-04 — blank persisted blocks → **FIXED**
`addBlock` no longer eagerly persists `text`/`callout`/`faq`/`steps` and no longer seeds
placeholder strings; only `parameterTable` (meaningful EA-Version group reference) and, later,
`image` (after asset choice) persist. A never-saved block persists only once
`isPersistableDraft(payload)` is true. Untouched drafts are discarded on unmount — no ghost rows.
Tests: `tests/unit/blocks-draft.test.ts`, extended `section-editor-undo.test.tsx`.

### UAT-22 — changelog missing / internal placeholder → **FIXED**
The one shared `ManualRenderer` now renders `vm.changelog` for the changelog chapter (Preview =
Public = PDF). The empty-chapter placeholder text is the neutral `EMPTY_CHAPTER_PLACEHOLDER`; no
`Phase N` / `template Smartin` string survives on any output path. AC-P7-4 parity preserved via a
symmetric `changelog` manifest kind in `output-parity.ts` + `parity-html.ts`. Tests:
`tests/unit/changelog-render.test.tsx`, existing `output-parity.test.tsx`.

### UAT-21 — stuck changelog editor after save → **FIXED (root cause corrected on Preview review)**
First correction (busy boolean instead of `useTransition`) was **insufficient** — hands-on Preview
review still showed the editor stuck. **Real root cause:** `ChangelogEditor` called
`router.refresh()` after every mutation, which refetches the entire `force-dynamic`
`/manuals/[id]/edit` route (~9 Supabase round-trips + full Phase-5 evaluation) and re-reconciles it
into the live client tree — regenerating a hydration-divergent subtree (the `ValidationPanel`
"Terakhir dievaluasi" locale/timezone timestamp → React #418 ×3), jumping the scroll, so the
editor *looked* stuck even though the save had persisted.
**Fix:** `ChangelogEditor` no longer calls `router.refresh()` at all — it self-reconciles locally
(create adopts the real id + server position so a 2nd Save updates and never duplicates; delete
removes the row; reorder re-sequences), shows a transient "✓ Tersimpan", and re-enables all
controls the instant the action resolves. Validation still re-evaluates via `props.onChanged` →
`ValidationPanel`'s own targeted action (not a route refetch); Preview re-reads on navigation.
The `ValidationPanel` timestamp is wrapped in `<time suppressHydrationWarning>` so the pre-existing
#418 is gone. Tests: `tests/unit/changelog-editor-save.test.tsx` (asserts `router.refresh` is
NEVER called; self-reconcile; no duplicate on double-save; delete removes locally).

### UAT-05 — Undo/Redo → **FIXED (light touch)**
Coalesced client-side history push ~400 ms after typing stops (deduped), so undo works without
waiting for autosave; UAT-01/UAT-04 fixes remove the state-loss that broke structural undo;
Undo/Redo controls state that history is session-scoped. No persistent version-control added.
Tests: extended `tests/unit/section-editor-undo.test.tsx`.

## Phase 8A.5 follow-up — Supabase environment isolation + persistence/navigation hardening

Real-user Production UAT (2026-09-04) surfaced a second, deeper instance of the UAT-01 class of
bug, plus a correction to the UAT-25 fix below. Full technical detail in `docs/PHASE_8.md`
("Phase 8A.5") and `docs/ENVIRONMENTS.md`. This entry preserves history — UAT-25's original 8A-P2
status line above is left as written; this is a correction, not a rewrite.

### UAT-25 — correction: the 8A-P2 fix (`<Link prefetch>`) is SUPERSEDED
The 8A-P2 fix reduced apparent Edit ↔ Preview latency but reintroduced a correctness bug: the
prefetched `/preview` RSC payload could be served stale — edits made after the prefetch fired were
not reflected in Preview until a hard browser refresh, and users sometimes had to click Preview
more than once. **Superseded (8A.5):** Preview is no longer a prefetched `<Link>`. It is a save
barrier transition (`features/manuals/preview-nav.ts::openPreviewTransition`): a synchronous
re-entrancy guard → `await flushPending()` (every pending block edit persisted) → fire-and-forget
route revalidation → `router.push`. `/preview` stays `force-dynamic` and is never prefetched, so
navigation always renders current data. Single click; the button shows "Membuka preview…" and
stays disabled for the whole transition; a failed flush blocks navigation with a visible message
instead of showing stale content. **Status: FIXED (8A.5)**, replacing "IMPROVED (8A-P2)" above.

### 8A.5-01 — Manual Builder block create/update race → duplicate DB row (found live on Production)
**Status: FIXED (8A.5), Migration 32.** Discovered on a hand-authored Production manual, not a
fixture. Typing through a new block's `createBlock` round-trip could leave a duplicate
`manual_blocks` row (the client tracked only the second, orphaning the first); fast chapter
navigation could drop a pending debounced save (UAT-01's class of bug, recurring at a lower
layer); Preview could show stale or duplicated content. Root cause: the create→update decision
read a React-deferred ref, so a coalesced autosave immediately after a successful `createBlock`
re-ran the CREATE path before the new id was reconciled. Fixed at both layers: `keyToId`
(synchronous ref, not render timing) decides create vs. update; `client_token` (migration 32,
partial unique index on live rows) makes the database itself reject a duplicate create for the
same logical block; `flushAll()` is a bounded, awaitable save barrier that chapter/Preview
navigation cannot bypass. Verified clean on Production post-fix: one live row per non-null
`client_token`, 0 new NULL-token duplicates, 0 exact-payload duplicate groups. The one
pre-existing duplicate (created before the fix) is a soft-deleted, non-live row, left untouched.

### Block spacing — style polish, not a defect
Two adjacent chapter blocks (e.g. Text → Text) rendered with no visible gap. Fixed with one
layout-level spacing token instead of per-block-type margins, consistent across Editor, Preview,
Public Manual, and PDF. No content mutation. **Status: DONE (8A.5).**

## Phase 8B-4 — chapter delete safety (new finding, not a regression)

| ID | Sev | Area | Summary | Status |
|---|---|---|---|---|
| 8B-01 | MEDIUM | authoring UX | Deleting a custom chapter had neither a confirmation step nor an undo affordance, unlike block delete (which stashes the removed block and offers a "Pulihkan" restore control). | **FIXED (8B-4)** — the delete trigger now opens an inline confirmation naming the chapter title; Cancel is the default-focused/safe action; Escape cancels; only an explicit confirm click deletes. No change to reorder/rename/add or block-level behaviour. |
