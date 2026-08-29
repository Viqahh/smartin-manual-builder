# Phase 3 serialization spike — result

> **Status: PASS.** All six block types round-trip
> `DB structured payload → editor representation (+ TipTap JSON where applicable) →
> serialization → DB structured payload → renderer`
> with no field loss, no ID/reference change, no stored HTML, no unsafe HTML, and no
> structured facts flattened into rich text.
>
> Executable proof: `tests/unit/serialization-spike.test.ts` — **13 passed / 0 failed**
> (includes a real headless `@tiptap/core` `Editor` round-trip). Satisfies **AC-P3-2**; the
> security cases satisfy **AC-P3-3**.

Baseline: `docs/IMPLEMENTATION_PLAN.md` Phase 3, `docs/ACCEPTANCE_CRITERIA.md` AC-P3-2/AC-P3-3,
`docs/DATA_MODEL.md` "JSON boundaries", `docs/PHASE_2.md` (`lib/domain/blocks.ts` block model).

---

## 1. Decision

**TipTap is used only for the rich-text portions of text-like content. Every other block is a
structured React form. The persisted payload stays typed structured JSON — never HTML.**

| Block type | Editor surface | Persisted shape |
|---|---|---|
| `text` | **TipTap** rich-text editor for `payload.content` | `{ type:"text", schemaVersion:1, content: RichText }` |
| `callout` | **React** segmented control for `tone` + **TipTap** for `payload.content` | `{ type:"callout", schemaVersion:1, tone:"warning"\|"info"\|"tip", content: RichText }` |
| `faq` | **React** `<input>` for `question` + **TipTap** for `payload.answer` | `{ type:"faq", schemaVersion:1, question:string, answer: RichText }` |
| `steps` | **React** ordered step builder (no TipTap) | `{ type:"steps", schemaVersion:1, steps: [{ title, instruction, menuPath?, imageAssetId? }] }` |
| `image` | **React** asset picker/upload + caption/alt fields (no TipTap) | `{ type:"image", schemaVersion:1, imageAssetId: uuid, caption?: string }` |
| `parameterTable` | **React** multi-select of the linked EA Version's `parameter_groups` (no TipTap) | `{ type:"parameterTable", schemaVersion:1, groupIds: uuid[] }` |

`RichText` is a **restricted ProseMirror / TipTap `doc` JSON** (`schemaVersion: 2`), or the
Phase 2 `plain-paragraphs` shape (`schemaVersion: 1`, still accepted, upgraded on read).
Defined and validated in **`lib/domain/rich-text.ts`**; wired into the block model in
**`lib/domain/blocks.ts`** (`richTextDocument = richTextSchema`).

### Why this architecture

1. **The instruction is explicit:** "Do NOT force every structured block into rich-text HTML."
   `steps`, `image`, `parameterTable` carry *facts* (ordered instructions, an asset id, group id
   references). Rendering them as rich text would lose the structure needed for the shared
   renderer, PDF (Phase 7), and completeness checks (alt-text gate, danger-mode warning).
2. **Raw HTML must never be a storage format** (PRD-SEC-010, AC-P3-3). `editor.getJSON()`
   already produces the exact JSON tree we want to persist; `editor.getHTML()` is never called
   and never stored. The renderer walks the JSON and emits React elements — it never builds an
   HTML string and never calls `dangerouslySetInnerHTML`.
3. **The allowlist lives in one place.** `lib/domain/rich-text.ts` is the single Zod schema that
   both the write boundary (`parseBlockPayload`) and the renderer (`RichTextView`) trust.
   `lib/editor/tiptap-config.ts` configures TipTap to *emit only what that schema accepts*, so
   the editor and the validator cannot drift.
4. **Back-compat, no migration.** `richTextSchema` is a discriminated union on `schemaVersion`;
   every Phase 2 payload (`schemaVersion: 1`, `format: "plain-paragraphs"`) still validates and
   still renders. New content is written as `schemaVersion: 2`. No data migration is required.

---

## 2. Proposed TipTap schema / extensions

Configured in `lib/editor/tiptap-config.ts` (`buildEditorExtensions()`), asserted in
`tests/unit/tiptap-allowlist.test.ts` (Stage 2).

| Extension | Config | Maps to rich-text node/mark |
|---|---|---|
| `StarterKit` | `heading.levels = [2, 3]`; `blockquote/code/codeBlock/horizontalRule/strike: false`; `link: false` | `doc`, `paragraph`, `text`, `heading` (H2/H3), `bulletList`, `orderedList`, `listItem`, `hardBreak`, `bold`, `italic`, local `history` (undo/redo), `dropcursor`, `gapcursor` |
| `@tiptap/extension-link` | `openOnClick: false`, `autolink: false`, `protocols: ["http","https","mailto"]`, `isAllowedUri: SAFE_LINK_PROTOCOL`, forced `rel="noopener noreferrer nofollow" target="_blank"` | `link` mark |

