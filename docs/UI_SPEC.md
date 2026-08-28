# UI Specification — Smartin Manual Builder

> Derived from the Phase 1 implementation (`app/`, `components/`, `features/`) and `design-system/smartin-manual-builder/MASTER.md`. This spec **documents** the existing UI and names where later phases attach behaviour. It does not introduce UI that conflicts with the design system unless explicitly noted as necessary and flagged.
>
> **Design invariants (from MASTER.md), apply to every page:**
> - Colours: `--color-primary #0F172A`, `--color-accent #22C55E` (single primary action only), `--color-background #F6F8FB`, `--color-card #FFFFFF`, `--color-border #CBD5E1`, `--color-info #2563EB`, `--color-destructive #B42318`, `--color-warning #B54708`, `--color-ring #2563EB`.
> - Type: IBM Plex Sans (UI), JetBrains Mono (`.mono` — versions, technical identifiers).
> - Spacing density 8/10; radius scale 4 / 6 / 8 px; shadows `--shadow-sm/md/lg/xl`.
> - Motion 120–200 ms, opacity/transform only, `prefers-reduced-motion` removes non-essential transitions.
> - Icons: Lucide only, never emoji. Every clickable element has `cursor: pointer`. Focus rings visible and ≥ 4.5:1. Touch targets ≥ 44px.
> - Status is always icon **and** text, never colour alone.
> - No marketing hero sections in the workspace; no large rounded marketing cards; no regulatory-approval language without verified approval data.
> - Responsive test widths: **375 / 768 / 1024 / 1440**.

---

## 0. Global shell — `AppShell` (`components/app-shell/app-shell.tsx`)

Wraps every `(workspace)` route.

| Aspect | Specification |
|---|---|
| **Purpose** | Persistent navigation frame and top bar for the authenticated workspace. |
| **Target user** | All authenticated roles. |
| **Layout (≥1024px)** | Fixed left sidebar (navy, ~248–280px) + `workspace` column: sticky `workspace-header` + scrollable `main#main-content`. Skip link (`Lewati ke konten utama`) is the first focusable element. |
| **Layout (<1024px)** | Sidebar hidden; `mobile-menu-button` in the header opens `mobile-sidebar` in a `drawer-layer` with a scrim. |
| **Sidebar sections** | Brand lockup (`S` mark + "SMARTIN / Manual Builder"); nav groups: **Workspace** (Dashboard, Produk EA), **Dokumentasi** (Manual Book, Template), **Review** (Review Teknis, Review Kepatuhan), **Sumber Daya** (Panduan Dokumentasi, Checklist Kepatuhan); bottom: Pengaturan + user chip (avatar, name, role, chevron). |
| **Active state** | `data-active` when `pathname === href` or `pathname.startsWith(href + "/")`. |
| **Header components** | `mobile-menu-button` (<1024px), `header-search` (visual only in Phase 1: icon + "Cari manual atau produk EA" + `⌘ K` kbd), `environment-pill` ("Demo internal"), `notification-button` (bell + dot; toggles `notification-popover` with `role="status"`). |
| **Actions** | Open/close mobile nav (Escape closes); toggle notifications popover; navigate. |
| **Loading** | Route-level `loading.tsx` (to add, Phase 8) renders a skeleton inside `main`; sidebar/header stay static. |
| **Empty** | N/A (shell always present). |
| **Error** | Route-level `error.tsx` (to add, Phase 8) renders inside `main` with a retry action; shell persists. |
| **Disabled** | Search and notifications are inert-but-explained affordances in Phase 1 (search has no handler; acceptable as a visual placeholder, not a button). Phase 2 wires search; Phase 2 wires real notifications. |
| **Success** | Navigation is the feedback; no toast for route changes. |
| **Responsive** | ≥1024 two-column; <1024 single column + drawer nav; drawer focus-trapped, Escape-dismiss, scrim click closes; nav item tap closes drawer. |
| **Accessibility** | `aria-label="Navigasi utama"` on `<aside>`; nav is `<nav>` with grouped labels; drawer close buttons labelled; `main` has `tabIndex=-1` and is the skip-link target; notification popover announced via `role="status"`. |
| **Data source** | Phase 1: hardcoded nav + user ("Andi Setiawan / Developer"). Phase 2: session + membership + org-scoped role; nav items filtered by permitted actions. |
| **Permissions** | Nav visibility by role in Phase 2 (e.g. Template full management Admin-only; review queues by reviewer role). Phase 1 shows all. |
| **Future phases** | P2 real auth/user/notifications + command palette search; P6 review-count badges on Review items. |

---

## 1. `/dashboard` (`app/(workspace)/dashboard/page.tsx`)

| Aspect | Specification |
|---|---|
| **Purpose** | Developer portal / portfolio home: documentation readiness, review queue summary, recent activity. |
| **Target user** | All members; primarily Developer and Admin. |
| **Layout** | `page-container` → `PageHeader` (eyebrow "EA Developer Tools", h1 "Dashboard dokumentasi", description, primary action **Buat manual** → `/manuals/new`) → `metric-grid` (4 cards) → `attention-banner` → `card` with "Manual terbaru" + `<ManualTable compact />` → `dashboard-bottom-grid` (two `compact-panel` cards). |
| **Sections & components** | `MetricStrip` (`metric-card` × 4: Produk EA, Manual aktif, Menunggu review, Diterbitkan — each icon `data-tone` blue/navy/amber/green + value + change caption). `attention-banner` (AlertCircle + title + copy + link "Tinjau manual"). `ManualTable` compact (top 4 rows, no filter bar). "Aktivitas review" panel (`activity-item` rows: avatar initials, action, target, time). "Kesiapan tim" panel (`readiness-row`: icon, count, label, arrow link). |
| **Fields** | None (read-only). |
| **Buttons / actions** | Primary: **Buat manual**. Secondary: "Lihat semua" → `/manuals`; "Tinjau manual" → builder; "Buka antrean review teknis" → `/reviews/technical`; "Buka daftar manual" → `/manuals`; row "Buka" per manual. |
| **Validation** | N/A. |
| **Loading** | Metric cards → shimmer blocks; table → `TableSkeleton`; panels → skeleton rows. (Phase 8 formalises.) |
| **Empty** | No EA products yet → metrics show `0`, attention-banner replaced by a "Create your first EA manual" prompt, table shows `TableEmptyState` with a **Buat manual** CTA. (Phase 2.) |
| **Error** | Data load failure → inline card error with retry; shell persists. |
| **Disabled** | None in Phase 1. |
| **Success** | Returning from wizard with a created manual: the new row appears at the top of "Manual terbaru" (Phase 1 reads `localStorage`; Phase 2 from server). |
| **Responsive** | `metric-grid` 4-up ≥1024, 2-up 768–1023, 1-up <768. `attention-banner` stacks link below text <768. `dashboard-bottom-grid` 2-col ≥1024 else 1-col. Table → card rows <768 (see §3). |
| **Accessibility** | `metric-grid` has `aria-label="Ringkasan dokumentasi"`; attention-banner `aria-labelledby`; each panel `section-heading` uses real `<h2>`; counts have visible text, not colour only. |
| **Data source** | Phase 1: hardcoded `metrics`, static activity/readiness, `manuals` mock + `localStorage` new manual. Phase 2: org-scoped aggregates (counts by status, completion, review queue), recent `audit_events`, readiness derived from validation. |
| **Permissions** | All members see the dashboard; content is org-scoped. Reviewer-focused variants (queue emphasis) may differ by role in Phase 6. |
| **Future phases** | P2 real metrics/activity; P5 readiness driven by checklist; P6 live review activity from audit log. |

