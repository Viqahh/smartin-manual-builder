# Phase 3 completion report — Document editor

> **Status: complete and live-verified against Supabase DEV.** The structured Manual Document
> Editor is built on the Phase 2 data model with no schema replacement. TipTap powers rich text
> only; `steps` / `image` / `callout` tone / `parameterTable` / `faq` question are structured
> React. Persistence stays typed structured JSON — raw HTML is never stored and the renderer
> never uses `dangerouslySetInnerHTML`.
>
> `npm run lint` ✅ · `npm run typecheck` ✅ · `npm run test` ✅ **136 passed / 36 skipped**
> (the 36 skips are `tests/integration/rls.test.ts`, credential-gated in the plain run) ·
> `npm run build` ✅.
>
> **Live Supabase DEV integration: `npx vitest run tests/integration` → 36 passed / 0 failed /
> 0 skipped.** Run repeatedly; DEV row counts return to the seed steady state each time
> (cleanup now asserts on failure — see §14/§15). The 9 Phase 3 additions run alongside the
> 27 unchanged Phase 2 RLS/RPC/security cases; no Phase 2 behaviour was modified.
>
> **Migrations applied to DEV** (`supabase migration list --linked`):
> `20260901000800_phase3_section_management` · `20260901000900_phase3_section_delete_integrity`.
>
> Serialization spike (mandatory, §0): **PASS** — `docs/PHASE_3_SERIALIZATION_SPIKE.md` +
> `tests/unit/serialization-spike.test.ts`.
>
> Autosave/conflict correction (§9b), atomic custom-chapter delete + cascade-aware
> required-section protection (§8b) and the full browser regression (§13/§15) were completed
> and re-verified after the initial implementation.

Baseline: `docs/IMPLEMENTATION_PLAN.md` Phase 3, `docs/ACCEPTANCE_CRITERIA.md` AC-P3-1…14,
`docs/PRD.md`, `docs/UI_SPEC.md`, `docs/CONTENT_REQUIREMENTS.md`, `docs/DATA_MODEL.md`,
`docs/ARCHITECTURE.md`, `docs/PHASE_2.md`.

---

## 1. Scope implemented

| Area | Delivered |
|---|---|
| **Serialization spike** | `docs/PHASE_3_SERIALIZATION_SPIKE.md`; `lib/domain/rich-text.ts` (v1/v2 allowlisted `RichText`), `lib/editor/tiptap-config.ts`, `components/manual-renderer/rich-text-view.tsx`. |
| **Rich text (TipTap)** | `features/manuals/editor/rich-text-editor.tsx` — restrained toolbar (bold, italic, H2/H3, bullet/ordered list, link, undo/redo). Persists `editor.getJSON()` (v2 `doc`), re-sanitised on every update. Paste normalised by `transformPastedHTML` + the extension allowlist. |
| **Six block editors** | `features/manuals/editor/block-editors.tsx` — `text`, `callout` (tone segmented control + rich body), `faq` (question input + rich answer), `steps` (ordered builder), `image` (asset picker + upload + caption/alt), `parameterTable` (group multi-select from the linked EA Version). |
| **Block operations** | add / inline edit / **single-flight autosave** (§9b) / duplicate / move (pointer + keyboard) / soft-delete / restore / per-block validation + error + retry. All writes go through the Phase 2 typed server actions + `blockPayloadSchema`. `duplicateBlock`, `getBlockState`, `getBlockRowVersions` server actions added; `createBlock` now returns the DB `row_version`. |
| **Autosave / conflict** | `lib/editor/autosave-queue.ts` — one in-flight request per entity, coalesced pending state, authoritative `row_version` adopted from every success, canonical-payload compare (jsonb-round-trip-safe), self-race → silent adopt+retry, genuine external edit → non-destructive conflict panel ("Perubahan lain terdeteksi. Tulisan Anda tetap aman." / "Gunakan perubahan saya" / "Muat versi terbaru"). `RichTextEditor` now syncs an externally-changed `value` into TipTap (undo/redo, "Muat versi terbaru"). Server `row_version` optimistic concurrency is unchanged. |
| **Chapter management** | `features/manuals/editor/chapter-nav.tsx` + `features/sections/actions.ts` — reorder (pointer + keyboard), add custom chapter, rename custom chapter, **atomic** delete + position re-pack. Canonical chapters have no add/rename/delete control and are refused at the DB. Migrations `20260901000800` (transactional `reorder_manual_sections` RPC + `guard_section_title_immutable`) and `20260901000900` (cascade-aware `guard_required_section_delete` + atomic `delete_custom_manual_section` RPC). |
| **Undo / redo** | `lib/editor/history.ts` snapshot stack for structural block ops (add / remove / reorder / committed payload edit); every revert routes through the **same single-flight autosave queue** (immediate flush) so undo/redo cannot race an in-flight save. TipTap owns keystroke undo inside a rich-text body. |
| **Image flow** | Editor upload → `uploadManualImage` → `image_assets` (private bucket) → `signImageUrl` → block references `imageAssetId`. `updateImageAsset` for caption/alt. Renderer signs a 30-minute URL per referenced asset. |
| **Completion gates** | `lib/domain/section-completion.ts` — empty ALT blocks "Selesai" (AC-P3-9); risk chapter of a danger-mode EA needs a warning callout (AC-P3-11). Enforced in the inspector **and** server-side in `saveSection`. |
| **Supported configuration** | Phase 2 editor unchanged. Chapter 2 / Chapter 9 render the explicit `ea_version_setups` rows via the shared renderer — no inference, "Tested Minimum Lot" wording + broker disclaimer retained. |
| **Inspector** | Two tabs kept (Validasi / Metadata) — `PRD-OQ-002` decision recorded (§10). Completion blockers listed inline. AI remains a disabled Phase-4 placeholder. |
| **Preview** | Unchanged shared renderer; now also renders v2 rich text, custom chapters, and every block type. PDF export stays disabled (Phase 7). |