**Explicitly disabled** (`DISABLED_STARTERKIT_FEATURES`): `blockquote`, `code`, `codeBlock`,
`horizontalRule`, `strike`, `underline`. No colour, font-family, font-size, text-align, image
node, table node, iframe, mention, or HTML node is registered — they cannot be produced.

**Toolbar** (`EDITOR_TOOLBAR_ACTIONS`, the entire surface): `bold`, `italic`, `heading2`,
`heading3`, `bulletList`, `orderedList`, `link`, `undo`, `redo`. No "clear formatting from
pasted HTML", no source view, no arbitrary-HTML affordance.

### Node / mark allowlist (`lib/domain/rich-text.ts`)

```
nodes:  doc · paragraph · heading{level ∈ 2|3} · bulletList · orderedList · listItem
        · text · hardBreak
marks:  bold · italic · link{href matches ^(https?:|mailto:)}
```

`link` marks are normalised on validation: `href` is trimmed and protocol-checked; `target` and
`rel` are forced to safe values; any other attribute a paste carried is dropped.

---

## 3. Which block types use TipTap vs structured React

**TipTap (rich text only):** `text.content`, `callout.content`, `faq.answer`.
Each is a `RichText` value. The editor loads `upgradeRichText(content)` (a v2 `doc`) as
`content`, and `editor.getJSON()` is wrapped back into `{ schemaVersion: 2, format: "doc", doc }`.

**Structured React components (no TipTap):**

- **`steps`** — an ordered list of `{ title, instruction, menuPath?, imageAssetId? }`. Title and
  instruction are plain `<input>` / `<textarea>`; menu path is a plain `<input>`; the image
  reference is an asset picker. Order is the array order (AC-P3-7).
- **`image`** — an `image_assets` id plus an optional caption. Alt text lives on the
  `image_assets` row (edited via `updateImageAsset`), not in the block payload (AC-P3-9).
- **`parameterTable`** — `groupIds: uuid[]` selected from the linked EA Version's
  `parameter_groups`. The block stores **only id references**; parameter names/defaults/columns
  are read live from `ea_parameters` at render time so edits propagate to every manual version
  (GI-11, AC-P3-8).
- **`callout.tone`** and **`faq.question`** — a typed enum segmented control and a plain
  `<input>` respectively (structured), even though those blocks also embed a TipTap body.

---

## 4. Serialization examples

### 4.1 `text` — DB payload → editor → serialize → DB payload

**Stored payload (v2):**
```json
{
  "type": "text",
  "schemaVersion": 1,
  "content": {
    "schemaVersion": 2,
    "format": "doc",
    "doc": {
      "type": "doc",
      "content": [
        { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Ikhtisar" }] },
        { "type": "paragraph", "content": [
          { "type": "text", "text": "EA ini " },
          { "type": "text", "text": "wajib", "marks": [{ "type": "bold" }] },
          { "type": "text", "text": " diuji. " },
          { "type": "text", "text": "Panduan", "marks": [
            { "type": "link", "attrs": { "href": "https://smartin.example/guide", "target": "_blank", "rel": "noopener noreferrer nofollow" } }
          ] }
        ] }
      ]
    }
  }
}
```

**Editor representation:** `upgradeRichText(content)` → the `doc` node above, loaded verbatim
into TipTap as `content`.

**Serialization:** `editor.getJSON()` → the same `doc` tree (TipTap normalises nothing that
matters — proven: `richTextToPlainText`, the node-type set, heading level, and link href are all
identical after a real headless `Editor` round-trip). Re-wrapped as
`{ schemaVersion: 2, format: "doc", doc }` and written back to `content`.

**Renderer:** `<RichTextView value={content} />` walks the tree →
`<h2>Ikhtisar</h2><p>EA ini <strong>wajib</strong> diuji. <a href="…" target="_blank" rel="noopener noreferrer nofollow">Panduan</a></p>`.
React elements only — no HTML string, no `dangerouslySetInnerHTML`.

### 4.2 `steps` — order and references are lossless

```json
{ "type": "steps", "schemaVersion": 1, "steps": [
  { "title": "Buka MetaEditor", "instruction": "Tekan F4.", "menuPath": "Terminal > MetaEditor" },
  { "title": "Kompilasi", "instruction": "Tekan F7.", "imageAssetId": "d0000000-0000-4000-8000-0000000000f0" }
] }
```
Editor state is the `steps` array itself; serialization is identity. The test asserts
`out === payload` (deep equal), the `title` sequence is unchanged, and `steps[1].imageAssetId`
is the same UUID.

### 4.3 `parameterTable` — id references only, no fact flattening

```json
{ "type": "parameterTable", "schemaVersion": 1, "groupIds": [
  "d0000000-0000-4000-8000-00000000000a", "d0000000-0000-4000-8000-00000000000b"
] }
```
Round-trips deep-equal. The test asserts the serialized JSON contains **no** `default` /
`technical` / `displayName` — parameter facts are never copied into the block; they are joined
from `ea_parameters` at render time.