---

## 2. `/ea-products` (`app/(workspace)/ea-products/page.tsx`) and `/ea-products/[productId]` (Phase 2)

### 2.1 `/ea-products`

| Aspect | Specification |
|---|---|
| **Purpose** | List the organisation's EA Products — the source of identity, versions, requirements, and documentation links. |
| **Target user** | Developer, Admin. |
| **Layout** | `page-container` → `PageHeader` (eyebrow "Produk EA", h1 "My EA Products", primary action **Tambah produk**) → `card.product-grid` of product `<article>`s. |
| **Sections & components** | Product card: `product-logo` ("EA"), `status-badge` (Phase 1 always "Aktif" with `data-status="PUBLISHED"` styling — see note), h2 name, platform + `.mono` version, `<dl>` (Manual count, Platform), link "Lihat dokumentasi". |
| **Fields** | None on list; creation form fields in Phase 2 (name, description). |
| **Buttons / actions** | **Tambah produk** (Phase 1 → `/manuals/new`; Phase 2 → product create form/route); "Lihat dokumentasi" → `/manuals` filtered to the product (Phase 2). |
| **Validation** | Phase 2 create: name ≥ 2 chars, slug unique per org (inline error on collision). |
| **Loading** | Grid → 3–6 card skeletons. |
| **Empty** | No products → `TableEmptyState`-style card: "Belum ada produk EA" + **Tambah produk**. |
| **Error** | Card-level error + retry. |
| **Disabled** | Phase 1: no create route yet → **Tambah produk** currently routes to the wizard; acceptable interim. Phase 2 gives it a real target. |
| **Success** | Phase 2: after create, new card appears; toast/inline confirm. |
| **Responsive** | `product-grid` 3-up ≥1024, 2-up 768–1023, 1-up <768. |
| **Accessibility** | `aria-label="Daftar produk EA"`; status badge has icon + text; card link text is descriptive. |
| **Data source** | Phase 1 hardcoded array. Phase 2: `ea_products` (org-scoped) + version/manual counts. |
| **Permissions** | Developer/Admin. `member:manage`-free; `ea_product:create` gates **Tambah produk**. |
| **Note / flag** | Phase 1 reuses `data-status="PUBLISHED"` styling for a generic "Aktif" label. Phase 2 should introduce a distinct product-status token rather than overloading manual-status styling. |

### 2.2 `/ea-products/[productId]` (Phase 2, `PRD-EA-008`)