---

## 2. Editor architecture

Three-panel builder (`features/manuals/manual-builder.tsx`) kept from Phase 2:

```
LEFT  <ChapterNav>      chapter nav + reorder + custom-chapter CRUD (desktop column / mobile drawer)
CENTER <SectionEditor>  block list + add-block menu + undo/redo + per-block editor & controls
RIGHT <Inspector>       Validasi (completion + blockers) / Metadata (desktop column / mobile sheet)
```

- Desktop ≥ 1280px: `.builder-grid` = `250px minmax(0,1fr) 300px`. Below that the grid is a single
  column and the chapter/inspector panels become drawers (Phase 2 `@media (max-width:1279px)` rules,
  unchanged).
- No `localStorage` as a document source. The editor operates against `manual_sections`,
  `manual_blocks`, `image_assets`, and the linked EA Version's `parameter_groups` / `ea_parameters`
  (loaded server-side in `app/(workspace)/manuals/[manualId]/edit/page.tsx`).
- One `ManualViewModel` + one shared renderer (`components/manual-renderer/*`) still feed both the
  editor's read-only mode and the preview.

---

## 3. TipTap schema / extensions

`lib/editor/tiptap-config.ts` → `buildEditorExtensions()`:

| Extension | Config |
|---|---|
| `@tiptap/starter-kit` v3 | `heading.levels = [2, 3]`; **disabled:** `blockquote`, `code`, `codeBlock`, `horizontalRule`, `strike`, `underline`, `link`. Kept: paragraph, text, bold, italic, bulletList, orderedList, listItem, hardBreak, `history` (undo/redo), dropcursor, gapcursor. |
| `@tiptap/extension-link` | `openOnClick:false`, `autolink:false`, `protocols:["http","https","mailto"]`, `isAllowedUri: SAFE_LINK_PROTOCOL`, forced `rel="noopener noreferrer nofollow" target="_blank"`. |

`editorProps.transformPastedHTML` additionally strips `<script>/<style>/<iframe>/<object>/<embed>/<link>/<meta>` and inline `on*=` handlers before TipTap parses. `onUpdate` runs `sanitizeRichTextDoc(editor.getJSON())` so the persisted payload is always allowlist-clean even if an extension is later loosened.

Toolbar surface (`EDITOR_TOOLBAR_ACTIONS`, the whole set): `bold`, `italic`, `heading2`, `heading3`, `bulletList`, `orderedList`, `link`, `undo`, `redo`. No colour, font, alignment, source view, or arbitrary-HTML affordance. `callout` and `faq` bodies use `minimalToolbar` (no headings).

---

## 4. Structured block model

`lib/domain/blocks.ts` — `blockPayloadSchema` (discriminated union on `type`), unchanged shapes,
now with `richTextDocument = richTextSchema` (v1 `plain-paragraphs` back-compat + v2 `doc`).

| Block | Payload | Editor |
|---|---|---|
| `text` | `{ content: RichText }` | TipTap |
| `callout` | `{ tone: "warning"\|"info"\|"tip", content: RichText }` | segmented + TipTap |
| `faq` | `{ question: string, answer: RichText }` | `<input>` + TipTap |
| `steps` | `{ steps: [{ title, instruction, menuPath?, imageAssetId? }] }` | React ordered builder |
| `image` | `{ imageAssetId: uuid, caption? }` | React picker/upload |
| `parameterTable` | `{ groupIds: uuid[] }` | React multi-select |

`draftBlockPayload(type)` seeds a new block. `text`/`callout` drafts are immediately valid;
`steps`/`faq`/`image`/`parameterTable` drafts are intentionally incomplete and are not persisted
by `createBlock` until they pass `parseBlockPayload` (the add menu pre-fills `steps` with a
placeholder step, `faq` with a placeholder question, and `parameterTable` with the first available
group so those persist on add; `image` persists only once an asset is chosen).

Unknown / malformed block types are refused by `parseBlockPayload` → the server action returns
`VALIDATION`. Covered by `tests/unit/block-ops.test.ts`.

---

## 5. Image flow

1. **Add block → Gambar** inserts a draft image block (unsaved).
2. **Unggah baru** → `uploadManualImage(FormData)` — validates MIME/size/header (Phase 2 rules),
   inserts the `image_assets` row with the FINAL storage key, uploads to the private
   `manual-images` bucket, rolls the row back on upload failure.
3. `signImageUrl(id)` returns a fresh 30-minute signed URL; the builder adds the asset to its
   picker list.
4. The block payload stores **only `imageAssetId`** — never a URL. The renderer
   (`data-source.ts`) signs a URL per referenced asset at load time.