### 4.4 `v1 → v2` upgrade (back-compat)

```
{ schemaVersion: 1, format: "plain-paragraphs", paragraphs: ["baris satu", "", "baris dua"] }
  → upgradeRichText →
{ type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "baris satu" }] },
    { type: "paragraph" },
    { type: "paragraph", content: [{ type: "text", text: "baris dua" }] }
] }
```
`richTextToPlainText` is preserved (`"baris satu\n\nbaris dua"`). Existing stored payloads are
never rewritten; they are upgraded in memory on read.

---

## 5. Security treatment (AC-P3-3)

| Vector | Treatment | Evidence |
|---|---|---|
| `<script>alert(1)</script>` as text | It is a `text` node's `.text` **string**. `RichTextView` renders it as a React text child → React escapes it (`&lt;script&gt;`). No `<script>` element is produced; nothing executes. | spike test: "script inside a text node stays inert text" |
| Unknown node in the doc (`iframeEmbed`, `marquee`, …) | `richTextSchema` has a closed node allowlist → `parseBlockPayload` **rejects the write**. Paste path: `sanitizeRichTextDoc` **drops** the node before validation. | spike tests: "unknown node type … REJECTED", "sanitiser drops arbitrary nodes" |
| Unknown mark (`strike`, custom) | Closed mark allowlist → rejected on write / stripped on paste (bold kept, strike dropped). | spike test: "sanitiser … drops arbitrary … marks" |
| `javascript:` / `data:` link | `href` must match `^(https?:|mailto:)` → rejected on write; `sanitizeRichTextDoc` drops the link mark but keeps the link text. `@tiptap/extension-link` `isAllowedUri` blocks it in the editor too. | spike test: "`javascript:` link is rejected … and stripped" |
| Out-of-range heading (`level: 6`) | Schema accepts only `2|3` → rejected on write; sanitiser coerces to `2`. | spike test: "coerces out-of-range headings" |
| Unknown **block** type (`embed`, `script`) | `blockPayloadSchema` is a discriminated union on `type` → `parseBlockPayload` returns `{ ok: false }` → action returns `VALIDATION`. | spike test: "unknown BLOCK type is refused" |
| Uncontrolled HTML paste into the editor | `sanitizeRichTextDoc` runs on paste (Stage 2 `handlePaste`), then the write boundary re-validates. TipTap has no HTML-source affordance. | Stage 2 paste test |
| Rendered output | `RichTextView` and `manual-renderer.tsx` never use `dangerouslySetInnerHTML`; `grep` for it across the repo returns nothing. | Stage 2 security test |

`image` blocks keep the Phase 2 private-bucket + signed-URL path (`data-source.ts` signs a
30-minute URL per referenced `image_assets` row); no public URL is ever stored in a payload.

---

## 6. Files added / changed by the spike

| File | Change |
|---|---|
| `lib/domain/rich-text.ts` | **new** — v1/v2 `RichText` model, allowlist Zod schema, `upgradeRichText`, `richTextFromParagraphs`, `richTextToPlainText`, `isRichTextEmpty`, `sanitizeRichTextDoc` |
| `lib/editor/tiptap-config.ts` | **new** — `buildEditorExtensions()`, `DISABLED_STARTERKIT_FEATURES`, `EDITOR_TOOLBAR_ACTIONS` (pure config, no React) |
| `components/manual-renderer/rich-text-view.tsx` | **new** — `RichTextView` semantic React renderer (no `dangerouslySetInnerHTML`), `richTextIsEmptyDoc` |
| `lib/domain/blocks.ts` | `richTextDocument` now = `richTextSchema` (v1 back-compat + v2); `emptyTextBlock()` seeds a v2 doc |
| `components/manual-renderer/manual-renderer.tsx` | `text` / `callout` / `faq` render via `<RichTextView>` instead of `paragraphsOf` |
| `tests/unit/serialization-spike.test.ts` | **new** — 13 tests: TipTap round-trip, six-type payload round-trip, six security cases |
| `package.json` | **+deps** `@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link` (all `^3.30.5`) |

**Gate on the spike branch:** `npm run lint` ✅ · `npm run typecheck` ✅ ·
`npm run test` ✅ (70 passed / 27 skipped — Phase 2 unit + integration guards intact) ·
`npm run build` ✅.

---

## 7. What this unblocks (Stage 2+)

The rich-text model, allowlist, TipTap config, and renderer are settled. Stage 2 builds on them:
the client `<RichTextEditor>` (toolbar + `useEditor(buildEditorExtensions())` + paste
sanitiser), the six block editors, chapter management, block reorder, duplicate, undo, image
upload UI, the parameter builder, and their tests. No part of Stage 2 changes the persisted
format decided here.

---

## 8. Phase 4+ boundary (unchanged)

No AI, no compliance/checklist engine, no review workflow, no reviewer comments, no
approval/publishing, no public route, no PDF export, no version cloning, no snapshots.
