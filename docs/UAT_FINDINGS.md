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
| UAT-07 | HIGH | authoring | Step image can only pick an already-uploaded asset; no upload in-step. | P1 #7 | PLANNED (8A-P1) |
| UAT-10 | HIGH | authoring | Parameter Table disabled with no explanation / recovery when EA has no groups. | P1 #6 | PLANNED (8A-P1) |
| UAT-11 | MED | authoring | Parameter editor can't edit display/technical name — forces delete + recreate. | P1 #6 | PLANNED (8A-P1) |
| UAT-13 | HIGH | authoring | Parameter form assumes enum/terminology knowledge; needs human-facing labels. | P1 #6 | PLANNED (8A-P1) |
| UAT-14 | HIGH | authoring | Parameter Table block shows only group name + count; needs in-context preview + add/manage. | P1 #6 | PLANNED (8A-P1) |
| UAT-19 | HIGH | authoring | Seeded template text ("Pertanyaan baru", "Langkah 1", …) behaves like real content. | P1 #9 | PARTIAL — faq/steps seeds removed in 8A-P0 (UAT-04); full placeholder pass in 8A-P1 |
| UAT-20 | HIGH | authoring | One FAQ block = one Q/A; multi-item FAQ authoring needed (schema-versioned, back-compat). | P1 #8 | PLANNED (8A-P1) |
| UAT-18 | HIGH | authoring | Empty canonical chapters give no guidance on what to enter. | P1 #10 | PLANNED (8A-P1) |
| UAT-27 | HIGH | authoring | Chapter completion control buried below the validation panel; undiscoverable. | P1 #11 | PLANNED (8A-P1) |
| UAT-28 | HIGH | authoring | Completion "circle" looks like an action, not a state indicator. | P1 #11 | PLANNED (8A-P1) |
| UAT-17 | MED | authoring | Canonical-chapter lock icon unclear; needs accessible tooltip. | P1 #11 | PLANNED (8A-P1) |
| UAT-06 | HIGH | validation | Validation inspector is extremely long. | P1 #12 | PLANNED (8A-P1) |
| UAT-26 | HIGH | validation | Readiness % misread as chapter completion. | P1 #12 | PLANNED (8A-P1) |
| UAT-29 | CRITICAL | product | Workflow too validator-driven — user writes for the regex engine. | P1 #12 | PLANNED (8A-P1) |
| UAT-12A | — | validation | "Versi EA & versi manual ditampilkan terpisah" warns when both semvers are equal. | P1 #14 | PLANNED (8A-P1) — audit rule semantics |
| UAT-12B | — | validation | Algo-trading rule may depend on obsolete UI wording (green/red smiley). | P1 #14 | PLANNED (8A-P1) |
| UAT-12C | — | validation | Missing strategy facts must not falsely PASS; present as "needs source-of-truth". | P1 #14 | PLANNED (8A-P1) |
| UAT-12D | — | validation | Company/compliance facts must not be author-invented; classify + route. | P1 #13 | PLANNED (8A-P1) |
| UAT-16 | MED | header | Preview / Kirim Review buttons dominate the header. | P2 #18 | PLANNED (8A-P2) |
| UAT-25 | HIGH | performance | Noticeable Edit ↔ Preview navigation delay. | P2 #19 | PLANNED (8A-P2) |
| UAT-23 | HIGH | rendering | FAQ output visually cramped. | P2 #16/17 | PLANNED (8A-P2) |
| UAT-24 | HIGH | rendering | Editor formatting not preserved as readable spacing in Preview. | P2 #16 | PLANNED (8A-P2) |
| §20 | — | responsive | Long pages / scroll; audit 1440/1024/768/390. | P2 #21 | PLANNED (8A-P2) |

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