5. **ALT text** and **caption** are edited on the asset via `updateImageAsset` (author-only,
   `image:upload`). ALT lives on `image_assets`, so every block referencing the asset stays
   consistent. An empty ALT blocks "Selesai" for the chapter, with a visible reason
   (inspector + inline `small.field-error`).

`<figure>` / `<figcaption>` semantics in the renderer; `max-width: 100%` on images.
The Phase 7 public image-publishing path is **not** implemented.

---

## 6. Parameter ownership behaviour (AC-P3-8 / GI-11)

- The parameter **builder** is the Phase 2 `ParameterManager` on `/ea-products/[productId]`,
  gated on `ea_parameter:manage` (DEVELOPER / ADMIN). A reviewer sees a read-only facts view.
  Phase 3 does not add a second parameter editor.
- A `parameterTable` **block** stores `groupIds` selected from the **linked EA Version's**
  `parameter_groups` only (the editor lists exactly those). `app.guard_parameter_table_ownership`
  rejects a group from another EA Version or organisation at the DB layer.
- Editing an `ea_parameter` updates the single shared row — every `parameterTable` in every
  manual version linked to that EA Version reflects the change immediately. No per-manual copy.
  **Proven live on DEV** (`tests/integration/rls.test.ts` "parameter definition edits propagate
  to every referencing Manual Version"): two Manual Versions on one EA Version each hold a
  `parameterTable` referencing the same group → editing `ea_parameters` once → both render the new
  `display_name` + `default_value`, the block payloads and their `row_version`s are untouched, and
  exactly one parameter row exists. A **foreign** / cross-org group id is refused for a
  `parameterTable` block and not stored (`app.guard_parameter_table_ownership`).

---

## 7. Supported-configuration behaviour (AC-P3-10)

- **Not rebuilt.** `ea_version_setups` and the Phase 2 `SupportedConfigurationEditor` are unchanged;
  Phase 3 does not add an entry path.
- Chapter 2 (`requirements`) and Chapter 9 (`presets`) render the explicit stored rows via
  `SupportedConfigTable` in the shared renderer — one `<tr>` per stored row.
- **No inference.** `tests/unit/rich-text-render.test.ts` asserts that with rows
  `XAUUSD/M15` and `EURUSD/H1` stored, the render contains those two pairs and **not**
  `XAUUSD/H1` or `EURUSD/M15`. "data uji developer" wording and the broker-minimum-lot
  disclaimer are retained.

---

## 8. Chapter / block reorder design

- **One operation** for both input paths: `lib/editor/reorder.ts` `arrayMove` (pointer drop and
  keyboard ▲/▼ both call it). Unit-tested (`tests/unit/editor-reorder.test.ts`).
- **Pointer:** native HTML5 drag (`draggable` grip button, `onDragStart/Over/Drop`), same pattern
  as the Phase 2 setup editor.
- **Keyboard:** ▲/▼ buttons with `aria-label`; **focus is moved to the moved item's control**
  after the reorder (`requestAnimationFrame` → `[data-block-move]` / `[data-chapter-move]`).
- **Server:** blocks → `public.reorder_manual_blocks`; chapters → `public.reorder_manual_sections`
  (new). Both are `SECURITY DEFINER`, `assert_author` + `assert_reorder_list` gated, two-phase
  (`position += 1000000` then `0..n-1`), so the final order is contiguous and unique. Client sends
  the full id list only when every item is persisted.

---

## 8b. Atomic custom-chapter delete + cascade-aware required-section protection

Migration `20260901000900_phase3_section_delete_integrity.sql` (applied to DEV):

**A. `app.guard_required_section_delete` is now cascade-aware.** The `BEFORE DELETE` trigger from
`20260901000400` rejected *every* delete of a `required AND NOT is_custom` section — including the
delete an FK `ON DELETE CASCADE` issues when an authorised parent `manual_version` / `manual` is
removed. That made parent deletion impossible once template sections were instantiated. The
corrected guard uses `pg_trigger_depth()` (verified on PG 17): a **direct** `DELETE FROM
manual_sections` fires it at depth `1` → a required canonical section is still **rejected**; an
**FK cascade** fires it at depth `≥ 2` → the row is allowed through so the parent delete
completes. Authorisation / org-isolation / reviewer read-only / published-version immutability on
the *parent* delete are unchanged (RLS + `guard_published_manual_version`).

**B. `public.delete_custom_manual_section(p_section_id uuid)` — one transaction.** The
`deleteCustomSection` server action now makes a single RPC call (was: `DELETE` + a separate
`reorder_manual_sections` RPC). The function: `app.assert_author` gate → verify the section exists
and its manual-version scope → refuse `required OR NOT is_custom` (`check_violation`) → delete →
two-phase re-pack of the survivors to contiguous `0..n-1` in the existing order (same technique as
`reorder_manual_sections`, behind the `deferrable initially deferred unique(manual_version_id,
position)`) → `RETURN QUERY` the survivors' `id, position, row_version`. Positions are unique at
every point; no transient window. Grants mirror the RPC lockdown (revoke `public`/`anon`, grant
`authenticated` + `service_role`). The client keeps its optimistic gap-close and reconciles from
the RPC result.

---

## 9. Undo / redo design (AC-P3-12)

Two layers, deliberately separate:

| Layer | Owns | Mechanism |
|---|---|---|
| **TipTap history** | keystroke-level editing *inside* a `text` / `callout` / `faq` rich body | `StarterKit` `history` extension; the editor toolbar's ↶/↷ and Ctrl+Z/Ctrl+Y |
| **Application command history** (`lib/editor/history.ts`) | structural ops on the block list: **add**, **remove/restore**, **reorder**, and each **committed** block-payload edit | immutable full-list snapshots pushed before each structural op; bounded (50) |

**Undo does not diverge from the database.** `SectionEditor.applySnapshot(prev)` diffs the target
snapshot against the live list and issues the *minimal* set of the same typed server actions —
`restoreBlock` for a re-added block (its returned `row_version` is adopted immediately),
`softDeleteBlock` for an un-added block, a **queued** payload revert for a content revert (routed
through the single-flight autosave queue with an immediate flush, so it can never race an
in-flight autosave), `reorderBlocks` for an order revert — then sets local state to the snapshot
and re-syncs `row_version`s from the server. Every path is a validated server mutation; there is
no direct write. `tests/unit/editor-history.test.ts` covers push/undo/redo, redo-branch clearing,
and the size limit; `tests/unit/section-editor-undo.test.tsx` drives the real `<SectionEditor>`
against an in-memory fake of the server actions (add→undo→redo, delete→undo→redo,
reorder→undo→redo, new-edit-after-undo clears redo, **payload-edit undo→redo round-trips the
DB**).

---

## 9b. Autosave / conflict handling (single-flight)

`lib/editor/autosave-queue.ts` — `createAutosaveQueue<P>()`, one instance per editor surface,
keyed per entity (block key, section id). Server-side `row_version` optimistic concurrency
(`UPDATE … WHERE row_version = $expected` → 0 rows = `CONFLICT`) is **unchanged**; this fixes the
client so ordinary one-session editing never produces a false `Konflik perubahan`.

- **Single-flight + coalescing.** At most one save request in flight per entity. While one is
  pending, further edits only update `pending` (the latest desired payload) — they never issue a
  second request with the same `expectedRowVersion`. On success the queue adopts the
  server-returned `row_version` and, if `pending` still differs, immediately re-sends it with the
  new version, converging until `local == persisted`.
- **Authoritative version.** `row_version` for a write comes only from the queue (a plain object,
  not React state / a closure); every success and every structural resync updates it.
- **Structural resync.** After add / duplicate / delete / restore / reorder (blocks) or reorder /
  rename / delete (chapters) the affected `row_version`s are re-read (`getBlockRowVersions` /
  `getSectionRowVersions`, or adopted from the mutation response) before the next autosave.
- **Self-race vs genuine conflict.** On `CONFLICT` the client fetches the current server payload
  (`getBlockState`). If it matches content this client already knows (the payload it loaded, or
  any payload in its undo history) — compared with `stableStringify` (recursively sorted keys, so
  a Postgres `jsonb` round trip still compares equal) — it is a self-generated stale-version race:
  adopt the server version, retry the pending state silently, don't disturb the user. Otherwise a
  visible panel: **"Perubahan lain terdeteksi. Tulisan Anda tetap aman."** with **"Gunakan
  perubahan saya"** (save the retained draft against the current server version) and **"Muat
  versi terbaru"** (replace local content with the server version). Neither version is written
  without an explicit choice; the local editor content stays mounted through a failed save,
  network error, or conflict. No `router.refresh()` in the conflict path.
- **`RichTextEditor` external-value sync.** TipTap is now updated (`setContent`, `emitUpdate:
  false`, guarded by a `lastEmitted` ref + canonical compare) when the `value` prop changes
  externally — so app-level undo/redo of a rich-text edit and "Muat versi terbaru" visibly load
  the new content without fighting the caret during ordinary typing.

Save-state UX: `Belum disimpan` → `Menyimpan…` → `Tersimpan` for normal typing; `Gagal menyimpan
— Coba lagi` on a transient error; `Konflik perubahan` + the panel only on a genuine concurrent
edit. `tests/unit/autosave-queue.test.ts` covers rapid same-session saves, 3-edit coalescing,
version adoption, undo-during-in-flight, transient-error retry, canonical-compare drift, genuine
external conflict + both resolutions.

---

## 10. Decisions

### @dnd-kit (AC-P3-13) — **NOT added.**
Native HTML5 drag + `aria-label`ed ▲/▼ buttons with post-move focus management satisfy the
required reorder UX and accessibility (drag **and** keyboard, focus retained, contiguous order).
The Phase 2 Supported Configuration editor already ships this exact pattern. Adding a drag-drop
dependency was not justified. Recorded here per the dependency policy.

### PRD-OQ-002 — inspector tabs — **decision: keep 2 tabs (Validasi, Metadata).**
`ROUTES_AND_COMPONENTS.md` envisaged 3 (completion / validation / metadata). Phase 1 folded
completion into "Validasi" and Phase 3 keeps that: the completion score, the per-chapter status
control, and the completion blockers all live in "Validasi". A separate "Validasi" tab distinct
from "Kelengkapan" only becomes meaningful when the Phase 5 compliance/checklist engine produces
real validation findings; splitting now would create an empty tab. Revisit at Phase 5.
`docs/PRD.md` PRD-OQ-002 and `docs/REQUIREMENTS_TRACEABILITY.md` to be marked *Resolved (2 tabs)*.

---

## 11. Permission behaviour by role

Server authorisation is unchanged and remains the boundary. Every Phase 3 mutation calls
`assertCan(roles, action)`:

| Action | Required | DEVELOPER | ADMIN | TECHNICAL_REVIEWER | COMPLIANCE_REVIEWER | `developer@` (DEV + TECH_REVIEWER) |
|---|---|---|---|---|---|---|
| block add/edit/duplicate/delete/reorder | `manual:update` | ✅ | ✅ | ❌ | ❌ | ✅ |
| chapter add/rename/delete/reorder | `manual:update` | ✅ | ✅ | ❌ | ❌ | ✅ |
| image upload / caption / alt | `image:upload` | ✅ | ✅ | ❌ | ❌ | ✅ |
| parameter definitions (builder) | `ea_parameter:manage` | ✅ | ✅ | ❌ | ❌ | ✅ |

The editor renders **no** author controls for reviewer-only roles: `SectionEditor` returns a
read-only render (one banner, the shared renderer output — not a wall of disabled inputs);
`ChapterNav` hides drag handles, ▲/▼, add/rename/delete; the inspector shows a read-only status
line. `manual-builder.tsx` computes `canEdit = canAny(roles, "manual:update")` from the workspace
context. `tests/unit/permissions.test.ts` (Phase 2) + the schema-parity assertions cover the
action map; live reviewer read-only was browser-verified in Phase 2 §0d and re-checked below.

---

## 12. Security decisions

| Requirement | Implementation |
|---|---|
| Structured JSON persistence, no arbitrary HTML | `richTextSchema` (closed node/mark allowlist) at every write boundary; `editor.getJSON()` only; `getHTML()` never called/stored |
| No unsafe `dangerouslySetInnerHTML` | grep-verified zero uses; `RichTextView` emits React elements (text children are auto-escaped) |
| Sanitise/normalise paste | `transformPastedHTML` + extension allowlist + `sanitizeRichTextDoc` on `onUpdate` |
| Reject unknown block types | `parseBlockPayload` discriminated union → `VALIDATION` |
| Reject cross-EA parameter group references | editor lists only the linked EA Version's groups; `app.guard_parameter_table_ownership` at the DB |
| Org isolation | all queries `.eq("organization_id", orgId)` + RLS; composite FKs (Phase 2) |
| Private/signed images | unchanged Phase 2 path; payloads store ids, not URLs |
| Server authorization | `assertCan` in every action; `reorder_manual_sections` **and** `delete_custom_manual_section` are `SECURITY DEFINER` + `app.assert_author`-gated, `EXECUTE` revoked from `public`/`anon` (granted only `authenticated` + `service_role`) |
| Required-section protection is cascade-safe | `guard_required_section_delete` rejects a **direct** delete of a required canonical section but lets an **authorised parent** `manual_version` / `manual` delete cascade through (`pg_trigger_depth()`); parent-delete authz is still RLS + `guard_published_manual_version` |
| Secret key server-only | unchanged |

Malicious-payload tests: `tests/unit/serialization-spike.test.ts` (`<script>`, unknown node,
`javascript:` link, unknown block type) + `tests/unit/tiptap-allowlist.test.ts` (paste of
`<script>/<style>/<iframe>/<img>/<blockquote>/<pre>` + inline styles + `on*=` handlers + `<s>`
mark + `<h1>` — none survive as executable/allowed markup).

---

## 13. Responsive evidence

Editor CSS added under `/* Phase 3 — Document editor */` in `app/globals.css`; the Phase 2
builder grid + drawer breakpoints are reused unchanged.

**Browser check — dev server backed by Supabase DEV, signed in as `developer@smartin.demo`,
manual builder open:**

| Width | `document.scrollWidth > clientWidth` | Notes |
|---|---|---|
| 375 | **false** | single column; "Bab" / "Inspector" drawer toggles; Undo/Redo/Tambah-blok action bar wraps |
| 768 | **false** | single column (chapter/inspector are drawers) |
| 1024 | **false** | single column |
| 1440 | **false** | 3-column grid `250px 642px 300px` |

Rich-text surface and every block editor use flex/grid with `min-width:0`; `.block-list` and
`.steps-editor-fields` collapse to one column at ≤767px; images `max-width:100%`;
`.manual-table-wrap` keeps parameter tables in a contained horizontal scroll;
`.editor-actionbar` and the add-block menu wrap; inputs bump to 16px on mobile to stop iOS zoom.

---

## 14. Test evidence

`npm run test` → **136 passed / 36 skipped** (unit; the 36 skips are the credential-gated
`tests/integration/rls.test.ts`).
`npx vitest run tests/integration` (with `SUPABASE_TEST_*` set to DEV) → **36 passed / 0 failed /
0 skipped**.

New / extended files:

| File | Covers |
|---|---|
| `tests/unit/serialization-spike.test.ts` | 6-type round-trip via real TipTap; script/HTML/js-url/unknown-type security (AC-P3-2/3) |
| `tests/unit/tiptap-allowlist.test.ts` | extension allowlist; paste normalisation of hostile HTML (AC-P3-3/4) |
| `tests/unit/editor-reorder.test.ts` | `arrayMove` / keyboard step parity / permutation / contiguity (AC-P3-5) |
| `tests/unit/editor-history.test.ts` | undo/redo, redo-branch clearing, size limit, reconcile helper (AC-P3-12) |
| `tests/unit/section-editor-undo.test.tsx` | real `<SectionEditor>` over a fake server: add/delete/reorder undo→redo, new-edit clears redo, payload-edit undo→redo round-trips the DB, reorder-then-edit no self-conflict, genuine external conflict panel + both resolutions (AC-P3-12) |
| `tests/unit/autosave-queue.test.ts` | single-flight, coalescing, version adoption, undo-during-in-flight, transient-error retry, canonical jsonb-safe compare, genuine external conflict + "Gunakan perubahan saya" / "Muat versi terbaru" (§9b) |
| `tests/unit/block-ops.test.ts` | drafts, duplicate (no def/binary copy), unknown-type refusal, ≥5 steps round-trip (AC-P3-4/7/13) |
| `tests/unit/section-completion.test.ts` | empty-ALT gate; danger-mode warning gate (AC-P3-9/11) |
| `tests/unit/rich-text-render.test.ts` | semantic render; supported-config explicit-rows-only (AC-P3-3/10) |
| `tests/unit/schema-parity.test.ts` (extended) | `reorder_manual_sections` RPC + rename/delete guards; `duplicateBlock`; no `dangerouslySetInnerHTML` |
| `tests/setup.ts` (extended) | `globalThis.WebSocket` polyfill from `undici` so `@supabase/supabase-js` `createClient()` runs on Node < 22 (integration suite is HTTP-only; no realtime socket) |
| `tests/integration/rls.test.ts` (extended, live vs DEV) | AC-P3-5 atomic `delete_custom_manual_section` (A–G: mid-list delete → contiguous, order preserved, persists, 3 add/delete cycles no gaps, RPC refuses canonical); AC-P2-14 cascade-aware guard (A: direct required-section delete rejected · B: direct custom-section delete allowed · C: `DELETE manual_version` cascades required children · D+E: `DELETE manual` cascades, no orphans · F: unauthorised parent delete still rejected); AC-P3-8 propagation across **two** self-contained manual versions on one EA Version (edit `ea_parameters` once → both render the new value, no block-payload rewrite, one shared row); parameterTable **foreign** EA-Version group rejected + not stored. **Every cleanup step now asserts `expect(del.error).toBeNull()`.** |

---

## 14b. Acceptance criteria — AC-P3-1 … AC-P3-14

Legend: ✅ met, evidence cited (unit + live integration and/or browser) · 🟨 implemented +
tested, one sub-path lacks direct end-to-end evidence.

| AC | Status | Evidence |
|---|---|---|
| AC-P3-1 (GI-1..7, GI-10, GI-11, GI-12 hold) | 🟨 | GI-10 no inferred configs — `rich-text-render.test.ts` (explicit rows only) + live integration; GI-11 EA-Version-owned groups — `guard_parameter_table_ownership` + live "foreign group rejected" + "propagation across two manual versions"; GI-12 structured/allowlisted persistence — `serialization-spike` + `tiptap-allowlist`. GI-1..7 are unchanged Phase 2 primitives (Phase 2 gate). A fresh full-repo GI scan was not re-run for Phase 3. |
| AC-P3-2 (serialization spike recorded; 6 types round-trip via TipTap JSON; no loss/unsafe HTML) | ✅ | `docs/PHASE_3_SERIALIZATION_SPIKE.md` + `tests/unit/serialization-spike.test.ts` |
| AC-P3-3 (structured JSON; raw `<script>`/HTML neither stored nor rendered) | ✅ | `serialization-spike.test.ts`, `tiptap-allowlist.test.ts`, `rich-text-render.test.ts`; grep: **zero** `dangerouslySetInnerHTML`; `updateBlock` re-validates `blockPayloadSchema` server-side; browser: no console errors during editing |
| AC-P3-4 (add / edit inline / move / duplicate / delete each block type; unknown type refused) | ✅ | `block-ops.test.ts` (drafts, duplicate makes no definition/binary copy, unknown-type → `VALIDATION`, ≥5 steps round-trip). **Browser (developer, DEV):** `text`, `steps`, `callout`, `faq`, `image`, `parameterTable` each added + edited + autosaved + reloaded; `image` selected + caption + ALT + **native file-picker upload verified by the user**; block move via ▲/▼; **duplicate → immediately edit the duplicate**; **delete → restore → keep editing** — all persisted, no false conflict |
| AC-P3-5 (chapter + block reorder by drag **and** keyboard; focus stays on the moved item; final order contiguous + unique) | 🟨 | Keyboard ▲/▼: **browser** — chapters and blocks reordered repeatedly, order + contiguity confirmed on reload; post-move focus moves to the moved control (`requestAnimationFrame` → `[data-block-move]` / `[data-chapter-move]`). Contiguity/uniqueness: `editor-reorder.test.ts` + live integration AC-P3-5 A–G (+ 3 add/delete cycles, zero gaps) + browser 20-sample poll during a full add→move→delete cycle (**no sample non-contiguous**). Pointer HTML5 drag is implemented and shares the one `arrayMove` operation + the same server RPC, but was **not driven by browser automation**. |
| AC-P3-6 (custom chapter added after the canonical set; required chapters cannot be removed) | ✅ | **Browser:** add custom chapter → rename → reorder into the middle → delete → numbering recompacts immediately → refresh persists. Required: **no** add/rename/delete control renders for canonical chapters; DB refuses a direct delete (`23514 "Bab wajib tidak dapat dihapus"`) and `delete_custom_manual_section` refuses a canonical `p_section_id`. Live integration: AC-P2-14 case A + AC-P3-5 case G |
| AC-P3-7 (installation step builder — title / instruction / optional menu path / optional image; ≥ 5 steps render Ch.4) | ✅ | `block-ops.test.ts` (≥5 steps round-trip + order); browser: 5 steps entered, persisted, rendered in the Chapter 4 preview |
| AC-P3-8 (parameter builder edits the **EA Version's** groups; a `parameterTable` block references linked-EA-Version group ids; editing a parameter updates **every** table in **every** manual version referencing that group — no copy drift; editing requires `ea_version:update`) | ✅ | **Live integration "propagation across two manual versions":** two Manual Versions on one EA Version each hold a `parameterTable` referencing the same group → edit `ea_parameters` once → **both** render the new `display_name` + `default_value`; block payloads and `row_version`s unchanged; exactly **one** parameter row. Foreign / cross-org group id → rejected and not stored (`guard_parameter_table_ownership`). Editor lists only the linked EA Version's groups. Builder is the Phase 2 `ParameterManager`, gated `ea_parameter:manage` (DEVELOPER/ADMIN) |
| AC-P3-9 (`image` block ↔ `image_assets` id; chapter cannot be "complete" while ALT is empty) | ✅ | `section-completion.test.ts`; `saveSection` refuses `completionState:"complete"` while a blocker holds (server) + inspector shows the reason + "Selesai" disabled. **Browser:** empty ALT → "Selesai" disabled + "ALT kosong…"; ALT set → "Selesai" enabled → completion saved + persisted. Block payload stores `imageAssetId` only |
| AC-P3-10 (Ch.2 / Ch.9 render explicit config rows, no inference; Phase 2 entry path unchanged) | ✅ | `rich-text-render.test.ts` (stored `XAUUSD/M15` + `EURUSD/H1` present; `XAUUSD/H1` + `EURUSD/M15` absent; "data uji developer" + broker-minimum-lot disclaimer retained); Phase 2 `SupportedConfigurationEditor` / `ea_version_setups` untouched |
| AC-P3-11 (risk chapter top `warning` callout; danger-mode manual without it is detectably incomplete) | ✅ (SHOULD) | `section-completion.test.ts` (danger-mode risk-chapter warning gate) + `saveSection` server enforcement |
| AC-P3-12 (undo restores the previous state for text, block add / remove, and reorder) | ✅ | `editor-history.test.ts` (push/undo/redo, redo-branch clear, size cap) + `section-editor-undo.test.tsx` (real `<SectionEditor>`: add→undo→redo, delete→undo→redo, reorder→undo→redo, new edit clears redo, **payload edit undo→redo round-trips the DB**). **Browser:** undo/redo of a chapter delete and a block add (block reappears/disappears, no false conflict); payload-edit undo→redo on a steps block round-trips (`rv 8→9→10`, title reverts then restores) |
| AC-P3-13 (`@dnd-kit` only if native controls cannot meet the UX; decision recorded) | ✅ | §10 — native HTML5 drag + `aria-label`ed ▲/▼ + post-move focus; `@dnd-kit` **not** added |
| AC-P3-14 (`PRD-OQ-002` inspector-tabs decision recorded) | ✅ (SHOULD) | §10; `docs/PRD.md` PRD-OQ-002 and `docs/REQUIREMENTS_TRACEABILITY.md` marked **Resolved (Phase 3): keep 2 tabs (Validasi, Metadata)** |

### Corrections verified after the first implementation pass

| Area | Result |
|---|---|
| Single-flight autosave (§9b) | One-browser continuous typing / rapid multi-edit / add-then-edit / reorder-then-edit / duplicate-then-edit / delete-restore / undo-during-in-flight → **no false `Konflik perubahan`**, converges to `Tersimpan`, no lost text, persists on reload. `autosave-queue.test.ts` + `section-editor-undo.test.tsx` + browser. |
| Genuine two-session conflict (§9b) | Two tabs, same block: A saves → B (stale) edits → conflict panel, B's text retained, DB keeps A's version (no silent overwrite). "Muat versi terbaru" loads A's latest into B's editor; "Gunakan perubahan saya" saves B's draft against the current version. Browser + `autosave-queue.test.ts`. |
| Atomic custom-chapter delete + re-pack (§8b) | `delete_custom_manual_section` RPC — deployed to DEV, live integration AC-P3-5 A–G, browser (immediate contiguous numbering, 20-sample poll zero gaps, persists on reload). |
| Cascade-aware required-section guard (§8b) | `guard_required_section_delete` `pg_trigger_depth()` — deployed to DEV, live integration AC-P2-14 A–F (direct required delete rejected; direct custom delete allowed; `DELETE manual_version` / `DELETE manual` cascade cleanly with no orphans; unauthorised parent delete still rejected). |
| DEV test-fixture hygiene | 27 leaked 0-block `create_manual_with_version` manuals + 1 orphan `ea_version` + 2 browser-scaffolding manuals removed via a tightly-scoped predicate. Retained: the seed manual + the user-created "viqah" manual (11 authored blocks). All 12 integration cleanup sites now assert on delete failure; DEV row counts are stable across repeated runs (§15). |

## 15. Verification status — what is proven, what remains

### Migrations — applied to Supabase DEV

`supabase migration list --linked` shows both Phase 3 migrations present remotely:
`20260901000800_phase3_section_management` and `20260901000900_phase3_section_delete_integrity`.
`reorder_manual_sections`, `reorder_manual_blocks`, `guard_section_title_immutable`,
`guard_required_section_delete` (cascade-aware) and `delete_custom_manual_section` are live and
`EXECUTE`-locked (revoked from `public`/`anon`; granted to `authenticated` + `service_role`).
Chapter reorder + delete now **persist** across a reload (browser-confirmed).

### Live integration — DEV

`npx vitest run tests/integration` → **36 passed / 0 failed / 0 skipped**. Run 6× this session;
the last 3 (after the fixture cleanup + making AC-P3-8 self-contained) each left the DEV row
counts byte-identical: `manuals=2, manual_versions=2, manual_sections=36, manual_blocks=11,
ea_products=2, ea_versions=2, parameter_groups=1, ea_parameters=4`, `FixedLot = "Fixed Lot" /
"0.01"`. `manuals=2` = the seed manual + the user-created "viqah" manual (retained — 11 authored
blocks, not a test fixture). Every cleanup step asserts `expect(del.error).toBeNull()`, so a
future silent leak fails the test.

### Browser — `developer@smartin.demo` / `reviewer@smartin.demo` / `compliance@smartin.demo` on DEV

- **Editor**: 3-panel render; add-block menu with per-chapter suggestions; all six block editors
  (`text` / `steps` / `callout` / `faq` / `image` / `parameterTable`) add + edit + autosave +
  reload; block move via ▲/▼; duplicate → edit the duplicate; delete → restore → keep editing.
- **Autosave / conflict** (§9b): one-session continuous typing → `Tersimpan`, no false conflict,
  persists; genuine two-tab conflict → panel, no lost text, no silent overwrite, both
  resolutions work.
- **Undo / redo** (AC-P3-12): chapter delete, block add, steps-title payload edit — undo reverts,
  redo reapplies, no false conflict, DB round-trips.
- **Chapters**: add custom → rename → reorder into the middle → delete → numbering recompacts
  immediately (20-sample poll, no gap) → refresh persists; canonical chapters have no
  delete/rename control.
- **Image**: select existing asset, caption, ALT, empty-ALT completion gate; **the user manually
  verified the native OS file-picker upload flow**.
- **Reviewer / compliance**: `SectionEditor` renders read-only (`data-readonly="true"` + banner);
  **zero** author controls (no Tambah blok / Undo·Redo / Hapus blok / Naikkan bab / Tambah bab
  kustom), no editable rich-text surface.
- **Multi-role developer** (`DEVELOPER` + `TECHNICAL_REVIEWER`): authoring remains available.
- **Responsive** 375 / 768 / 1024 / 1440: `document.scrollWidth === clientWidth` at every width;
  mobile drawers work; 3-column grid at ≥ 1280.
- **Console**: clean during the full flow — no uncaught exceptions, no hydration warnings.

### Still lacking direct end-to-end evidence

- **Pointer (HTML5) drag** reorder for chapters and blocks — implemented, unit-covered at the
  shared `arrayMove` level, exercised via the ▲/▼ keyboard path in the browser, but the drag
  gesture itself was not driven by browser automation. (AC-P3-5 sub-path — marked 🟨.)
- A fresh **full-repo GI-1..GI-7 scan** was not re-run for Phase 3; those are unchanged Phase 2
  primitives covered by the Phase 2 gate. (AC-P3-1 — marked 🟨.)
- Sub-keystroke undo *inside* a rich-text body is TipTap-local by design (§9) and is not mirrored
  into the app history.

---

## 16. Phase gate

`npm run lint` ✅ · `npm run typecheck` ✅ · `npm run test` ✅ **136 passed / 36 skipped**
(unit; the 36 skips = credential-gated integration) · `npm run build` ✅ (compiled successfully).

`npx vitest run tests/integration` (DEV) ✅ **36 passed / 0 failed / 0 skipped**, idempotent.

Migrations `20260901000800` + `20260901000900` applied to DEV and verified. Browser verification
against DEV (§15): developer editing + autosave + conflict + undo/redo + chapter delete/recompact
+ image + preview; reviewer & compliance read-only; responsive 375/768/1024/1440 with no document
horizontal scroll; no console errors.

---

## 17. Phase 4+ boundary (unchanged)

**Not implemented, deliberately:** AI provider / generation, compliance/checklist engine,
technical/compliance review workflow transitions, reviewer comments, approval/publishing, public
manual route, PDF export, version cloning, publishing snapshots. The AI inspector affordance stays
visibly disabled ("Tersedia pada Phase 4"); "Kirim review" stays disabled ("Phase 6").