| Aspect | Specification |
|---|---|
| **Purpose** | Product identity + list of its EA Versions; entry to create a version or a manual. |
| **Target user** | Assigned member, Admin. |
| **Layout** | `PageHeader` (product name, platform, actions **Create EA version**, **Create manual**) → identity `card` (`<dl>`: owner, slug, description, archived state) → `card` "EA Versions" table/list. |
| **Sections** | Identity block; versions list (version `.mono`, platform badge, release date, requirements summary, # manuals, "Open"); archived banner if archived. |
| **Fields (version create)** | semver, platform (MT4/MT5), release date, structured requirements (symbols, timeframes, account type, min lot, testing deposit, broker requirements, VPS Ya/Tidak/Disarankan, DLL Ya/Tidak, WebRequest Ya/Tidak, custom indicator dependencies), supported symbol/timeframe setups (repeatable `{symbol, timeframe, note}`), support (email, phone, WhatsApp, hours), optional "copy parameters from version…". |
| **Validation** | semver regex; version+platform unique per product (inline); ≥ 1 symbol; ≥ 1 timeframe; email/phone format; ≥ 1 setup row. |
| **States** | Loading skeleton; empty versions → "No versions yet" + **Create EA version**; error + retry; disabled **Create manual** with reason if no versions exist; success confirm on create. |
| **Responsive** | Identity `<dl>` 2-col ≥768 else 1-col; versions list → card rows <768. |
| **Accessibility** | Labelled form fields, inline + summary errors (same pattern as the wizard, §4). |
| **Data source** | `ea_products`, `ea_versions`, `ea_parameters` (for copy), setup records. |
| **Permissions** | `ea_version:create`, `manual:create` gate the actions; read requires org membership + assignment. |
| **Future phases** | P3 setup builder UI polish; P6 shows which manual versions target each EA version. |

---

## 3. `/manuals` (`app/(workspace)/manuals/page.tsx`, `features/manuals/manual-table.tsx`)

| Aspect | Specification |
|---|---|
| **Purpose** | Filterable list of all manuals with version, completion, checklist, status, last update. |
| **Target user** | All members. |
| **Layout** | `page-container` → `PageHeader` (eyebrow "Dokumentasi", h1 "Manual Book", primary action **Buat manual**) → `card.manual-list-card` → `ManualTable` (full: `filter-bar` + `responsive-table-wrap` + `manual-table`). |
| **Sections & components** | `FilterBar` = `search-field` (Search icon + text input, placeholder "Cari nama EA…") + status `<select>` ("Semua status" + the 6 `statusLabels`) + `filter-count` ("N manual"). Table columns: **EA** (name + mobile subline `platform · EA version`), **Platform** (`platform-badge`), **Versi EA** (`.mono`), **Versi manual** (`.mono`), **Kelengkapan** (`Completion`: `%` + `progress-track` bar, `aria-label="Kelengkapan N%"`), **Checklist** (`.mono`, e.g. "21 / 26"), **Status** (`StatusBadge`: icon + `statusLabels[status]`, `data-status`), **Diperbarui**, **Aksi** ("Buka" → `/manuals/[id]/edit`). |
| **Fields** | Search query (client filter on `eaName`), status filter. |
| **Buttons / actions** | **Buat manual**; per-row **Buka**; **Reset filter** in the empty state. |
| **Validation** | None (free-text search). |
| **Loading** | `TableSkeleton`: header + ~6 shimmer rows; filter bar visible but disabled. |
| **Empty (no data)** | `TableEmptyState`: "Belum ada manual" + **Buat manual**. |
| **Empty (no match)** | `empty-state`: Search icon, "Manual tidak ditemukan", "Coba ubah kata kunci atau filter status.", **Reset filter** (clears query + status). |
| **Error** | Card-level error + retry. |
| **Disabled** | Filter controls disabled during load. |
| **Success** | New manual from the wizard appears prepended (Phase 1 via `localStorage` `smartin-new-manual`; Phase 2 from server, no client hack). |
| **Responsive** | ≥768: real `<table>` inside `responsive-table-wrap`. <768: each row becomes a stacked card using `td[data-label]` labels; `mobile-subline` shows platform + EA version; **no horizontal page scroll**. `filter-bar` wraps: search full-width, select + count on the next line. |
| **Accessibility** | Search input has `sr-only` label; status select has `sr-only` label; completion cell `aria-label`; status conveyed by icon + text; table has real `<thead>`/`<th>`. |
| **Data source** | Phase 1: `manuals` mock + `localStorage`. Phase 2: `manual_versions` joined to `manuals`/`ea_products`/`ea_versions`, org-scoped, server-side filter + pagination (`Pagination` component). |
| **Permissions** | All members see org manuals; row actions depend on assignment/role (edit vs read). |
| **Future phases** | P2 server filter + pagination + sortable columns; P5 checklist column reflects the engine; P6 status reflects real transitions; row menu (`row actions menu`) for preview/reviews/clone. |

---

## 4. `/manuals/new` (`app/(workspace)/manuals/new/page.tsx`, `features/manuals/create-manual-wizard.tsx`)

| Aspect | Specification |
|---|---|
| **Purpose** | Capture reusable EA facts once and create a Manual + first Manual Version from the active template. |
| **Target user** | Developer, Admin. |
| **Layout** | `wizard-page` → heading (eyebrow "Manual baru", h1 "Buat Manual Book") → `wizard-layout` = `wizard-steps` aside (progress `<ol>` + `autosave-note`) + `wizard-card` form. Mobile: `wizard-mobile-progress` bar replaces the aside. |
| **Steps** | 1 **Pilih produk** (source radio: existing / new; EA product select). 2 **Identitas EA** (`form-grid`: Nama EA, Platform, Versi EA `.mono`, Versi manual `.mono`, Tanggal rilis `type=date`, Developer, Organisasi, Deskripsi produk `textarea`). 3 **Kebutuhan teknis** (Simbol/pair, Timeframe, Tipe akun, Minimum lot, Deposit pengujian, Persyaratan broker `textarea`, Kebutuhan VPS select, Kebutuhan DLL select, Kebutuhan WebRequest select). 4 **Dukungan** (Email, Telepon, WhatsApp, Jam dukungan). 5 **Tinjau** (`review-group` blocks with **Ubah** buttons per group + `demo-disclosure`). |
| **Fields & validation (Zod, `mode: onBlur`)** | `eaName` ≥ 2; `eaVersion`/`manualVersion` match `^\d+\.\d+\.\d+$` ("Gunakan format semver, contoh 1.0.0."); `platform` ∈ {MT4, MT5}; `releaseDate` non-empty; `developer`/`organization` ≥ 2; `description` ≥ 20; `symbols` ≥ 3; `timeframes` ≥ 2; `accountType` ≥ 2; `minimumLot` ≥ 1; `testingDeposit` ≥ 1; `brokerRequirements` ≥ 5; `vpsRequired` ∈ {Ya, Tidak, Disarankan}; `dllRequired`/`webRequestRequired` ∈ {Ya, Tidak}; `email` valid email; `phone`/`whatsapp` ≥ 8; `supportHours` ≥ 5. Errors render beside the field (`field-error`, `role="alert"`, `id="{name}-error"`); each input sets `aria-describedby` when errored. |
| **Buttons / actions** | **Lanjutkan** (validates `stepFields[step]` with `shouldFocus`; on failure focuses `error-summary`); **Kembali**; **Batal** (`window.confirm`, then `/manuals`); final **Buat manual** (submit). |
| **Loading** | Submit shows a pending state on **Buat manual**; Phase 2 disables the form while the server creates records. |
| **Empty** | Step 1 "existing" with no EA products (Phase 2) → the existing option is disabled with "Belum ada produk EA — buat baru"; "new" pre-selected. |
| **Error** | Per-field inline + `error-summary` (`role="alert"`, `tabIndex=-1`, focus target) listing `visibleErrors` as anchor links to `#{name}`. Phase 2: server/creation error banner at the top of the card, non-destructive (form state kept). |
| **Disabled** | **Lanjutkan** never hard-disabled (it validates on click); Phase 2 disables navigation during submit. |
| **Success** | `createManual` writes the record and routes to `/manuals/[id]/edit?created=1`; builder shows a "created" confirmation. Draft key cleared. |
| **Persistence** | `formValues` autosaved to `localStorage` `smartin-manual-wizard` on every change; on mount, a saved draft is restored (`reset`) and a `restored-banner` (`role="status"`) shows "Draf sebelumnya telah dipulihkan." Phase 2: server-side draft. |
| **Responsive** | ≥1024: 2-col `wizard-layout` (steps aside + card). <1024: aside hidden, `wizard-mobile-progress` shows "Langkah X dari 5" + step name + bar. `form-grid` 2-col ≥768 else 1-col. `wizard-footer` stacks buttons <480. |
| **Accessibility** | Every field wrapped in `<label>` (`form-field`) with visible text + required `*` (`<b aria-hidden>`); helper text hidden when errored; `error-summary` focus management; step list `<ol>` conveys `data-active`/`data-complete` with icon + text; date input native. |
| **Data source** | Phase 1: defaults seeded with VMax EA sample values; `localStorage`. Phase 2: EA product/version list for step 1; on submit creates `ea_products`/`ea_versions` (new path) then `manuals` + `manual_versions` + template-instantiated `manual_sections`. |
| **Permissions** | `manual:create` (and `ea_product:create` for the "new" path). |
| **Future phases** | P2 real product picker + server create + real draft; P3 supported-setup rows added here or in the builder (Open question `PRD-OQ-006`). |

---

## 5. `/manuals/[manualId]/edit` — Manual Builder (`features/manuals/manual-builder.tsx`)

The three-panel documentation workspace. **LEFT = chapter navigation, CENTER = document editor, RIGHT = validation / metadata / AI inspector.**

### 5.0 Frame

| Aspect | Specification |
|---|---|
| **Purpose** | Author a Manual Version chapter by chapter against structured EA data. |
| **Target user** | Assigned Developer (edit); Technical/Compliance reviewer (read/comment mode, Phase 6). |
| **Layout (≥1024px)** | `builder-page` → `builder-topbar` → `builder-grid` = **280px** `ChapterPanel` / **minmax(560px, 1fr)** `editor-workspace` / **320px** `Inspector`. The centre column owns primary scroll; **no nested horizontal scroll** in the centre. |
| **Layout (768–1023px, tablet)** | Single content column = editor. `builder-mobile-controls` bar shows **Bab** (opens chapter drawer), current chapter label, **Inspector** (opens inspector sheet). Chapter and inspector are overlay drawers (`panel-drawer-layer` + scrim). |
| **Layout (<768px, mobile)** | Same as tablet; drawers are full-height sheets; topbar actions collapse (see 5.1). |
| **Topbar** | `builder-breadcrumb` ("Manual Book" link → `/manuals`, chevron, **EA name**, `status-badge` `data-status="DRAFT"` "Draf"). `save-state` (`role="status"`, Save icon + "Tersimpan barusan"). `builder-top-actions`: **Preview manual** (secondary → `/manuals/[manualId]/preview`) + **Kirim review** (primary, disabled Phase 1, title "Pengiriman review tersedia pada Phase 6"). |
| **Data source** | Phase 1: `chapters`, `parameters` from `mock-data.ts`; always renders the VMax sample. **Phase 2: must load the `ManualViewModel` for the route `manualId`** — `PRD-MAN-014`, acceptance "Creating Polaris EA must never show VMax metadata." |
| **Permissions** | Edit requires assignment + `manual:update` and status ∈ {DRAFT, CHANGES_REQUESTED}. Otherwise read-only mode with an explanatory banner. |
| **Loading** | Three-column skeleton: chapter list shimmer, editor shimmer blocks, inspector shimmer. |
| **Error** | Full-panel error with retry; topbar breadcrumb stays. |
| **Success** | Autosave "Saved" state; `?created=1` shows a one-time "Manual dibuat" confirmation. |
| **Accessibility** | `editor-workspace` `aria-labelledby="chapter-title"`; drawers focus-trapped, Escape + scrim close; skip within builder to editor; save state announced politely. |

### 5.1 LEFT — `ChapterPanel` / `ChapterTree`

| Aspect | Specification |
|---|---|
| **Purpose** | Navigate chapters; show completion and required state. |
| **Sections** | `panel-heading` (eyebrow "Manual Book", h2 "Daftar bab", overall `%`); `overall-progress` bar; `progress-copy` ("14 dari 18 bab memiliki konten"); `chapter-list` of buttons; **Tambah bab kustom** (secondary, full width). |
| **Chapter button** | `chapter-state` icon by `data-state`: `complete` → Check, `issue` → AlertTriangle, `current` → `current-dot`, `incomplete` → Circle. `chapter-copy`: `BAB NN` + title. `required` chapters show a `LockKeyhole` icon (`aria-label="Bab wajib"`). `data-active` marks the open chapter. |
| **Actions** | Select chapter (updates centre + right; persists selection — Phase 1 `localStorage` `smartin-builder-chapter`; Phase 2 server/URL). **Tambah bab kustom**: disabled Phase 1. |
| **Validation** | Chapter state derives from content presence (Phase 1 static; Phase 5 from the engine). |
| **Empty** | Never empty — the template guarantees the canonical chapter set. |
| **Disabled** | **Tambah bab kustom** disabled with title — **fix in a later phase:** Phase 1 copy says "Phase 2" but custom chapters are Phase 3 per `IMPLEMENTATION_PLAN.md` (documented in `PRD-OQ`/traceability; not a code change now). |
| **Responsive** | Desktop: static 280px column. <1024: drawer with a `panel-close` button; selecting a chapter closes the drawer. |
| **Accessibility** | `<nav aria-label="Navigasi bab">`; each entry a real `<button>`; state conveyed by icon with `aria-label` + visible `BAB NN`/title text; progress has visible text, not just a bar. |
| **Permissions** | Reorder + add custom chapter require `manual:update`; reviewers see the tree read-only. |
| **Future phases** | P3 drag + keyboard reorder, add/remove custom chapters; P5 `issue`/`incomplete` driven by checklist; P6 per-chapter unresolved-comment indicator. |

### 5.2 CENTER — `editor-workspace` / document editor

| Aspect | Specification |
|---|---|
| **Purpose** | Edit the selected chapter's blocks. |
| **Sections** | `editor-toolbar` (`BAB NN` eyebrow + `chapter-title` h1; `block-count` "N blok"; **Tambah blok** secondary). `editor-canvas` → `ManualChapterContent` for the chapter. |
| **Blocks (model, `docs/DATA_MODEL.md`)** | `text` (rich text doc), `steps` (ordered `Step[]`), `image` (`imageAssetId` + caption), `callout` (`warning`/`info`/`tip` + content), `parameterTable` (`groupIds[]`), `faq` (question + answer). |
| **Phase 1 rendering** | `installation` → mock 5-step list + figure + warning callout. `parameters` → mock group heading + parameter table (from `parameters` mock) + info callout. `overview` → lead + `fact-grid` + tip callout. Others → `GenericContent` (template placeholder; `issue` chapters add a warning callout). |
| **Actions** | Phase 1: none functional (**Tambah blok** disabled, title "Block editor tersedia pada Phase 3"). Phase 3: add/move/delete/duplicate block; inline text editing (TipTap); step builder; parameter group/table builder; image placement; undo/redo. |
| **Validation** | Phase 3+: per-block payload validated with Zod on every write; invalid block shows an inline block-level error, never silently dropped. Alt text required on `image` blocks before completion. |
| **Loading** | `editor-canvas` shows block skeletons. |
| **Empty** | A chapter with no blocks (Phase 3) shows an "Add your first block" affordance + the template's suggested block list for that chapter (from `CONTENT_REQUIREMENTS.md`). |
| **Error** | Block save failure → inline retry on that block; rest of the chapter stays editable. |
| **Disabled** | Read-only mode (wrong status/role) disables all block controls with a single banner reason. |
| **Success** | Debounced autosave; the topbar `save-state` reflects Saved/Saving/Conflict. |
| **Responsive** | Centre column `min-width` ~560px on desktop; on tablet/mobile it is the sole column and reflows; long text constrained to a 65–75 character measure; parameter tables scroll inside `manual-table-wrap` (contained), never the page. |
| **Accessibility** | `aria-labelledby="chapter-title"`; block controls keyboard-reachable; reorder has button + keyboard paths (`PRD-MAN-008`); focus stays on the moved block after reorder. |
| **Data source** | Phase 1 mock. Phase 3: `manual_blocks` for the section, `ea_parameters`/`parameter_groups` for tables, `image_assets` for images. |
| **Permissions** | `manual:update` + editable status. |
| **Future phases** | P3 the entire editable editor; P4 text-selection AI actions invoked from here; P5 inline validation hints. |

### 5.3 RIGHT — `Inspector`

| Aspect | Specification |
|---|---|
| **Purpose** | Show completion/validation, metadata, and (Phase 4) AI assistance for the current manual/chapter. |
| **Tabs** | Phase 1: **Validasi**, **Metadata** (`role="tablist"`). `ROUTES_AND_COMPONENTS.md` envisaged completion / validation / metadata (3) — Open question `PRD-OQ-002`; Phase 1 folds completion into Validasi. |
| **Validasi tab** | `inspector-score` (big `%` + "Kelengkapan bab" + "N pemeriksaan aktif"). "Status bab" section: `validation-item` rows `success`/`warning` with icon + title + detail. "Asisten penulisan" section: `ai-placeholder` button, **disabled**, title "Asisten AI direncanakan untuk Phase 4" (Sparkles icon + "AI Assistant" + "Tersedia pada Phase 4"). `compliance-note` (Info icon): "Skor ini mengukur kelengkapan dokumentasi, bukan persetujuan hukum atau regulator." |
| **Metadata tab** | `metadata-list`: **Produk** `<dl>` (EA, Platform, Versi EA `.mono`, Versi manual `.mono`); **Kepemilikan** `<dl>` (Developer, Organisasi). |
| **Actions** | Switch tab; (Phase 4) run an AI operation on the current selection; (Phase 5) click a check to jump to the offending chapter/field; (Phase 6, reviewer) open a comment thread. |
| **Validation** | Reflects the completion engine (Phase 5): each check maps to `PASS`/`WARNING`/`MISSING`/`NOT_APPLICABLE` with evidence. |
| **Loading** | Score + rows shimmer. |
| **Empty** | Brand-new manual: score ~low, checks mostly `MISSING`; AI section still visible-but-disabled pre-Phase-4. |
| **Error** | Inspector-scoped error + retry; editor unaffected. |
| **Disabled** | AI placeholder disabled pre-Phase-4 (with reason). Reviewer view: no edit affordances. |
| **Success** | After a fix, the relevant check flips to `PASS` and the score updates. |
| **Responsive** | Desktop: static 320px column. <1024: inspector **sheet** from the right with a `panel-close`; opened via **Inspector** in `builder-mobile-controls`. |
| **Accessibility** | Tabs use `role="tab"`/`aria-selected`; score has visible number + label; check rows use icon + text; the compliance note is always visible (not a tooltip). |
| **Data source** | Phase 1 static. Phase 5: `checklist_results` + completion score for the manual version; Phase 4: `ai_revisions` + provider; Metadata from `manual_versions`/`ea_versions`/`memberships`. |
| **Permissions** | Everyone with builder access sees Validasi + Metadata; AI actions require `manual:update`; comment actions require a reviewer role (Phase 6). |
| **Future phases** | P4 AI tab active (before/after proposal UI, `ADDITIONAL_INFORMATION_REQUIRED` prompt, claim-scan list); P5 real checks; P6 comment/threads surface here or in `/manuals/[manualId]/reviews`. |

---

## 6. `/manuals/[manualId]/preview` (`app/(workspace)/manuals/[manualId]/preview/page.tsx`, `components/manual-renderer/manual-renderer.tsx`)

| Aspect | Specification |
|---|---|
| **Purpose** | Show the manual exactly as it will publish, using the shared renderer and A4 proportions. |
| **Target user** | Assigned member; reviewer. |
| **Layout** | `preview-page` → `preview-toolbar` (back `icon-button` → builder; eyebrow "Preview manual" + h1 "EA name · vX.Y.Z"; **Edit manual** secondary; **Ekspor PDF** primary, disabled) → `preview-disclosure` (Info: "Preview menggunakan model konten yang sama dengan editor. Ekspor PDF akan diaktifkan pada Phase 7.") → `ManualRenderer`. |
| **Renderer output** | `a4-document`: `manual-cover` (brand lockup, "EXPERT ADVISOR MANUAL", EA name, "User Manual Book", `<dl>` Platform / EA Version / Manual Version / Release Date, footer "PT Smartin Advisor Sistem" + "Sample / Demo Document"); then `manual-page` sections, each with running `header` (EA name · "User Manual" / "Version X.Y.Z"), `manual-page-body` (`chapter-kicker` "NN · TITLE" + h2 + chapter content), and `footer` ("SMARTIN MANUAL BUILDER" + page number). |
| **Buttons / actions** | Back to editor; **Edit manual** → builder; **Ekspor PDF** — present, `disabled`, `title="Ekspor PDF tersedia pada Phase 7"` (no inert unexplained button). |
| **Validation** | N/A (read-only view). |
| **Loading** | `a4-document` skeleton (cover + 2–3 page frames). |
| **Empty** | A manual with only template placeholders still renders every chapter with placeholder content and a subtle "belum diisi" marker per empty chapter (Phase 5). |
| **Error** | Renderer error boundary → "Preview tidak dapat dimuat" + retry; toolbar stays. |
| **Disabled** | **Ekspor PDF** until Phase 7. |
| **Success** | Phase 7: **Ekspor PDF** enabled → triggers the Playwright job with a visible progress/retry state; produced file named `Manual_<EAName>_v<X.Y.Z>.pdf`. |
| **Responsive** | ≥1024: scaled paper view with real A4 aspect ratio, centred, page shadows. 768–1023: single scaled page width, reduced margins. <768: single-column readable flow (drops literal page frames), retains chapter headings, images `max-width: 100%`, tables scroll within a contained region. |
| **Accessibility** | Document is semantic (`<article>`, `<section>`, `<h1>`/`<h2>`, `<figure>`/`<figcaption>`); running header/footer are decorative and `aria-hidden` where they repeat; back button labelled; disabled export has a `title` + is not focus-trapping. |
| **Data source** | Phase 1: `ManualRenderer` hardcodes VMax cover + 3 chapters. Phase 2/7: the `ManualViewModel` for the route `manualId`; Phase 7 public route uses the **published snapshot** render JSON. |
| **Permissions** | Assigned member/reviewer for the workspace preview; the public route (`/manual/[eaSlug]/[version]`, Phase 7) is unauthenticated and serves only `PUBLISHED`. |
| **Future phases** | P7: enable PDF, finalise print CSS, add TOC/search/version nav on the public route. |

---

## 7. `/templates` (`app/(workspace)/templates/page.tsx`, `components/section-page.tsx`)

| Aspect | Specification |
|---|---|
| **Purpose** | List/manage the standard manual structure and the documentation checklist template. |
| **Target user** | Admin (manage); Developer (read). |
| **Layout** | `SectionPage`: `PageHeader` (eyebrow "Dokumentasi", h1 "Template manual") → `card.section-list` of items, each: ready/pending icon (`CheckCircle2` / `Clock3`) + title + detail + `status-text` ("Tersedia" / "Phase berikutnya"). |
| **Phase 1 items** | "Template Manual EA Standar" (18 bab · 13 bab wajib · updated date — *count to reconcile, `PRD-OQ-005`*), "Template Checklist Dokumentasi" (26 pemeriksaan awal), "Editor template admin" (pending, "dihubungkan pada Phase 2"). |
| **Buttons / actions** | Phase 1: none. Phase 2: **Edit template** (Admin) opens a template editor (chapter list, required flags, help text; checklist items, categories, rule keys); versioned save. |
| **Validation** | Phase 2: a template version must retain all Bappebti-scope required chapters (cannot delete a mandatory section); checklist item keys must be unique. |
| **Loading** | `section-list` skeleton rows. |
| **Empty** | Not expected (system templates always present); a fresh org gets the seeded default template version. |
| **Error** | Card error + retry. |
| **Disabled** | Phase 1: "Editor template admin" shown as a pending item, not a button. Phase 2: **Edit** disabled for non-admins with reason. |
| **Success** | Phase 2: "Template version vN saved" confirm; new manuals instantiate the active version. |
| **Responsive** | `section-list` single column; item rows stack icon/text/status <480. |
| **Accessibility** | `aria-label` = page title on the list; ready state is icon + text ("Tersedia"/"Phase berikutnya"). |
| **Data source** | Phase 1 hardcoded. Phase 2: `manual` templates + `checklist_items` (versioned). |
| **Permissions** | `template:manage` (Admin) to edit; read for all members. |
| **Future phases** | P2 template CRUD; P5 checklist template drives the validation engine and records its version on each result set. |

---

## 8. `/reviews/technical` (`app/(workspace)/reviews/technical/page.tsx`)

| Aspect | Specification |
|---|---|
| **Purpose** | Queue of manual versions submitted for technical review. |
| **Target user** | Technical reviewer, Admin. |
| **Layout** | `SectionPage`: `PageHeader` (eyebrow "Review", h1 "Review teknis", description "Antrean verifikasi kesesuaian manual dengan perilaku Expert Advisor.") → `section-list` items (EA + version, submitter + checklist progress, ready state). |
| **Phase 1 items** | "Smart Grid Pro v2.4.0" (ready, "Dikirim oleh Budi Pratama · 25 dari 26 item lengkap"); "VMax EA v1.0.0" (pending, "Draf belum dikirim · lengkapi 2 catatan validasi"). |
| **Buttons / actions** | Phase 6: each queue row → **Open review** (`/manuals/[manualId]/edit` read/comment mode + `/manuals/[manualId]/reviews`); decision actions (**Approve → compliance**, **Request changes**) live inside the review view, not the queue. |
| **Validation** | Phase 6: **Approve** disabled if the actor authored/edited the version (self-approval guard) with a visible reason. |
| **Loading** | `section-list` skeleton. |
| **Empty** | "Tidak ada manual menunggu review teknis" + link back to `/manuals`. |
| **Error** | Card error + retry. |
| **Disabled** | Non-`ready` rows (draft not yet submitted) are informational, not actionable. |
| **Success** | Phase 6: after a decision, the row leaves the queue; an audit entry is written; the developer/compliance reviewer is notified. |
| **Responsive** | Single-column list; row content stacks <480. |
| **Accessibility** | Ready state icon + text; row titles are links (Phase 6) with descriptive text incl. version. |
| **Data source** | Phase 1 hardcoded. Phase 6: `manual_versions` where status = `TECHNICAL_REVIEW` and reviewer assignment = current user (or all, for Admin), org-scoped, with checklist progress. |
| **Permissions** | `review:technical`; Admin sees all. |
| **Future phases** | P6 the full queue + decisions + comments + audit history; badge count in the sidebar. |

---

## 9. `/reviews/compliance` (`app/(workspace)/reviews/compliance/page.tsx`)

| Aspect | Specification |
|---|---|
| **Purpose** | Queue of manual versions that passed technical review and await compliance review. |
| **Target user** | Compliance reviewer, Admin. |
| **Layout** | `SectionPage`: `PageHeader` (eyebrow "Review", h1 "Review kepatuhan", description "Tinjau kelengkapan dokumentasi dan klaim yang memerlukan perhatian.") → `section-list`. |
| **Phase 1 items** | "Smart Grid Pro v2.4.0" (ready, "Review teknis selesai · siap ditinjau kepatuhan"); "Claim checker & keputusan reviewer" (pending, "Workflow penuh akan tersedia pada Phase 5–6."). |
| **Buttons / actions** | Phase 6: row → compliance review view showing the documentation checklist (PASS/WARNING/MISSING/NA) + claim-scan findings; decisions **Approve** (→ APPROVED) / **Request changes**. |
| **Validation** | Only versions with a recorded technical approval appear; UI never shows "regulator approved" — only "documentation checklist completed" / "ready for compliance review". |
| **Loading / Empty / Error** | As §8, with empty copy "Tidak ada manual menunggu review kepatuhan". |
| **Disabled** | **Approve** disabled for the version's author/editor (self-approval guard). |
| **Success** | Phase 6: decision recorded + audited; on approve, the version becomes `APPROVED` and eligible for publish. |
| **Responsive / Accessibility** | As §8. |
| **Data source** | Phase 6: `manual_versions` status = `COMPLIANCE_REVIEW`, assignment-scoped, org-scoped, plus `checklist_results` and claim findings. |
| **Permissions** | `review:compliance`; acts only after technical approval. |
| **Future phases** | P4 claim findings feed here; P5 checklist results; P6 decisions + audit. |

---

## 10. `/resources/guide` (`app/(workspace)/resources/guide/page.tsx`)

| Aspect | Specification |
|---|---|
| **Purpose** | Static practical guidance for writing clear, factual, maintainable EA manuals. |
| **Target user** | All members (esp. new contributors). |
| **Layout** | `SectionPage`: `PageHeader` (eyebrow "Sumber daya", h1 "Panduan dokumentasi") → `section-list` of guidance items (all `ready: true`). |
| **Phase 1 items** | "Menulis langkah instalasi yang dapat diikuti", "Mendokumentasikan parameter EA", "Menjaga bahasa tetap netral". |
| **Buttons / actions** | Phase 1: none (informational). Later: link each item to a fuller article or to the relevant `CONTENT_REQUIREMENTS.md` chapter section. |
| **States** | Loading skeleton; no empty/error beyond a generic card error (content is static). No disabled/success states. |
| **Responsive** | Single-column list. |
| **Accessibility** | Real headings per item; icon + "Tersedia" text. |
| **Data source** | Static (could become CMS-managed content later; not in roadmap). |
| **Permissions** | All members. |
| **Future phases** | Optional deep-link into content requirements; not a roadmap commitment. |

---

## 11. `/resources/compliance` (`app/(workspace)/resources/compliance/page.tsx`)

| Aspect | Specification |
|---|---|
| **Purpose** | Explain the documentation checklist and, explicitly, that it is **not** regulator approval. |
| **Target user** | All members; compliance reviewers especially. |
| **Layout** | `SectionPage`: `PageHeader` (eyebrow "Sumber daya", h1 "Checklist kepatuhan", description "Checklist membantu kesiapan dokumentasi dan tidak sama dengan persetujuan regulator.") → `section-list`. |
| **Phase 1 items** | "Identitas & versi produk", "Risiko & bahasa klaim", "Dukungan & transparansi" (all `ready: true`). |
| **Content rules** | Must never state or imply Bappebti/Bursa approval; uses "ready for compliance review", "documentation checklist completed". Mirrors `docs/COMPLIANCE_REQUIREMENTS.md`. |
| **Buttons / actions** | None in Phase 1. Phase 5: link items to the live checklist categories and their rule descriptions. |
| **States** | Loading skeleton; generic card error; no empty (static). |
| **Responsive / Accessibility** | As §10; the "not approval" statement is body text, not a tooltip. |
| **Data source** | Static in Phase 1; Phase 5 may render the active checklist template's categories + human-readable rule text. |
| **Permissions** | All members. |
| **Future phases** | P5 sync with checklist template; keep the disclaimer prominent. |

---

## 12. `/settings` (`app/(workspace)/settings/page.tsx`)

| Aspect | Specification |
|---|---|
| **Purpose** | Profile and organisation settings. |
| **Target user** | All members (profile); Admin (organisation). |
| **Layout** | `page-container` → `PageHeader` (eyebrow "Workspace", h1 "Pengaturan") → `card.settings-card` (h2 "Profil pengguna" + note "Informasi akun nyata akan dikelola oleh autentikasi Supabase pada Phase 2." + `<dl>`: Nama, Peran, Bahasa antarmuka, Organisasi). |
| **Fields (Phase 2)** | Profile: display name, email (read-only from auth), interface language. Organisation (Admin): org name, slug (read-only), members table (name, email, role select, active toggle), reviewer assignment defaults. |
| **Buttons / actions** | Phase 2: **Save profile**; Admin: **Invite member**, **Change role**, **Deactivate member**. |
| **Validation** | Name ≥ 2; role ∈ the 4 org roles; cannot remove the last Admin; cannot deactivate yourself if sole Admin. |
| **Loading** | `settings-card` skeleton `<dl>`. |
| **Empty** | Org with only the current user → members table shows one row (self) + **Invite member**. |
| **Error** | Inline field error / banner; non-destructive. |
| **Disabled** | Admin-only controls disabled for non-admins with reason; email field read-only (managed by auth). |
| **Success** | "Profil disimpan" / "Peran diperbarui" inline confirm; role change audited. |
| **Responsive** | `<dl>` 2-col ≥768 else 1-col; members table → card rows <768. |
| **Accessibility** | Labelled inputs; role `<select>` labelled; destructive actions (deactivate) confirm; audit note visible. |
| **Data source** | Phase 1 hardcoded ("Andi Setiawan / Developer / Bahasa Indonesia / PT Smartin Advisor Sistem"). Phase 2: `users`, `memberships`, `organizations`. |
| **Permissions** | Profile: self. Organisation + membership management: `member:manage` (Admin). All privileged changes audited. |
| **Future phases** | P2 real profile + membership management; later: notification preferences, API tokens (not in roadmap). |

---

## 13. `/login` (`app/login/page.tsx`) — outside the shell

| Aspect | Specification |
|---|---|
| **Purpose** | Enter the workspace. |
| **Target user** | Any user. |
| **Layout** | `login-page` = `login-brand-panel` (brand lockup, eyebrow "EA Developer Tools", h1, 3 `CheckCircle2` value bullets, "PT Smartin Advisor Sistem") + `login-card`. |
| **Phase 1 card** | Eyebrow "Demo Phase 1", h2 "Masuk ke workspace", note "Autentikasi masih dimock. Pilih peran untuk meninjau antarmuka.", `form-field` role `<select>` (Developer / Technical Reviewer / Compliance Reviewer / Admin), **Lanjutkan ke dashboard** (primary, full width → `/dashboard`), small print "Data … tersimpan lokal." |
| **Phase 2 card** | Email + password (or provider button), **Masuk**, error region for invalid credentials, link to password reset. The role select is removed (role comes from membership). |
| **Validation** | Phase 2: email format; password non-empty; server error "Email atau kata sandi salah" in a non-field-specific alert. |
| **Loading** | **Masuk** shows a pending state; form disabled during submit. |
| **Empty** | N/A. |
| **Error** | `role="alert"` block above the fields; fields keep their values (except password). |
| **Disabled** | Submit disabled until required fields are non-empty (Phase 2). |
| **Success** | Redirect to `/dashboard` (or the `?next=` target). |
| **Responsive** | ≥1024: two-panel (brand left, card right). <1024: brand panel collapses to a compact header; card full width. |
| **Accessibility** | Labelled inputs; `autoComplete="email"`/`current-password`; visible focus; error announced; the value bullets are decorative (`aria-hidden` icons) with real text. |
| **Data source** | Phase 1: none (static). Phase 2: Supabase Auth. |
| **Permissions** | Public. |
| **Future phases** | P2 real auth; "no membership" state routes to an explanatory page instead of the workspace. |
| **Route-group note** | `PRD-OQ-003`: architecture envisaged `app/(auth)/login/`; Phase 1 shipped `app/login/`. Reconcile in Phase 2 (documentation-level flag only; no code change now). |

---

## 14. Public published manual — `/manual/[eaSlug]/[version]` (Phase 7)

| Aspect | Specification |
|---|---|
| **Purpose** | Immutable public reading view of a published manual version. |
| **Target user** | Public reader (trader, support, Market reviewer). |
| **Layout** | Full-width reading layout: left/top **table of contents** (chapter list, current-position highlight), main column = the rendered manual (same renderer as preview), **version switcher** (list of published versions for this EA), **in-page search** field. No workspace sidebar. |
| **Components** | Shared `ManualRenderer` output; `TOC`; `VersionNav`; `SearchInPage`; footer with product identity + "Sample / Demo" marker where applicable. |
| **Buttons / actions** | Navigate TOC; switch version; **Download PDF** (Phase 7, links to the Playwright-produced `Manual_<EAName>_v<X.Y.Z>.pdf`); search. |
| **Validation** | Serves only `PUBLISHED` snapshots; a non-published slug/version → 404. |
| **Loading** | Skeleton TOC + first chapter. |
| **Empty** | No published version for the slug → 404 / "Manual belum diterbitkan". |
| **Error** | Render error boundary → generic message + link to the EA's published index. |
| **Disabled** | N/A (read-only). |
| **Success** | N/A. |
| **Responsive** | ≥1024: TOC rail + content. 768–1023: collapsible TOC. <768: TOC as a top drop-down; content single-column; images `max-width: 100%`; tables scroll in a contained region. |
| **Accessibility** | Landmark regions (`<nav>` TOC, `<main>` content); heading hierarchy from chapters; skip-to-content; search field labelled; version switcher is a labelled control. |
| **Data source** | `published_snapshots` (render JSON, content hash, public slug/version) + publish-safe images. No draft/private data. |
| **Permissions** | Public, unauthenticated, read-only. |
| **Future phases** | This route is introduced in Phase 7; visual regression fixtures compare web vs PDF. |

---

## 15. Cross-page component contracts

| Component | Where | Contract |
|---|---|---|
| `PageHeader` | list/dashboard/settings pages | eyebrow?, title, description, action? (single primary). |
| `SectionPage` | templates, reviews, resources | eyebrow, title, description, items[{ title, detail, ready? }] → `section-list` with ready/pending icon + `status-text`. |
| `ManualTable` | dashboard (compact), `/manuals` | compact? → top 4, no filter bar; full → `filter-bar` + responsive table; reads `localStorage` new manual in Phase 1 only. |
| `StatusBadge` | tables, builder topbar | status ∈ the 6 `ManualStatus`; icon + `statusLabels[status]`; `data-status` for token colour. |
| `Completion` | `/manuals` | value:number → `%` text + `progress-track` bar + `aria-label`. |
| `ManualRenderer` / `ManualChapterContent` | builder canvas, preview, (P7) public route | one semantic view model; chapter-specific renderers for `installation`/`parameters`/`overview` + `GenericContent` fallback; **no second content model for PDF**. |
| `AppShell` | all `(workspace)` routes | sidebar + header + `main#main-content`; mobile drawer; skip link. |

---

## 16. Global state, loading, empty, error patterns (applies unless a page overrides)

- **Loading:** route-level `loading.tsx` skeletons (Phase 8 formalises); component-level skeletons for tables (`TableSkeleton`) and cards. Never a blank screen; never a layout shift when content arrives.
- **Empty:** a titled `TableEmptyState` / `empty-state` with one clear next action (usually **Buat manual** or **Tambah produk**), never a bare "No data".
- **Error:** route-level `error.tsx` with a retry (Phase 8); component-level inline error + retry that does not take down the shell or sibling panels. Errors show a human message, never a stack trace or a raw code.
- **Disabled:** every disabled control has a `title`/adjacent text explaining why (phase not reached, permission, precondition). No inert buttons.
- **Success:** inline confirmation near the trigger (`role="status"`), or the natural state change (row appears, badge updates). Toasts only for actions without an obvious on-screen result.
- **Permissions:** disallowed actions are hidden or disabled-with-reason on the client and always re-checked on the server (typed error surfaced near the trigger).
