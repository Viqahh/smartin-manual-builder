# Phase 7 — Output & publication

> **Status: SLICES 1–5 complete and verified. Slice 4's synchronous-Chromium concurrency STOP is
> RESOLVED by Slice 4B (immutable PDF artifact: generate once per snapshot, store privately,
> `GET /pdf` never launches Chromium — 2 / 10 / 20 concurrent downloads all 200 + canonical
> bytes). Slice 5 closes AC-P7-4 (web/PDF content-model diff EMPTY + deterministic visual
> regression, tolerance 0) and AC-P7-10 (0 forbidden regulatory labels in web/print/PDF; the
> existing claim-scanner + `publish_manual_version` gate blocks any new publication carrying one)
> and lands the final public-reading-surface styling. All 9 Phase 7 MUST criteria + the 1 SHOULD
> are proven. No migration added (28 == 28). NOT COMMITTED, NOT PUSHED — Phase 7 is COMPLETE
> pending Slice 5 review.**
>
> Slice 1 delivers the public read path for published manuals: a global public namespace, a
> publication-safe index, snapshot v2 (UUID-free publication representation), a server-only
> snapshot→`ManualViewModel` adapter, the narrow `getPublicManual` read helper, and the
> `/manual/[eaSlug]/[version]` route shell with PUBLISHED / ARCHIVED semantics.
>
> Slice 2 adds the public reading controls: a table of contents with deterministic chapter
> anchors + active-chapter tracking, client-side in-page search over the sanitized snapshot, and
> a PUBLISHED-only version switcher that keeps older version URLs addressable.
>
> Slice 3 adds published image delivery: a same-origin `/manual/<slug>/<version>/image/<idx>`
> proxy that streams bytes from the still-private `manual-images` bucket after snapshot-membership
> authorisation — no public bucket, no signed URL in the browser, no `storageKey` leak. Step
> images now render through the same shared renderer.
>
> Slice 4 adds deterministic PDF export: a signed server-only print page, headless-Chromium
> generation (`playwright-core` + `@sparticuz/chromium`), an A4 print stylesheet with real
> pagination (repeated table headers, figure/caption cohesion, per-chapter page breaks),
> `publishedAt`-derived metadata normalisation for byte-identical output, and a shared
> "Ekspor PDF / Unduh PDF" control. Deployed and measured on a Vercel Preview (Hobby + Fluid
> Compute) — see the "Serverless runtime ceiling" note for the load limit.

Approved Phase 6 baseline: `f9721b9623588be8222f21283310abd5d1bf1cb9` (frozen).

Core Phase 7 invariant: **published output is rendered ONLY from the immutable
`published_snapshots.render_json`.** The public route never reads `manuals` / `manual_versions` /
`manual_sections` / `manual_blocks` / `parameter_groups` / `ea_parameters` / `ea_version_setups` /
`changelog_entries`. A published page can never be reconstructed from mutable working tables.

---

## The global-namespace problem

`/manual/[eaSlug]/[version]` has no organisation segment, but:

- `ea_products.slug` is only `UNIQUE (organization_id, slug)` — two orgs can both own `vmax-ea`.
- `ea_products.slug` is **mutable**: `updateEaProduct(name)` recomputes `slug = slugify(name)`.
- `published_snapshots` is only `UNIQUE (organization_id, public_slug, public_version)`.

So a bare `published_snapshots` lookup by `(public_slug, public_version)` is globally ambiguous,
and deriving the public URL from the *current* product slug on every publish would silently move
already-published URLs on a rename. Slice 1 introduces a dedicated global namespace to own the
public slug.

---

## Public slug = lineage identity, frozen on first publication

The public slug is claimed by a **manual lineage** (one `manuals.id`) on its FIRST publication and
frozen there. Every later published version of that lineage keeps the same public slug — even
after the EA product is renamed and its internal `ea_products.slug` changes.

```
first publish  : lineage M, product slug "vmax-ea"     -> public slug "vmax-ea" claimed by M
product renamed: ea_products.slug -> "vmax-pro"
next publish   : caller passes "vmax-pro"; RPC IGNORES it -> still /manual/vmax-ea/<new-version>
```

Moving a public URL is out of scope (a future explicit "public slug migration" feature).

---

## Migration `20260901002500_phase7_publication_index.sql`

The first of two Phase 7 migrations (`02600` below adds the RPC identity guard). Migrations
`00100`–`02400` are frozen and untouched. After both apply: **27 local == 27 remote** on DEV.

### `published_snapshots`
- adds `UNIQUE (id, organization_id)` — the composite-FK target for the version index (maintains
  the project's Phase-2 same-org composite-FK invariant).

### `public_manuals` — routing identity only (NOT a content source)
| column | notes |
|---|---|
| `id uuid PK` | |
| `public_slug text NOT NULL UNIQUE` | **globally** unique; `^[a-z0-9]+(-[a-z0-9]+)*$` (same format as EA-product slugs) |
| `organization_id uuid NOT NULL` | `references organizations on delete cascade` |
| `manual_id uuid NOT NULL` | one row per lineage |
| `first_published_at timestamptz NOT NULL` | |

`UNIQUE (id, organization_id)`, `UNIQUE (organization_id, manual_id)`.
FK `(manual_id, organization_id) → manuals(id, organization_id)` **`ON DELETE CASCADE`**.

> Deviation from the drafted `ON DELETE RESTRICT`: with SELECT-only grants (below) nothing can
> `DELETE FROM public_manuals` through the app, so §14's "no ordinary application delete" is
> delivered by the grant model. `CASCADE` is required because the only way to remove an index row
> is a parent delete (there is no DELETE privilege to target it directly), and `manuals` rows are
> only ever removed by trusted service / cascade cleanup. It stores **no** `ea_name` / `ea_platform`
> — display metadata belongs to each immutable snapshot.

### `public_manual_versions` — the route / switcher index
| column | notes |
|---|---|
| `id uuid PK` | |
| `public_manual_id uuid NOT NULL` | |
| `organization_id uuid NOT NULL` | |
| `public_version text NOT NULL` | |
| `published_snapshot_id uuid NOT NULL UNIQUE` | |
| `publication_state text` | `PUBLISHED` \| `ARCHIVED` only — never a draft/review state |
| `published_at timestamptz NOT NULL` | immutable |
| `archived_at timestamptz` | set only on PUBLISHED → ARCHIVED |

`UNIQUE (public_manual_id, public_version)`, `UNIQUE (id, organization_id)`,
`CHECK (publication_state = 'PUBLISHED' OR archived_at IS NOT NULL)`.
Same-org composite FKs (not just RPC discipline):
`(public_manual_id, organization_id) → public_manuals(id, organization_id)` and
`(published_snapshot_id, organization_id) → published_snapshots(id, organization_id)`, both
`ON DELETE CASCADE`. No redundant `public_slug` column — the route resolves
`slug → public_manuals.id → public_manual_versions`, which structurally prevents a version row
from attaching to an unrelated slug.

### Backfill (mandatory preflight)
Before creating the index the migration **aborts with an explicit integrity error** if legacy
history is ambiguous: one `public_slug` → more than one lineage, OR one lineage → more than one
`public_slug`. If clean, it backfills `public_manuals` + `public_manual_versions` from
`published_snapshots ⋈ manual_versions` (state from `manual_versions.status`). This migration-time
join to working tables is allowed; the public route never does it. (DEV had zero prior published
snapshots at apply time — preflight passed, backfill was a no-op.)

### Write boundary — grants, not policies
`GRANT SELECT` on both tables to `authenticated` (org-member RLS) + `service_role` (the Next
server read path). **No INSERT/UPDATE/DELETE grant to anyone.** The only writer is the
`SECURITY DEFINER` publication RPC pair (owner `postgres`). A direct PostgREST
INSERT/UPDATE/DELETE by `anon` / `authenticated` / `service_role` is denied by the missing grant.
Defence-in-depth: a `BEFORE UPDATE` trigger on `public_manual_versions` allows **only**
`PUBLISHED → ARCHIVED` (+ `archived_at`) and rejects any change to
`public_manual_id` / `organization_id` / `public_version` / `published_snapshot_id` /
`published_at` — even on the RPC path. There is no general public-index update action.

### Migration `20260901002600_phase7_publication_identity_integrity.sql`

A second Phase 7 migration (`02500` is frozen and untouched). `CREATE OR REPLACE
publish_manual_version` again — same signature, `02500` body verbatim — adding three **identity
guards** that run AFTER `v_effective_public_slug` is resolved and BEFORE any permanent mutation:

- `p_public_version` must equal the locked `manual_versions.version` (a trusted-server bug can
  never publish `2.0.0` under `/manual/.../9.9.9`);
- `p_render_json #>> '{public,slug}'` must equal `v_effective_public_slug`;
- `p_render_json #>> '{public,version}'` must equal `p_public_version`.

Mismatch → typed `stale content:` error, whole transaction rolls back (no PUBLISHED, no snapshot,
no index row, no publish audit). The RPC **never mutates `p_render_json`** and never stores a
`content_hash` that describes a different public identity. The caller retries: on retry the server
action reads the now-established lineage claim and rebuilds the snapshot with the frozen slug.

This closes the residual race: the server action builds `p_render_json` + `p_snapshot_hash` before
the RPC decides `v_effective_public_slug`, so between "action reads the index" and "RPC claims the
slug" an EA-product rename or a concurrent first-publication could leave the snapshot describing a
stale slug. After `02500` alone the DB index would be correct while `render_json.public.slug` could
disagree. `02600` makes that combination un-storable.

After apply: **27 local == 27 remote** on DEV.

### `publish_manual_version` / `archive_manual_version` — REPLACED (in `02500`)
`CREATE OR REPLACE` re-issues both Phase-6 RPC bodies **verbatim** (same signatures, same error
strings) plus, inside the SAME transaction:

**publish** — after the Phase-6 gates (ADMIN, APPROVED, round, submitted-hash, both current-round
approval hashes, checklist coherence, the persisted Phase-5 publish gate) and before the status
transition:
1. the target `manual_versions` row is already locked `FOR UPDATE`; also select `manual_id → v_manual_id`;
2. `perform 1 from manuals where id = v_manual_id for update` — serialises first-publication claims within one lineage;
3. if this lineage already owns a `public_manuals` row → `v_effective_public_slug` = its existing `public_slug` (the caller's `p_public_slug` is ignored);
4. otherwise claim: `INSERT INTO public_manuals ... ON CONFLICT (public_slug) DO NOTHING`, then
   `SELECT ... WHERE public_slug = p_public_slug FOR UPDATE` (waits out a concurrent unique
   conflict and locks the winner), then **verify** `claimed.organization_id = v_org AND
   claimed.manual_id = v_manual_id` — else `raise 'conflict: public slug "%" is already claimed by
   another manual' using errcode = 'unique_violation'`. The claim never proceeds merely because
   `ON CONFLICT DO NOTHING` raised no error.

Then status → PUBLISHED, the immutable `published_snapshots` row, one `public_manual_versions` row
(`PUBLISHED`), and exactly one `manual_version:publish` audit — all using `v_effective_public_slug`
for the snapshot's `public_slug`, the audit metadata, and the RPC return `publicSlug`. Any failure
(slug conflict included) rolls back everything: no PUBLISHED without an index row, no snapshot
without an index row, no publish audit on a failed publication.

**archive** — after the Phase-6 body flips `manual_versions` PUBLISHED → ARCHIVED, it runs
`UPDATE public_manual_versions SET publication_state='ARCHIVED', archived_at=now() WHERE
published_snapshot_id = v_snap` and requires **exactly one** row affected — otherwise it raises an
integrity error and the whole archive rolls back. The snapshot is byte-identical; the audit fires
exactly once.

### Server action — frozen slug resolved BEFORE the snapshot is built
`publishManualVersion` now **pre-reads `public_manuals`** for `(orgId, manual_id)` before
`buildPublishedSnapshot`: if the lineage already published, `publicSlug` is its frozen
`public_slug`; otherwise it is the current `ea_products.slug` (first-claim candidate). The snapshot
and its hash are therefore coherent with what the RPC will persist. The RPC stays the final,
transaction-safe authority (it re-derives and re-validates); the pre-read only keeps the bytes
coherent. The action returns `publicSlug: row.publicSlug ?? publicSlug` — the RPC's value wins.

---

## Snapshot v2 — publication layer only

`buildPublishedSnapshot` now emits `snapshotVersion: 2`. **Nothing in `projectReviewContent` /
`manualReviewFingerprint` / `submitted_content_hash` / review `reviewed_content_hash` changes** —
v2 is purely the publication representation.

- `content` carries **no internal database identity**: `manual` / `manualVersion` / `eaProduct` /
  `eaVersion` / `organization` `.id` are dropped; `changelog[].sourceEaVersionId` is dropped.
  Content identity survives by value (names, versions, keys).
- `content.parameterGroups` is an ordered array (by `position`); a `parameterTable` block gets
  `groupRefs: number[]` = indices into that array (raw `parameterGroupIds` UUIDs removed, including
  from the block payload).
- images are collected in **first-appearance order** while walking the ordered sections → ordered
  blocks → (for a `steps` block) ordered steps — never JS object-insertion order of the input map;
  then any orphan upload in sorted-key order. An `image` block gets `imageRef: number | null`; a
  `steps[n]` with an image gets `imageRef` and its raw `imageAssetId` UUID is removed; the step
  and image namespaces are shared (one ordered array). `content.images` becomes an ordered array
  of `{ altText, caption }`.
- a **top-level `images` array** (same order) carries the server-only `storageKey` for the future
  image proxy (Slice 3). `scanSnapshotForLeaks` deliberately does not flag `storageKey`.

`computeSnapshotHash` is unchanged: a v1 json still hashes to its v1 hash, a v2 json to its v2 hash.

### `snapshotToViewModel(renderJson, { slug, version, status })` — pure adapter
`lib/publication/snapshot-view-model.ts`. Rebuilds the exact `ManualViewModel` the one shared
`ManualRenderer` consumes, with **synthetic non-UUID ids** (`sec-<key>`, `blk-<si>-<bi>`,
`pg-<i>`, `par-<gi>-<pi>`, `set-<i>`, `img-<n>`, `cl-<i>`), `manual.id` / `manualVersion.id` /
`eaProduct.id` / … = `""`, `manualVersion.status` from the publication state, `signedUrl: null`,
`sourceEaVersionId: null`. A v2 `steps[n].imageRef` is restored to a synthetic
`imageAssetId: "img-<n>"` (mirrors image blocks). Handles v2 (positional refs) and degrades safely
for a legacy v1 row (v1 parameterTable UUIDs cannot be mapped to the id-less group array → the
renderer shows every group, the pre-Phase-7 behaviour; v1 block + step images still resolve by
sorted key). It never touches the database and never calls `assembleManualViewModel`.

---

## Server-only raw snapshot — `getPublicManual`

`lib/publication/get-public-manual.ts` (`import "server-only"`). The ONLY public read path.

1. `public_manuals` by `public_slug` → lineage id (or `null` → route 404).
2. `public_manual_versions` by `(public_manual_id, public_version)` → the index row (or `null` → 404).
3. `published_snapshots` by `id` → `render_json` + `content_hash`.
4. **re-verify** `computeSnapshotHash(render_json) === content_hash` server-side; a mismatch throws
   `PublicSnapshotCorruptError` (route → generic 500, no DB detail).
5. for an ARCHIVED version, look up the newest still-PUBLISHED sibling (`published_at DESC`).
6. adapt via `snapshotToViewModel`.

Returns a **sanitized projection** only:
`{ vm, publicationState, publishedAt, archivedAt, publicSlug, publicVersion, latestPublishedVersion }`
— no `render_json`, `storageKey`, `content_hash`, `organization_id`, `manual_id`, snapshot id, or
any database UUID. The raw snapshot never crosses to a client: the route and `ManualRenderer` are
server components, so only rendered HTML is sent (no `render_json` in props / RSC flight payload).
Search / TOC (Slice 2) will consume this sanitized model, never `PublishedSnapshotJson`.

---

## Route — `app/manual/[eaSlug]/[version]/page.tsx`

Outside `app/(workspace)` → unauthenticated (middleware already has no gate on `/manual/*`).
`export const dynamic = "force-dynamic"`; no `generateStaticParams`; no `revalidateTag`. Uses the
existing `ManualRenderer` (no second renderer).

| case | result |
|---|---|
| unknown slug / unknown version / never-published | `notFound()` → 404 |
| PUBLISHED | 200, snapshot renders, no banner |
| ARCHIVED | 200, immutable snapshot renders + neutral banner **"Versi ini telah diarsipkan."**; if a PUBLISHED sibling exists, **"Lihat versi terbaru."** links to `/manual/<slug>/<latest>`; excluded from the default switcher (Slice 2) |
| stored snapshot fails hash re-verification | generic 500, no DB detail |

EA display metadata (name, platform, version, release date, developer, org) comes from **each
version's own immutable snapshot** via `manualIdentity(vm)` — not from `public_manuals` — so two
versions under one frozen slug can legitimately show different EA names. Image blocks render
`[gambar belum tersedia]` while `signedUrl` is null (image proxy is Slice 3).

---

## Tests

### Unit
- `tests/unit/publication-snapshot.test.ts` — existing canonical-hash / leak-scan tests updated
  for the v2 shape, plus v2 cases: `snapshotVersion === 2`, deterministic build, `parameterGroupIds
  → groupRefs`, `imageAssetId → imageRef`, parameter-subset resolves to the right index, no raw
  UUID in `content`, image order follows first block appearance not input-map key order, and
  **`steps[].imageAssetId → positional imageRef` sharing the image namespace** (UUID_A in a step +
  UUID_B in an image block, `vm.images` inserted reversed → deterministic, both UUIDs gone).
- `tests/unit/publication-view-model.test.ts` — the adapter over a VM whose every id is a real
  UUID: output carries no UUID anywhere, ids are synthetic, every `signedUrl` is null, content
  preserved by value, parameterTable + image refs resolve, **v2 `steps[].imageRef` restored to a
  synthetic `img-<n>` with no raw UUID / storageKey leak**, no `storageKey` / secret leaks,
  ARCHIVED status flows through, v1 fallback reads without crashing.

### Live integration — `tests/integration/rls.test.ts` → "Phase 7 slice 1 — global publication namespace" (6, Supabase DEV)
1. **EA-product rename coherence** (throwaway ORG-A product, real `ea_products.slug` update):
   `public_manuals.public_slug`, `published_snapshots.public_slug` (v1 & v2), `render_json →
   public → slug`, `render_json → public → version`, audit metadata `publicSlug`, the RPC return
   `publicSlug`, and `computeSnapshotHash(stored render_json) == stored content_hash` all agree on
   the frozen slug; nothing resolves under the renamed slug.
2. a PUBLISHED version resolves through `public_manuals → public_manual_versions →
   published_snapshots` only; `anon` and a cross-org authenticated user get zero rows on all three
   tables; direct `service_role` INSERT/UPDATE/DELETE on the index is rejected; the RPC is the sole
   writer; the index row is untouched by the rejected writes.
3. archive flips exactly its own `public_manual_versions` row to ARCHIVED (+ `archived_at`),
   leaves the sibling version PUBLISHED, keeps the snapshot byte-identical, and writes exactly one
   archive audit.
4. a second organisation is rejected (typed conflict) when it tries to claim a slug already owned
   by another org's lineage; the loser stays APPROVED with no snapshot, no index row, no publish
   audit.
5. a **real concurrent** first-publication race (`Promise.all`) for one global slug yields exactly
   one winner; the loser rolls back completely.
6. **RPC identity guard**: a `render_json` whose `public.slug` ≠ the frozen lineage slug, or whose
   `public.version` ≠ the manual version, or a `p_public_version` ≠ the locked
   `manual_versions.version`, is rejected with a typed `stale content` error and rolls back fully
   (still APPROVED, no snapshot, no index row, no publish audit); a rebuilt snapshot with the
   frozen slug + correct version then succeeds.

Full `tests/integration` run: **130 passed, 0 failed, 0 skipped** — Phase 6 regression intact
(ADMIN-only publish, wrong-state reject, reviewed-content-hash integrity, required-MISSING block,
publish-blocking WARNING block, non-blocking WARNING allowed, real transaction rollback, immutable
snapshot, archive, audit exactly once, `service_role` cannot mutate `audit_events`, clone + review
workflow unaffected).

### Browser (DEV fixture, unauthenticated)
`/manual/p7-browser-demo/1.0.0` (PUBLISHED) → 200, cover + sections render via `ManualRenderer`,
no reviewer / checklist / audit chrome, no banner. `/manual/p7-browser-demo/2.0.0` (ARCHIVED) →
200 + neutral banner + "Lihat versi terbaru." → `/manual/p7-browser-demo/1.0.0`. Unknown slug and
never-published version → 404 (also `/manual/beta-ea/1.0.0` → 404: a non-claimed slug never
resolves). HTML scan: **no** `PRIVATE-STORAGE-SENTINEL-XYZ`, no database UUID, no `storageKey` /
`content_hash` / `render_json`. Responsive smoke at 375 / 768 / 1024 / 1440: at every width
`document.documentElement.scrollWidth === clientWidth` (no document-level horizontal scroll),
`.a4-document` stays inside the viewport, the archived banner is one line, PUBLISHED shows no
banner. Fresh production + fresh dev session: the public route console has no errors, warnings, or
favicon 404.

### Final gates
`npm run lint`, `npm run typecheck`, `npm run test` (405 passed), `npm run build`, and
`npx vitest run tests/integration` (130 passed, 0 skipped) all green.

---

# Slice 2 — public TOC, in-page search, version navigation (AC-P7-3)

Adds the public reading controls on top of the Slice-1 route. The Slice-1 security boundary is
unchanged: the route still reads ONLY `public_manuals` / `public_manual_versions` /
`published_snapshots`, and the raw snapshot never crosses to a client — the TOC / search / version
controls receive only small sanitized models derived from the already-sanitized `ManualViewModel`.
No migration (27 local == 27 remote).

## Deterministic public chapter anchors

`chapterAnchor(index) => "chapter-<index>"` in `lib/manual/view-model.ts` is the ONE anchor helper.
`ManualRenderer` puts it on each chapter `<section id>` (harmless + valid in the workspace preview
and future PDF too); `buildToc` and the search index use the same helper. Anchors are position-
based within the immutable snapshot — no `section.key`, no database id in the DOM. `.manual-page`
gets `scroll-margin-top: 104px` so a deep-linked chapter lands just below the sticky header, and
`html:has(.pm-shell) { scroll-behavior: auto }` makes anchor jumps instant (no dependency on
smooth-scroll running).

## Table of contents

`buildToc(vm)` (`lib/publication/toc.ts`) — a pure `vm.sections.map` to `{ number, title, anchor }`
in the exact `ManualRenderer` order; no second chapter list. `PublicToc` (client) renders a
desktop sidebar `<nav aria-label="Daftar isi">` and a native `<details><summary>Daftar Isi` for
≤900px from the same array; the mobile `<details>` collapses itself after a chapter is chosen
(found via `event.currentTarget.closest("details")`, no ref). Links are real `#chapter-N`
fragments, so deep-linking and no-JS navigation work without the component.

**Active-chapter tracking** — a client-only effect: an `IntersectionObserver` (primary trigger) +
a passive rAF-throttled `scroll` / `resize` listener (fallback), both calling one pure
`recompute()` over live `getBoundingClientRect().top`. Active = the LAST chapter whose top has
crossed a reading line 140px down — deterministic by position, never by callback order (tall A4
sections mean several are on screen at once). The observer disconnects and listeners/rAF are
cancelled on cleanup. The active TOC item carries `aria-current="location"` and is styled with a
left border + bold weight (not colour alone).

## In-page search

Client-side, within ONE published snapshot — no DB FTS, no API endpoint, no dependency.
`buildPublicSearchIndex(vm)` (`lib/publication/search-index.ts`, pure) walks `vm.sections` in
document order into publication-safe `{ anchor, chapter, kind, text }` rows. Indexed (what the
reader sees): chapter titles (`Bab`), text + callout rich text via the existing
`richTextToPlainText` (`Teks` / `Catatan`), steps title/instruction/menuPath (`Langkah`), FAQ
question + answer (`FAQ`), resolved parameter tables — group name + every parameter's
displayName / technicalName / type / default / unit / safeRange / description / orderEffect
(`Parameter`), and supported-configuration symbol / timeframe / preset / tested-minimum-lot for
the `requirements` / `presets` chapters (`Konfigurasi`). NOT indexed: the changelog (the renderer
does not render it), raw `eaVersion.requirements` / `support` jsonb, images, and — structurally —
anything from `reviews` / `audit_events` / `checklist_results` / `ai_revisions` (the adapter never
reads them).

`searchPublicIndex(index, query)` (pure) — case-insensitive, whitespace-normalized substring
match; a bounded snippet (≤ ~40 chars before / ~60 after the hit, ellipsed); results in document
order (no relevance scoring). `ManualSearch` (client) renders a real `<input type="search">` with
an `sr-only` label ("Cari di manual"), a clear button, an `aria-live="polite"` result count, a
"Tidak ada hasil." empty state, and a results list of `#chapter-N` links; the query term is
`<mark>`-highlighted **in the snippet only** (the document DOM is never mutated). **Cmd/Ctrl+K**
focuses the field unless an `INPUT` / `TEXTAREA` / `SELECT` / contenteditable already has focus.

## Version switcher

`getPublicManual` now also returns `publishedVersions: { publicVersion, publishedAt }[]` — every
still-PUBLISHED version of the lineage, newest first by **`published_at DESC`** (publication
chronology, never a lexical semver sort). ARCHIVED rows are excluded from that list by the query.
`VersionNav` (server component, plain `<a>` links = no-JS, crawlable) renders `<nav aria-label="Versi
manual">`: on a PUBLISHED page the current version is marked `aria-current="page"`; an older
PUBLISHED version stays in the list and is directly addressable (200), the switcher never forces a
redirect to latest. On an ARCHIVED direct URL the archived version is shown separately —
"Versi yang sedang dilihat: X.Y.Z — Diarsipkan" — and NOT re-added to the active list; the
still-PUBLISHED versions are listed below, or a neutral "Belum ada versi terbit lain" if none.
Links always use the FROZEN `public_manuals.public_slug`.

## Accessibility

`<a class="pm-skip" href="#manual-content">Langsung ke isi manual</a>` (visible on focus) →
`<main id="manual-content" tabIndex={-1}>`. `<nav aria-label="Daftar isi">` and
`<nav aria-label="Versi manual">` landmarks; search input has an `sr-only` label + `aria-controls`
/ `aria-describedby`; result count is `aria-live="polite"`; active chapter is border + weight +
`aria-current`, not colour alone; visible `:focus-visible` outlines on links / summary / input;
the mobile summary is a ≥44px touch target.

## Tests

**Unit** — `tests/unit/publication-toc.test.ts` (order == `vm.sections`, 1-based numbering,
deterministic anchors, duplicate titles → unique anchors, custom + empty chapters included, blank
title fallback) and `tests/unit/publication-search-index.test.ts` (chapter titles + rich text +
steps + FAQ + parameters + configs indexed in document order; changelog / raw jsonb / private
sentinels / UUIDs absent; `searchPublicIndex` case-insensitive, whitespace-normalized, no-match →
`[]`, multiple matches in document order, bounded snippet, result carries chapter + anchor + kind
only). **419 unit tests pass.**

**Live integration** — `tests/integration/rls.test.ts` "Phase 7 slice 1" gains one test: a
lineage published as 1.0.0 / 1.1.0 / 2.0.0, then 1.1.0 archived, then the EA product renamed —
the exact switcher query (`public_manual_versions` WHERE `publication_state = 'PUBLISHED'` ORDER BY
`published_at DESC`) returns `["2.0.0", "1.0.0"]` (1.1.0 excluded, still directly addressable as
ARCHIVED), and every version's `published_snapshots.public_slug` + `render_json.public.slug` stays
the frozen slug, nothing under the renamed slug. **131 passed, 0 failed, 0 skipped**; full Phase 6
+ Slice 1 regression intact.

**Browser** (DEV fixture `p7-slice2-demo`, 6 chapters, 1.0.0 PUBLISHED / 1.1.0 ARCHIVED / 2.0.0
PUBLISHED, private sentinels planted in `review_comments` + `audit_events` + `render_json`
`storageKey`) — verified on a clean production build (`next start`): TOC renders (desktop + mobile
`<details>`); TOC chapter click and `#chapter-N` deep-link (fresh load) both scroll the target to
`top: 104`; search (`kelinci`, `metatrader`, `File`) returns kind-tagged results with `<mark>`
snippets, count, and clear button; **Cmd+K** focuses the search input; the mobile `<details>`
opens, lists all chapters, and collapses after navigating; the version switcher lists
`2.0.0` (current) + `1.0.0` and never `1.1.0`; the ARCHIVED page shows the banner + the
"sedang dilihat … Diarsipkan" line + the two PUBLISHED versions; unknown version → 404. HTML +
RSC-payload scan on every page: **no** `PRIVATE-STORAGE-SENTINEL` / `PRIVATE-REVIEW-SENTINEL` /
`PRIVATE-AUDIT-SENTINEL` / `PRIVATE-CHECKLIST-SENTINEL`, no database UUID, no `storageKey` /
`content_hash` / `render_json`. Responsive 375 / 768 / 1024 / 1440: at every width
`documentElement.scrollWidth === clientWidth`, `.a4-document` inside the viewport, TOC + search +
version nav reachable, snippet + chapter titles wrap (`overflow-wrap: anywhere`); at 375 the mobile
TOC opens → selects → collapses. Fresh production + fresh dev session: **console has no errors,
warnings, hydration errors, or favicon 404**.

**Not verified live:** the active-chapter highlight *updating during scroll*. The implementation
follows the spec (IntersectionObserver + rAF-throttled scroll fallback, deterministic, cleaned up)
and its `recompute` logic was confirmed by hand in-page (right answer at the right scroll
position), but the Browser-pane automation keeps `document.visibilityState === "hidden"`, and per
the web spec a hidden document suspends `requestAnimationFrame` and throttles `IntersectionObserver`
— an in-page probe recorded 0 scroll events for a 4500px programmatic scroll. A real (visible)
browser runs it.

## Ponytail / simplicity decisions (Slice 2)

| Decision | Why |
|---|---|
| **One `chapterAnchor` helper in `view-model.ts`** | Renderer + TOC + search all import it; the renderer's `lib` dependency stays neutral (not `lib/publication`). |
| **Native `<details>` for the mobile TOC** | Keyboard + touch + no-JS for free; no drawer component, no focus-trap code. |
| **Version switcher is a server component of plain `<a>`** | No-JS navigation, crawlable URLs, correct history — no client router imperative code. |
| **Search index built server-side, matching + snippet in a pure module** | The client component only renders; all logic is unit-tested; no fuzzy-search dependency. |
| **`<mark>` in the snippet, not in the document body** | No post-hydration TreeWalker, no React hydration conflict — and AC-P7-3 doesn't need body marks. |
| **`scroll-behavior: auto` scoped via `html:has(.pm-shell)`** | Instant, reliable anchor jumps for a long reference doc; scoped so the workspace keeps its smooth scroll. |
| **rAF-throttled `scroll` listener alongside IntersectionObserver** | IO is "preferred" but a scroll fallback (no `setInterval`, idle = zero work) makes active-tracking robust where IO is starved. |

---

# Slice 3 — published image delivery (AC-P7-8)

Serves published-manual images without ever making the private `manual-images` bucket public,
without a Supabase signed URL in the browser, and without exposing `storageKey` / `image_assets.id`
/ org id / snapshot id. The `manual-images` bucket, the `<org>/<asset>.<ext>` key format, and
`upsert: false` uploads are unchanged. No migration (27 local == 27 remote).

## Same-origin image proxy

`GET /manual/[eaSlug]/[version]/image/[idx]` — `app/manual/[eaSlug]/[version]/image/[idx]/route.ts`,
a Node route handler (no client component). The browser only ever sees `slug` / `version` / a
numeric index. The handler:

1. `parseImageIndex(idx)` — canonical non-negative base-10 only (`^(0|[1-9][0-9]{0,4})$`); rejects
   `-1`, `1.2`, `1e2`, `01`, `abc`, huge values → 404, no `parseInt` partial parse.
2. `getPublicImageDescriptor(slug, version, idx)` — resolves through the SAME verified-snapshot
   boundary as the page (see below); `null` for an unknown publication OR an out-of-range index,
   and the route returns 404 **before touching Storage** in both cases.
3. `mimeForStorageKey(storageKey)` — MIME from the key extension, allowlist-gated (`png` / `jpg` /
   `jpeg` / `webp` / `gif`); anything else → 404.
4. `service.storage.from("manual-images").download(storageKey)` — the route streams the bytes
   itself; it never issues a signed URL and never 302s. The object's own content type wins when it
   is an allowed image, else the extension MIME; `text/html` / `image/svg+xml` /
   `application/octet-stream` are never reflected.
5. Response: `Content-Type: image/<allowed>`, `Cache-Control: public, max-age=31536000, immutable`,
   `X-Content-Type-Options: nosniff`, `Content-Length`. No Supabase headers, no `storageKey`.

Every failure is a bare `404` ("Not Found"), or a generic `500` for a corrupt snapshot — no
"exists but index missing" / "object deleted" / "wrong org" distinction, no enumeration signal.
Server logs on failure carry only request id / slug / version / numeric idx — never the storage
key, a token, a signed URL, or bytes.

## Server-only verified-snapshot boundary

`getPublicManual` was refactored to share `loadVerifiedPublishedSnapshot(slug, version)` with the
image route — a SERVER-ONLY function (`import "server-only"`) that resolves
`public_manuals → public_manual_versions → published_snapshots`, re-verifies
`computeSnapshotHash(render_json) === content_hash`, and returns the RAW json. `getPublicManual`
sanitises it (`snapshotToViewModel` — no `render_json` / `storageKey` / DB id crosses to a client);
`getPublicImageDescriptor` resolves one descriptor (with its private `storageKey`) for the route.
The public projection model is unchanged from Slice 1 — it was NOT weakened to give the route
access.

The image path queries ONLY `public_manuals` / `public_manual_versions` / `published_snapshots` +
the Storage bucket. It never queries `image_assets` (or any working / review / checklist / audit
table) at request time — **the immutable snapshot defines which object is allowed**.

## Canonical image index — `snapshotImageDescriptors(renderJson)`

The ONE ordering, shared by `snapshotToViewModel`, the proxy route, and any future print/PDF page,
so the adapter's `imageRef N` and the route's `/image/N` always resolve the same object:

- **v2** — the exact top-level `snapshot.images[]` produced by `buildPublishedSnapshot`, in order,
  never reordered (`imageRef 0 → images[0]`, …).
- **v1** — legacy `content.images` keyed by asset id, in **sorted-key** order (the same rule the
  Slice-1 adapter used); the descriptor also carries `sourceKey` so the adapter can map a v1 block
  / step UUID → `img-<i>`. A unit test proves the adapter and the helper produce identical indices
  for both v2 and v1.

## Public `ManualViewModel` image URLs

`snapshotToViewModel` now sets each `vm.images["img-<i>"].signedUrl` to
`publicImageUrl(slug, version, i)` = `/manual/<encoded-slug>/<encoded-version>/image/<i>` when the
descriptor has a `storageKey`, else `null` (renderer shows its `[gambar belum tersedia]`
placeholder). The property keeps the shared name `signedUrl` — its PUBLIC value is now a
same-origin proxy path, not a Supabase URL. The one `ManualRenderer` is unchanged in how it
consumes it: workspace preview still gets temporary Supabase signed URLs, the public route gets
proxy URLs, and the renderer never knows the difference.

## Image + step-image rendering

`ManualRenderer` switched its `<Image>` (next/image, `unoptimized`, hard-coded 960×540) to a plain
`<img loading="lazy">` for both the image block and, now, **step images** — the URL is a
proxy/signed path with no optimisation to gain and the fixed dimensions were distorting portrait
sources; a plain `<img>` with `width: 100%; height: auto` keeps every orientation's natural aspect.
A step whose `imageRef` resolves to a snapshot image with a URL renders a `<figure class="manual-
step-image">` inside the step; a step image with no object simply renders nothing (the step and the
rest of the manual are never affected). `SnapshotAdapterMeta` alt/caption come from the frozen
snapshot only — `image_assets.alt_text` / `.caption` are never re-read (integration test publishes
with a snapshot alt that differs from a live `image_assets` row and asserts the snapshot value
wins). `features/manuals/data-source.ts` now also collects `steps[].imageAssetId` so the workspace
preview shows step images too.

## Failure semantics (honest)

- Known-empty descriptor (`storageKey` null in the snapshot) → adapter gives `signedUrl: null` →
  renderer shows the accessible `[gambar belum tersedia]` placeholder; the page is still 200.
- Object deleted from Storage AFTER publish → the proxy route 404s that one `/image/<idx>`; the
  browser shows its own broken-image state; the manual page stays 200. One missing image never
  becomes a 500 for the whole manual.
- Corrupt / hash-mismatched snapshot → the route returns a generic 500 with no DB detail (same
  boundary as the page).

## Cache assumption

`Cache-Control: public, max-age=31536000, immutable` is safe because the URL is version-addressed
and normal app code writes a random final storage key with `upsert: false` and never overwrites an
existing `manual-images` object. It does NOT protect against an out-of-band storage administrator
replacing bytes at the same key — that is outside the application trust boundary.

## Security evidence (AC-P7-8)

- **Private bucket** — a direct `GET <supabase>/storage/v1/object/public/manual-images/<key>` and
  `.../object/authenticated/...` (no token) both return **400**; the Next proxy returns **200** for
  the same object. An anon Supabase Storage client `.download(key)` is denied (integration test).
- **No storage-key / sentinel leak** — the fixture's storage keys contain
  `PRIVATE-STORAGE-P7-S3-SENTINEL`; it appears in `render_json.images[].storageKey` server-side but
  is **absent** from the page HTML, the RSC/client payload, the DOM, every `<img src>`, and every
  response header. `storageKey` / `supabase` / `/object/sign` / `/object/authenticated` /
  `content_hash` / `render_json` and every database UUID are likewise absent.
- **Byte consistency** — SHA-256 of the proxy response (via `curl` and a page-context `fetch`)
  equals SHA-256 of the uploaded object exactly, for both a 960×540 PNG and a portrait PNG; no
  transcoding.
- **Same-origin only** — the browser network log shows only `GET /manual/<slug>/<version>/image/<n>`
  requests; **zero** requests to `*.supabase.co/storage/...`, `/object/sign`, `/object/authenticated`,
  and no 302 to a signed URL.
- **Isolation** — out-of-range (`/image/2`, `/image/999999` on a 2-image / 1-image snapshot) →
  404; non-canonical idx (`01`, `-1`, `1.5`, `abc`) → 404; unknown slug / unknown version → 404.
  Cross-version: v2's `/image/0` resolves to v2's object, never v1's (integration). Cross-org:
  an org-A publication's descriptors only ever reference `<org-A>/…` keys; the only selector is
  snapshot + idx (no `?storageKey=` / `?assetId=`, no bucket enumeration).
- **Archived** — `/manual/<slug>/<archived-version>/image/<idx>` → 200 with byte-identical content;
  the archive transaction does not touch the snapshot or its image objects.

## Tests

**Unit** — `tests/unit/publication-snapshot-image.test.ts` (v2 = top-level order, v1 = sorted-key
+ `sourceKey`, malformed → `[]`; adapter ↔ descriptor index equality for v2 and v1; `publicImageUrl`
is a same-origin path with no storage key; `parseImageIndex` canonical-only; `mimeForStorageKey`
+ `IMAGE_MIME_ALLOWLIST` exclude svg/html/octet-stream) and updated `publication-view-model.test.ts`
(image `signedUrl` is a `/manual/.../image/<idx>` proxy path, never a Supabase URL / `storageKey`).
**429 unit tests pass.**

**Live integration** — `tests/integration/rls.test.ts` "Phase 7 slice 1" gains a Slice-3 test on
real DEV Storage: uploads a PNG + a GIF (org A) and a PNG (org B) + an `image_assets` row with
divergent live alt/caption; publishes a 2-version lineage (v1 → [PNG, GIF], v2 → [GIF]); asserts
hash re-verification, `storageKey` present in `render_json` but absent from the sanitized adapter
output (with proxy URLs instead), descriptor order == uploaded order, **SHA-256 of each downloaded
object == the uploaded bytes**, MIME per extension, cross-version + cross-org isolation, archived
snapshot byte-identical, snapshot-frozen alt (not the live `image_assets` value), and the anon
Storage client denied. **132 passed, 0 failed, 0 skipped**; full Phase 6 + Slice 1/2 regression
intact.

**Browser** (DEV fixture `p7-slice3-demo`: a 960×540 image block + a 360×560 step image, PUBLISHED
1.0.0 + ARCHIVED 1.1.0) — `curl` and page-context `fetch` of `/image/0` + `/image/1` return 200
with the exact header set and byte-exact SHA-256; error cases (`/image/2`, `/image/999999`,
`/image/01`, `/image/-1`, `/image/1.5`, `/image/abc`, unknown slug, `/9.9.9/...`) all 404; the page
HTML has no sentinel / storageKey / UUID and every `<img src>` is the proxy path with a real
`alt`, `<figure>`/`<figcaption>` for the block image, no `[gambar belum tersedia]`; the network log
shows only same-origin `/image/<n>` requests. Responsive 375 / 768 / 1024 / 1440:
`documentElement.scrollWidth === clientWidth`, image + step-image boxes stay inside `.a4-document`,
caption `overflow-wrap: anywhere`. Console: one 404 (the deliberate `/image/2` probe), no React /
hydration errors.

**Not verified live:** the literal pixel decode (`img.naturalWidth > 0`). The Browser-pane
automation keeps `document.hidden === true`, which suspends `<img>` loading/decoding per the web
spec (`img.decode()` never resolves). The bytes are proven valid and byte-exact at the network
layer and the `<img src>` is correct, so a visible browser renders them; the exact-aspect
behaviour for the portrait step source relies on the browser following the natural ratio under
`height: auto`.

---

## Ponytail / simplicity decisions (Slice 3)

| Decision | Why |
|---|---|
| **One `snapshotImageDescriptors` helper** | The adapter and the proxy route MUST agree on `imageRef N`; a shared pure function is the only way to guarantee it. |
| **`loadVerifiedPublishedSnapshot` extracted, not duplicated** | The route needs the raw verified snapshot; `getPublicManual` needs it sanitised — one loader, two projections, the server-only barrier kept. |
| **Route downloads + streams bytes; no signed URL / redirect** | The private bucket stays private and no Supabase URL / token / bucket path ever reaches the browser — direct AC-P7-8. |
| **Plain `<img>` in the renderer, not `next/image`** | `unoptimized` means next/image adds nothing here; its fixed `width`/`height` distorted portrait sources. `<img>` + `width:100%;height:auto` is correct for every orientation. |
| **MIME from the key extension, object type only as an allowed override** | The extension was set from the validated `file.type` at upload — it's the trusted signal; never reflect an arbitrary stored `Content-Type`. |
| **No Range handling** | Manual images are small; `Content-Length` + full body is enough. |
| **`parseImageIndex` is a regex, not `Number()` alone** | Rejects `01`, `1e2`, ` 1`, `+1` etc. — canonical base-10 only, no enumeration via odd forms. |

---

## Ponytail / simplicity decisions (Slice 1)

| Decision | Why |
|---|---|
| **Two index tables, not display duplication** | `public_manuals` owns only the global slug + lineage pointer; every display value comes from the immutable snapshot. Nothing to keep in sync on an EA rename. |
| **`CREATE OR REPLACE` the Phase-6 RPCs in the new migration** | The index writes must be in the SAME transaction as the publish/archive; a separate RPC could not be atomic with it. Bodies are re-issued verbatim + additions only. |
| **Write boundary via grants, not RLS write policies** | SELECT-only grant → no PostgREST write path for anyone; the `SECURITY DEFINER` RPC (owner `postgres`) writes with owner privilege. One `BEFORE UPDATE` transition guard is the only trigger. |
| **`snapshotToViewModel` is a pure function, reusing the one `ManualRenderer`** | No second renderer, no DB access in the adapter, unit-testable in isolation. |
| **`force-dynamic`, no `generateStaticParams`, no cache decoration** | Slice 1 keeps caching trivial; an immutable-snapshot server cache keyed by `published_snapshot_id` is a later optimisation only if a straightforward Next primitive fits. |
| **v2 strips identity UUIDs at build time** | The adapter discards them anyway; removing them at the source makes the snapshot UUID-free by construction and the leak surface smaller. |
| **RPC identity guard needs `02600`, not app-only** | `02500`'s RPC never inspects `p_render_json`; the defensive DB check did not exist. A new `CREATE OR REPLACE` migration is the only way to add it without rewriting `02500`. The guard reads `p_render_json` but never mutates it. |
| **Step images reuse the image-block ref namespace** | One deterministic ordered array, one `imageRef` convention — the future image proxy resolves step and block images identically. |

---

## Acceptance criteria

**AC-P7-2** — PASS. The route reads only the three publication tables via `getPublicManual`;
PUBLISHED / ARCHIVED / 404 semantics verified in the browser; global slug ambiguity resolved by
`public_manuals`; the RPC identity guards (`02600`) plus the security + collision integration tests
close the write side.

**AC-P7-3** — PASS. The public manual shows a table of contents (deterministic anchors, active-
chapter tracking, accessible mobile `<details>`), a working in-page search (client-side over the
sanitized snapshot, kind-tagged results, `<mark>` snippets, Cmd/K), and a version switcher that
lists every currently-PUBLISHED version newest-first; older PUBLISHED version URLs still resolve
200 and stay in the switcher; ARCHIVED versions are shown separately and remain directly
addressable. Unit + integration + browser evidence above. (The active-highlight scroll update is
implemented to spec but could not be exercised in the hidden automation pane — see "Not verified
live".)

**AC-P7-8** — PASS. Published images are served from a controlled same-origin proxy
(`/manual/<slug>/<version>/image/<idx>`) that streams bytes from the still-private `manual-images`
bucket after snapshot-membership authorisation. The browser issues no request for a private draft
object: network shows only same-origin `/image/<idx>` requests, direct Supabase Storage URLs are
400, storage keys / signed URLs / bucket paths never leave the server, and byte-for-byte SHA-256
matches the uploaded object. Unit + integration + browser evidence above; the only unverified bit
is the literal pixel decode in the hidden automation pane.

**AC-P7-5 / 6 / 7** — PASS (rendering + pagination + filename), evidence in the Slice 4 section.
**AC-P7-9** — the PDF path is correct and under the response cap, but **blocked on the concurrency
decision** (a shipped export endpoint that 502s under two simultaneous users is not "read as PDF"
delivered). Verdict deferred to the platform/architecture decision.

**AC-P7-4 / 10** remain partial — full web/PDF content parity sign-off and the regulatory-copy
sweep are later slices (Slice 4 adds strong evidence toward both: the PDF renders from the SAME
`ManualRenderer` as the web route, and the deployed-PDF byte scan finds no regulatory claims).

---

# Slice 4 — deterministic PDF export (AC-P7-5, AC-P7-6, AC-P7-7, AC-P7-9)

A published manual is exportable as a deterministic A4 PDF built from the **same `ManualRenderer`**
as the web route — no second content renderer, no second assembler. Generation is server-side
headless Chromium (`playwright-core` + `@sparticuz/chromium`) driving a signed, server-only print
page. No migration (27 local == 27 remote); `02500` / `02600` untouched.

## Pieces

| File | Role |
|---|---|
| `lib/pdf/print-token.ts` | HMAC-SHA256 token binding `eaSlug` + public `version` + a ~120 s expiry, signed with server-only `PDF_PRINT_SECRET`. Constant-time verify, plain boolean — the print page turns *any* failure into a generic 404. Format `<expMs>.<base64url(hmac)>` (exp is inside the signed payload). **Transport: the `x-smartin-print-token` request header on the single print-document navigation only — NEVER the URL query string** (URLs are persisted by platform request logging), never HTML / RSC payload / PDF / response header / any subrequest. `PRINT_TOKEN_HEADER` is exported and kept distinct from `x-vercel-protection-bypass`. |
| `lib/pdf/print-origin.ts` | `resolveTrustedPrintOrigin()` — the ONLY origin Chromium may navigate to. Read from server-controlled env only (`VERCEL_URL` / `VERCEL_BRANCH_URL` validated `*.vercel.app`, or a validated `APP_URL`); **never** a request `Host` / `X-Forwarded-Host`. `buildPrintUrl(slug, version)` percent-encodes slug + version and only ever appends `/manual/<slug>/<version>/print` — **no query string, no credential in the URL**. |
| `lib/pdf/chromium.ts` | Env-aware launch. Serverless → `@sparticuz/chromium` with its own `chromium.args` + `--font-render-hinting=none`; binary path resolved **once per instance**. (`setGraphicsMode = false` and `--disable-dev-shm-usage` were both tried and *regressed* launch stability on this project's Fluid instances — reverted.) Local → `PDF_LOCAL_CHROMIUM_PATH` (no hard-coded Mac path in source). |
| `lib/pdf/generate.ts` | `generateManualPdf()` — launches Chromium, serves the print page's image requests **in-process** (see below), waits for real readiness (`document.fonts.ready` + every `<img>` decoded, each with 2 reload retries, 45 s bound), prints A4 with backgrounds + a page-number footer, byte-normalises volatile metadata. Browser always closed in `finally`. Module-scoped promise queue → **one Chromium per process**. |
| `lib/pdf/normalize.ts` | Byte-length-preserving rewrite of the only non-deterministic fields Chromium emits — Info `/CreationDate` + `/ModDate` (set to `D:…` derived from **`publishedAt`**, never `new Date()`), and the trailer `/ID` (Skia/PDF emits none — treated as already-normalised). Same-length replacement keeps every xref offset valid. |
| `lib/pdf/filename.ts` | `pdfFilename(eaName, version)` → `Manual_<EAName>_v<X.Y.Z>.pdf`; strips control / quote / path / wildcard chars, collapses whitespace to `_`. `contentDisposition()` → RFC 6266 `attachment` with ASCII `filename` + UTF-8 `filename*`. |
| `lib/publication/public-image-bytes.ts` | `loadPublicImageBytes` (one image, one verified snapshot read — used by the Slice-3 proxy route) and `openPublicImageSource` (**verify the snapshot ONCE**, then serve many images by index — used by the generator). |
| `app/manual/[eaSlug]/[version]/print/page.tsx` | **RSC page** (not a route handler). Reads the `x-smartin-print-token` header via `next/headers` → `verifyPrintToken` → `getPublicManual` → `<main className="pdf-shell"><ManualRenderer/></main>`. A legacy `?t=` query param is ignored entirely. No nav chrome, no TOC / search / version switcher, no download button. `force-dynamic`, `robots: noindex`. |
| `app/manual/[eaSlug]/[version]/pdf/route.ts` | Public endpoint (PUBLISHED **and** ARCHIVED — PRD "read on the web or as PDF"). `runtime="nodejs"`, `maxDuration = 300`. Resolves publication → mints a 120 s print token → builds the **clean** print URL → passes URL + token separately to `generateManualPdf` (which injects the token as a header on the print nav) → streams `application/pdf` as an attachment. Failure → clean `502` / `503`, never a partial body. |
| `components/public-manual/pdf-download-button.tsx` | One shared client control (workspace preview toolbar + public reading header). `fetch` the endpoint → indeterminate **"Menyiapkan PDF…"** (no fake %) → blob download on 200 → **"Coba lagi"** on failure. |
| `next.config.ts` | `serverExternalPackages: ["playwright-core", "@sparticuz/chromium"]`; `outputFileTracingIncludes` for `/manual/**/pdf` pins `@sparticuz/chromium/bin/**` **and** all of `playwright-core/**` (the file tracer misses `playwright-core/browsers.json`, loaded via a computed path — a hard 500 on Vercel until pinned). `headers()` adds `Referrer-Policy: no-referrer` + `X-Robots-Tag: noindex, nofollow` to `/manual/:eaSlug/:version/print`. |
| `vercel.json` | `functions."app/manual/[eaSlug]/[version]/pdf/route.ts"` → `maxDuration: 300`. (`memory` is **ignored** on this project — Fluid Compute / Active-CPU billing manages it; the deploy log says so explicitly.) |

## Actual Vercel runtime (this project, measured — not assumed)

- Plan: **Hobby** (`vercel deploy` rejected `memory: 3009` — *"limited to 2048 mb for personal accounts (Hobby plan)"*).
- **Fluid Compute is active** — deploy warns *"Provided `memory` setting in `vercel.json` is ignored on Active CPU billing"*. Concurrent invocations share one instance and its memory budget + `/tmp`.
- Function runtime Node.js **24.x**, region **iad1**.
- `maxDuration = 300` is honored (Fluid default). Observed cold PDF wall time ≤ 20 s, warm 6–15 s — comfortably inside it.
- Deployment Protection: **on** for Preview. Automation bypass via the `x-vercel-protection-bypass` **header** (sourced from `VERCEL_AUTOMATION_BYPASS_SECRET`); the secret is never a query param, never logged, never in the PDF/HTML. Playwright's context sends it on the print-page navigation; image subrequests never leave the process so they need no bypass.

## In-process image serving (why the print page's `/image/N` never hits the network)

The print page uses the unchanged `ManualRenderer`, so its `<img>` src values are the Slice-3
proxy paths `/manual/<slug>/<version>/image/<idx>`. The generator registers two `context.route`
handlers: one matches the **exact** print-document URL and injects the `x-smartin-print-token`
header (nothing else gets it); the other matches `/image/<idx>` and resolves it **in-process** from
`openPublicImageSource` (one verified snapshot load, then a Storage download per index),
`route.fulfill`-ing the bytes. The image handler removes a fan-out of N extra serverless-function
invocations per PDF (each its own cold start + its own Deployment-Protection check) that made
image-heavy generation time out under any concurrency. The Slice-3 `image/[idx]` route still
exists unchanged for the web reader and shares the same `loadPublicImageBytes` core.

## Determinism (idempotence gate)

`page.pdf()` output for the same HTML + same Chromium + same viewport is byte-identical except
Info `/CreationDate`, `/ModDate` and the trailer `/ID`. `normalizePdf(pdf, publishedAt)` rewrites
those in place, same length, deriving the date from the immutable `publishedAt`. **Never**
`new Date()` — that is the whole point of the gate.

Deployed proof (Vercel Preview, isolated/spaced requests). Hashes are **stable across seven
independent deployments** (#9, #12, #13, #14, #16 — including the print-token-header change):

| Fixture | Runs | SHA-256 | Bytes | Pages |
|---|---|---|---|---|
| `p7-pdf-normal/1.0.0` (4 ch, 1 img, 6-row table) | all identical | `9051b2759d…8575679` | 287 493 | 5 |
| `p7-pdf-large/2.0.0` (18 ch, 10 img ≈ 2.6 MB, 3 param groups 24+30+10 rows) | all identical | `7f48294abf…92d0797` | 2 536 304 | 24 |

Wall time on a fresh instance: cold ≈ 13–17 s, warm ≈ 6–15 s (`X-Pdf-Ms` generation ≈ 2–9 s).

(Local spike, `PDF_LOCAL_CHROMIUM_PATH` Chrome-for-Testing: NORMAL `841bf3de…`, LARGE
`408dbced…`, also 3/3 each. Hashes differ **per Chromium build** — @sparticuz 147 vs local — which
is expected; determinism is per-environment.)

## AC evidence (deployed Preview)

- **AC-P7-5 (long-table pagination)** — PASS. `p7-pdf-large` chapter "05 · PARAMETER INTI" starts on
  p8, its 24-row parameter table continues onto p9, and **p9 opens with the repeated dark column
  header `Parameter | Tipe | Default | Rentang aman | Efek pada order`** (`thead {
  display: table-header-group }`). Chapter "06 · PARAMETER MANAJEMEN RISIKO" repeats the pattern
  p10→p11. Verified against extracted PDF text **and by rasterising p8/p9 at 125 dpi** — the header
  row is visually present on both pages, no horizontal clipping, table fills to the 14 mm margin.
- **AC-P7-6 (figure + caption cohesion)** — PASS. All 10 figures: the raster image AND its
  `Gambar N — …` caption land on the **same page**, inside one bordered figure card
  (`break-inside: avoid` on `figure`). No split. Confirmed visually on p3 (Gambar 1) and p24
  (Gambar 10).
- **AC-P7-7 (filename, SHOULD)** — PASS. `Content-Disposition: attachment; filename="Manual_Large_Book_EA_v2.0.0.pdf"; filename*=UTF-8''…`. Unit-tested sanitiser (spaces→`_`, strips `" / \ : * ? < > |`, CR/LF/control).
- **AC-P7-9 (web OR PDF)** — PASS. `/manual/<slug>/<version>/pdf` returns `application/pdf` for a
  PUBLISHED or ARCHIVED manual, generated from the same snapshot + same renderer as the web page.
  2.42 MiB for the image-heavy fixture — **under the 4.5 MiB (4 718 592 B) Vercel Function response
  cap** by 2.18 MiB, so a direct response is viable; no artifact-storage architecture needed.
- **Visual validation** (LARGE, rasterised at 125 dpi — cover, ch00, table-before-break p8,
  table-after-break p9, figure p3, step p6, callout p17, final p24): A4 596×843 pt, symmetric
  ~14 mm margins, readable body text, no horizontal overflow (rightmost content 556 pt of 596),
  no accidental blank pages. Cover shows brand + EA identity + metadata grid + green decoration.
  Warning callout renders with its amber background (`print-color-adjust: exact`). Short pages p6
  / p24 are intentional `break-inside: avoid` keep-together overflow (a whole step / a whole
  figure+caption pushed to a fresh page), not malformed pages.
- Cover is its own page; every chapter starts on a fresh page (`break-before: page`); no trailing
  blank page (the old `page-break-after: always` on `.manual-page` is overridden to `auto` inside
  `.pdf-shell`); page-number footer only — **no date, no URL, no token, no regulatory word**.

## Security evidence

- **Print token is out of the URL entirely.** Before: `buildPrintUrl(slug, version, token)` →
  `…/print?t=<HMAC>`, which Vercel request logging persists. After: `buildPrintUrl(slug, version)`
  → clean `…/print`; the generator's `context.route` handler for that exact URL injects
  `x-smartin-print-token: <HMAC>` on the one navigation. **Runtime-log scan** (deploy #14, forced
  failing print/PDF calls included): every `/print` log line is the bare path — `grep` for `?t=`,
  `x-smartin-print-token`, `SHOULD-NOT-BE-LOGGED` sentinel, `PDF_PRINT_SECRET`, or an
  `<epoch>.<b64>` pattern → **ZERO hits**.
- Signed print page denial matrix (deployed, header transport): no header / empty header / garbage
  header / expired-shaped header → **404**; a legacy `?t=` in the URL → **404** (ignored). All with
  `Referrer-Policy: no-referrer` + `X-Robots-Tag: noindex, nofollow` on the 404 response.
- SSRF: `X-Forwarded-Host: evil.example.com` → byte-identical PDF to the clean run (`9051b275…`,
  origin came from `VERCEL_URL`, not the header); `Host: attacker.example.com` → 404 at the edge.
  Chromium never navigates off the trusted origin.
- Privacy sweep of the deployed PDF bytes + public HTML + print HTML + response headers + function
  logs: **0** hits for `render_json`, `content_hash`, `storageKey`, `supabase.co/storage`,
  `_vercel_jwt`, `PDF_PRINT_SECRET`, `x-vercel-protection-bypass`, `x-smartin-print-token`,
  `reviewed_content_hash`, `service_role`, a print token, or any DB UUID. (One 3-byte `eyJ`
  substring sits inside a compressed image stream — not a JWT.) No regulatory claim (`Approved` /
  `Bappebti` / `Certified` / `Compliant` / `Licensed` / `Registered` / `Guaranteed` → all 0).

## Serverless runtime ceiling — CONCURRENCY HARD GATE NOT MET → architecture decision required

Chromium launches and produces a correct, deterministic PDF **reliably for a single / occasional
export** — spaced isolated requests are 100 % across every deployment (canonical hashes above),
and the visual + pagination + security evidence is all from these.

**The 2-request concurrency hard gate is NOT reliably met on this Vercel plan.** Dedicated
measurement — the exact `Promise.all([getPdf(), getPdf()])` test, 3 isolated rounds with a 45 s
recovery gap between them, no retries:

| Deployment / condition | Round 1 A/B | Round 2 A/B | Round 3 A/B | Result |
|---|---|---|---|---|
| #14, first traffic (vitest HARD GATE) | 200 / 200 | 200 / 200 | 200 / 200 | **PASS** |
| #15, first traffic (vitest HARD GATE) | 200 / 200 | 200 / 200 | 200 / 200 | **PASS** |
| #14, second run (instance warm) | 200 / 200 | 200 / 200 | **502** / 200 | **FAIL** |
| #15, curl matrix (instance warm) | **502** / 200 | **502** / **502** | **502** / 200 | **FAIL** |

Successful concurrent responses are byte-identical (`7f48294abf…`); failures are a clean `502`
(21-byte body, never a partial PDF). So concurrency succeeds **only on a cold instance's first
concurrent pair** and degrades to intermittent `502` as soon as the instance has done prior work.
The failure signature is Chromium **OOM-killed at launch** — `page.evaluate: Target page, context
or browser has been closed` right after `<launching> /tmp/chromium`, or `Page.printToPDF: Printing
failed`. Pushed hard enough, an instance stops responding until Vercel recycles it.

Mitigations applied (all within the agreed architecture): one Chromium per process (module queue),
binary extraction resolved once per instance, in-process image serving (removed the N-invocation
fan-out), per-image reload retries. `setGraphicsMode = false`, `--disable-dev-shm-usage` and a
post-`close()` settle delay were each tried and **reverted** — they regressed launch stability. A
memory-bounded shared Fluid instance is not safe for concurrent synchronous Chromium no matter the
flags.

**Per the Slice 4 plan's HARD-STOP list, the verdict is `STOP — PLATFORM/ARCHITECTURE DECISION
REQUIRED`, not PASS.** The concurrency e2e test asserts strict `200 + 200 + identical bytes` with
no retries and is left failing on a warm instance — that failure is the honest signal. Robust
concurrent PDF export needs one of, **neither to be implemented without approval**:

1. **Vercel plan / runtime upgrade** — Pro gives isolated per-invocation memory and higher limits
   (a user-controlled account change, not a repo change).
2. **Async generation + artifact storage** — generate off the request path, persist the PDF to a
   bucket, return a link (a new persistent-storage architecture + migration).

The export UX keeps "Coba lagi" retry handling for unexpected runtime failures; retry UX is **not**
evidence the gate passed.

## Tests

- **Unit** — `tests/unit/pdf.test.ts` (19): print-token sign/verify/expiry/tamper(slug,version,exp,sig)/malformed + header-name distinct from the bypass header; trusted-origin env-only + hostile-`VERCEL_URL` rejected + `buildPrintUrl` has **no query string**; `pdfFilename` convention + sanitisation + `contentDisposition`; `normalizePdf` same-length date rewrite + missing-`/ID` handling. In `npm run test` (pure, no Chromium).
- **E2E** — `tests/e2e/pdf-endpoint.e2e.test.ts`, dedicated `npm run test:e2e` (`vitest.e2e.config.mts`), **excluded from `npm run test`**. Skips unless `PDF_E2E_BASE_URL` is set. Non-gate tests (well-formed A4 attachment + filename, `< 4.5 MiB`, every *successful* generation byte-identical, no private-identifier leak) retry like the UX. The **`HARD GATE — two concurrent requests`** test asserts strict `200 + 200 + identical bytes` across 3 rounds with **no retries** — it PASSES on a cold instance and FAILS on a warm one (see the ceiling section); that failure is intended signal, not a flake to paper over.
- `npm run test:integration` added as an explicit alias; CI keeps a separate PDF/E2E job so unit runs never pull Chromium.

## Ponytail / simplicity decisions (Slice 4)

| Decision | Why it's enough |
|---|---|
| **One `ManualRenderer`, print page is just `<main class="pdf-shell">` + CSS** | No forked renderer, no PDF-specific view model. `@media print` + `@page` in `globals.css` do the layout. |
| **Print token in a request header, not the URL** | URLs are persisted by platform request logging; a header on the one exact print navigation keeps the credential out of every log / referer / cache. One `context.route` matcher, no infra. |
| **Metadata normalisation, not a deterministic PDF library** | Only 2 fields are volatile and both derive from `publishedAt`; a same-length byte rewrite is smaller and safer than swapping Chromium's PDF engine. |
| **In-process `context.route` for images, DOM URLs unchanged** | Keeps the renderer + print page identical to the web path while removing the function fan-out — the reliability win without a schema change. |
| **Module promise-queue, not a worker pool** | One instance only ever needs one Chromium; Vercel scales by adding instances. `ponytail:` comment marks the upgrade path. |
| **`memory` left in `vercel.json`** despite being ignored | Documents intent + the exact platform message; harmless, and correct the moment the project moves off Active-CPU billing. |

---

# Slice 4B — immutable PDF artifact architecture (resolves the Slice 4 concurrency STOP)

## Why synchronous-on-download Chromium was rejected

Slice 4 ran headless Chromium inside every `GET /manual/<slug>/<version>/pdf`. Correct for one
isolated call, but the measured 3-round **2-request concurrency hard gate** passed only on a cold
instance's first pair and failed (`502`, Chromium OOM-killed at launch) once the Hobby + Fluid
instance was warm. The plan's HARD-STOP list forbade papering over it. **Approved decision: OPTION
B — generate once per immutable snapshot, store the PDF as an immutable artifact, serve every
download from the stored object. `GET /pdf` never launches Chromium.**

## Core model

```
PUBLISH → immutable published_snapshots row
        → ensure_pdf_artifact  (PENDING)
        → claim_pdf_artifact_generation  (atomic DB lock → GENERATING + lease)
        → Chromium generates the PDF ONCE  (unchanged Slice-4 pipeline)
        → read-back verify the stored bytes
        → complete_pdf_artifact_generation  (GENERATING → READY, records sha256 + byte_size)
        → public downloads stream the SAME stored artifact  (no Chromium)
```

**Invariant:** one immutable published snapshot = one immutable READY PDF artifact. Once READY,
the snapshot identity, frozen hash, storage bucket/key, `pdf_sha256`, `byte_size`, `page_count`
and `artifact_version` cannot change by any application action. ARCHIVED versions keep their
original READY artifact byte-for-byte. A new output needs a new published manual version.

## Migration `20260901002700_phase7_pdf_artifacts.sql`  (28 local == 28 remote; 02500/02600 untouched)

- **Bucket `manual-pdf-artifacts`** — private, **no `storage.objects` policy for anon / authenticated
  at all**. Only the trusted server (service role, RLS-bypassing) reads/writes it.
- **Table `published_pdf_artifacts`** — `unique (published_snapshot_id)` (one per snapshot),
  same-org composite FKs to `published_snapshots` + `manual_versions`, `status ∈
  {PENDING,GENERATING,READY,FAILED}`, `snapshot_content_hash` frozen at creation, `storage_key`
  CHECK `^pdf/v[0-9]+/[0-9a-f]{64}\.pdf$`, `pdf_sha256` CHECK 64-hex, `byte_size ≤ 50 MiB`, a
  `lease_token`/`lease_expires_at` present **iff** GENERATING, a READY-completeness CHECK,
  `attempt_count`, sanitized `failure_code`/`failure_message`. RLS on; SELECT-only grants
  (org-member + service_role); **no INSERT/UPDATE/DELETE grant to anyone**.
- **Trigger `app.guard_pdf_artifact_update()`** (BEFORE UPDATE, runs for every caller incl. the
  RPCs / postgres): creation-frozen columns immutable always; a READY row immutable except
  `updated_at`; only the enumerated transitions PENDING→GENERATING, GENERATING→READY,
  GENERATING→FAILED, FAILED→GENERATING, GENERATING→GENERATING (lease rotation) are allowed.
- **Four SECURITY DEFINER RPCs** (owner `postgres`, `set search_path = public`, **service-role
  EXECUTE only** — mirrors publish/archive):
  - `ensure_pdf_artifact(snapshot)` — idempotent PENDING row (`on conflict do nothing`).
  - `claim_pdf_artifact_generation(snapshot, seconds=300)` — `SELECT … FOR UPDATE` then:
    READY → `{outcome:'ready', …}`; live GENERATING lease → `{outcome:'in_progress'}`;
    PENDING / FAILED / expired-GENERATING → GENERATING + fresh `lease_token` + `lease_expires_at`
    + `attempt_count += 1` → `{outcome:'claimed', leaseToken, …}`. Two concurrent callers serialise
    on the row lock ⇒ at most one `claimed`. Lease floor 5 s / default 300 s / ceiling 1800 s.
  - `complete_pdf_artifact_generation(snapshot, lease, hash, key, sha, size, pages)` — requires
    status GENERATING + matching lease + matching frozen hash + key matching the content-addressed
    convention for the row + 64-hex sha + `0 < size ≤ 50 MiB` → READY, clears the lease.
  - `fail_pdf_artifact_generation(snapshot, lease, code, message)` — requires GENERATING + matching
    lease → FAILED, clears the lease, stores only `left(code,40)` / `left(message,300)`.

## Storage key — content-addressed, server-only

`pdf/v<PDF_ARTIFACT_VERSION>/<snapshot_content_hash>.pdf` (`lib/pdf/artifact-key.ts`, a pure
module — no `server-only`, unit-tested). No DB uuid, no user input. **Crash recovery:** the app
uploads with `upsert: true`; a partial object from a crashed prior attempt is safely overwritten
while the DB row is NOT READY (the bytes are deterministic). A READY artifact is never
regenerated (the claim RPC returns `ready` and the DB guard blocks mutation), so `upsert` can
never clobber a live artifact. Orphan objects for never-completed artifacts are harmless (nothing
references them) and are overwritten on the next successful generation of that snapshot.

## Files

| File | Role |
|---|---|
| `lib/pdf/artifact-key.ts` | pure: `pdfArtifactStorageKey`, `sha256Hex`, `PDF_ARTIFACT_BUCKET/_VERSION`. |
| `lib/pdf/artifact-storage.ts` | `server-only`: `uploadPdfArtifact` (`upsert`), `downloadPdfArtifact`; re-exports the pure helpers. |
| `lib/pdf/artifact-download.ts` | `server-only`, **NO playwright import** — READ side: `readArtifactRow`, `getReadyPdfArtifactForDownload` (verifies bytes vs frozen `pdf_sha256` + `byte_size`, tiny per-instance READY cache), `pdfArtifactStatus` / `pdfArtifactUiStatus`. |
| `lib/pdf/artifact.ts` | `server-only` — WRITE side: `ensurePublishedPdfArtifact`, `generatePublishedPdfArtifact` (claim → `generateManualPdf` (unchanged) → sha/size → `uploadPdfArtifact` → read-back verify → `complete_…` / `fail_…` with a sanitized message). |
| `lib/publication/get-public-manual.ts` | + `resolvePublishedSnapshotRef(slug,version)` — snapshot id / org / content hash / state / EA-name (a PostgREST json-path select) **without** transferring or hashing `render_json`. |
| `app/manual/[eaSlug]/[version]/pdf/route.ts` | **rewritten**: pure download. `resolvePublishedSnapshotRef` → `getReadyPdfArtifactForDownload` → 200 / 503+Retry-After (PENDING/GENERATING/FAILED) / 404 / 502 (integrity). Strong `ETag = "<pdf sha256>"`, `Cache-Control: public, max-age=31536000, immutable`, `If-None-Match` → 304. |
| `app/api/internal/pdf-artifact/route.ts` | INTERNAL generation trigger. Chromium runs here + the ADMIN retry action only. Auth = a valid `x-smartin-print-token` HMAC bound to slug+version (server-only `PDF_PRINT_SECRET`); any failure → generic 404. Goes through the same DB claim, so concurrent calls still yield one generation. Used by publish-time seeding / ops + the deployed e2e. |
| `features/manuals/publication-actions.ts` | `publishManualVersion` — AFTER the (committed) publication transaction: `ensurePublishedPdfArtifact` + `generatePublishedPdfArtifact` in a try/catch that **never rolls back / fails the publish** (a PDF failure ⇒ manual stays PUBLISHED, artifact FAILED, admin retries). + `retryPdfArtifact({manualId})` (ADMIN `manual:publish`) — same atomic claim path, can't bypass the lock / mutate READY / duplicate / double-launch Chromium. |
| `components/public-manual/pdf-download-button.tsx` | status-aware: READY → "Unduh PDF" (cheap fetch→blob); PENDING/GENERATING → "Menyiapkan PDF…" (disabled, no fake %); FAILED public → "PDF belum tersedia"; FAILED/NONE + `retryAction` (workspace ADMIN) → "Buat ulang PDF". |
| `next.config.ts` | `outputFileTracingIncludes` now pins `playwright-core/**` + `@sparticuz/chromium/bin/**` into `/manuals/**`, `/api/internal/pdf-artifact`, `/manual/**/pdf`. |

## Deployed evidence (Vercel Preview `smartin-manual-builder-dc0mibx3i…`, DEV Supabase, migration 02700 applied)

**Generation lock (§16).** Two simultaneous internal triggers for the un-generated `p7-pdf-normal`:
`[A] {"outcome":"in_progress","status":"GENERATING"}` · `[B] {"outcome":"generated","status":"READY","sha256":"9051b2759d…","byteSize":287493,"pageCount":5}`. Vercel logs for the window:
**2 `POST /api/internal/pdf-artifact` → exactly 1 `GET …/1.0.0/print`** → one Chromium generation.
Stale-lease recovery (separate transactions): `claim(5s)=claimed` → immediate `claim=in_progress`
→ after 8 s `claim=claimed` (attempt 1→2) → `complete=ready`.

**Download — canonical + gates (§15).** LARGE artifact generated once (`generated`, sha
`7f48294abf…`, 2 536 304 B, 24 pages — the **unchanged pipeline's canonical hash**). Then:

| concurrent READY downloads | every HTTP | every body | distinct SHA-256 | max wall |
|---|---|---|---|---|
| 2  | 200 | 2 536 304 | `7f48294abf…` (1) | ~1.0 s |
| 10 | 200 | 2 536 304 | `7f48294abf…` (1) | ~3.4 s |
| 20 | 200 | 2 536 304 | `7f48294abf…` (1) | ~6.4 s |

**Every one of the 32 requests: 200 + application/pdf + canonical bytes. No retries.** Vercel logs
across the bursts: only `ε GET /manual/p7-pdf-large/2.0.0/pdf` lines — **ZERO `chromium` /
`<launching>` / `printToPDF` / `/print`**. Headers: `ETag: "7f48294abf…"`,
`Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`; `If-None-Match` on the sha → **304**. Pre-generation `GET /pdf` →
**503 + Retry-After: 15** (no Chromium).

**ARCHIVED (§12).** `archive_manual_version` on `p7-pdf-normal/1.0.0` → `public_manual_versions`
ARCHIVED, artifact row **unchanged** (`READY`, sha `9051b2759d…`, 287 493 B, same key). Deployed
download of the now-ARCHIVED version → 200, **byte-identical** (`diff` of pre/post sha = clean),
same ETag + immutable headers.

**Isolation / security (§18/§19).** Wrong version for a real slug (`p7-pdf-large/1.0.0`, `/2.0.1`)
→ 404 (no artifact substitution). Anon direct `manual-pdf-artifacts` download/upload → denied
(integration-proven, real DEV Storage). Privacy sweep of the deployed PDF bytes + response
headers: **0** hits for `render_json`, `content_hash`, `storageKey`, `supabase(.co)`,
`PDF_PRINT_SECRET`, `x-smartin-print-token`, `lease_token`, `VERCEL_AUTOMATION_BYPASS_SECRET`,
`_vercel_jwt`, `pdf/v1/`, `published_pdf_artifacts`, `service_role`. No regulatory claim. SSRF:
`X-Forwarded-Host: evil.example.com` → byte-identical canonical PDF (download uses no host
header; generation origin is env-only).

## Failure / retry model (§20)

- Chromium / upload / read-back / `complete` throw → `fail_pdf_artifact_generation` with a
  sanitized message → artifact FAILED, publication stays valid, `GET /pdf` → 503, workspace ADMIN
  gets "Buat ulang PDF".
- Process killed mid-generation → the GENERATING lease simply expires; the next `claim` recovers it.
- Storage object missing / bytes fail the sha-256 or byte-size check on download → `getReady…`
  returns `corrupt` → route returns **502 + no-store** + a sanitized `pdf-artifact` log line;
  **never serves unverified bytes**.
- No path creates a duplicate READY artifact (`unique (published_snapshot_id)` + the claim RPC).

## Tests

- **Unit** — `tests/unit/pdf.test.ts` +4: `pdfArtifactStorageKey` is content-addressed / matches
  the RPC's regex / rejects a non-64-hex hash + upper-case + bad version; `sha256Hex` shape +
  stability. (**23 pdf unit tests**, still in the pure `npm run test`.)
- **Integration** — `tests/integration/rls.test.ts` +1 (**133 total**): idempotent `ensure` (one
  PENDING row); first `claim` → claimed; live lease → `in_progress` (attempt unchanged); `complete`
  rejects wrong lease / wrong snapshot hash / bad key shape; `fail` rejects wrong lease;
  FAILED→claim retry bumps `attempt_count`; `complete` → READY; READY `claim` → `ready` (no
  attempt bump); re-`complete` a READY row rejected; **service has no UPDATE grant** on the table;
  archived version keeps its READY artifact (sha/size/key); org-B member cannot SELECT the org-A
  artifact; anon + org-B cannot INSERT/UPDATE the table; anon cannot EXECUTE the RPCs; the
  `manual-pdf-artifacts` bucket rejects anon download + upload.
- **E2E** — `tests/e2e/pdf-endpoint.e2e.test.ts` rewritten for 4B (**9 tests**, dedicated
  `npm run test:e2e`, skips without `PDF_E2E_BASE_URL` + `PDF_PRINT_SECRET`): GEN GATE (2
  simultaneous triggers ⇒ ≤1 `generated`), seed LARGE (canonical sha / storage==DB / under cap),
  304 on the ETag, DOWNLOAD GATE 2/10/20 (all 200 + canonical, no retry, `maxMs < 20 s`), no
  private-identifier leak, print denial (no header / bad header / legacy `?t=`), unknown → 404.

## Regression gates

`npm run typecheck` ✓ · `npm run lint` ✓ · `npm run test` **585 passed** (452 unit + 133
integration) 0 failed · `npm run test:integration` **133 passed** · `npm run build` ✓ ·
`npm run test:e2e` (deployed) **9 passed**. Slices 1–3 + Slice-4 rendering/security/determinism
unchanged.

## AC status after Slice 4B

| AC | Status |
|---|---|
| **AC-P7-4** | partial — PDF renders from the SAME `ManualRenderer` + immutable snapshot as the web route; full web/PDF parity sign-off still a later sweep. |
| **AC-P7-5** | PASS (long-table pagination + repeated header — Slice 4, visually confirmed; unchanged). |
| **AC-P7-6** | PASS (figure + caption cohesion — Slice 4, visually confirmed; unchanged). |
| **AC-P7-7** | PASS (`Manual_<EAName>_v<X.Y.Z>.pdf` — unit + deployed `Content-Disposition`). |
| **AC-P7-9** | **PASS** — `GET /pdf` reliably serves a PUBLISHED **and** ARCHIVED manual as `application/pdf` (2 / 10 / 20 concurrent all 200 + canonical bytes, no Chromium), under the 4.5 MiB response cap. The Slice-4 concurrency STOP is resolved by the immutable-artifact architecture. |
| **AC-P7-10** | not promoted — the deployed-PDF byte scan finds no regulatory claims, but the full copy sweep is a later slice. |

## Remaining Phase 7 work (closed by Slice 5, below)

Full AC-P7-4 web/PDF content-parity sign-off; the AC-P7-10 regulatory-copy sweep; the final
public-output styling pass.

---

# Slice 5 — output parity + regulatory sweep + final polish (AC-P7-4, AC-P7-10)

Closes the last two Phase 7 output ACs. No migration (28 local == 28 remote). The approved
Slice 1–4B architecture and the auth-page boundary are unchanged.

## Canonical public-renderable content model

The web route (`app/manual/[eaSlug]/[version]/page.tsx`) and the signed print route
(`.../print/page.tsx`) both resolve one immutable snapshot with `getPublicManual` and feed the
**same `ManualViewModel`** into the **same `<ManualRenderer>`**; the PDF is generated by Chromium
from the print page. Everything the renderer emits inside `<article class="a4-document">` is public
content; everything outside it (web: skip link, `.pm-header` search + PDF button + version nav,
`.pm-toc-*`, `.public-manual-banner`; print/PDF: `@media print` pagination + page-number footer)
is surface chrome.

## Parity model — `lib/publication/output-parity.ts`

`buildOutputParityManifest(vm)` — pure, deterministic. Projects every public-rendered semantic
value and nothing else:

- **manual**: title, public version, platform, EA version
- **chapters**: ordered index + title + `hasContent` (chapter identity is order + title; `section.key` is not in the output, so it is not compared)
- **blocks** in order, by kind:
  - `text` / `callout` (+ tone) / `faq` (question + answer) → normalised visible text
  - `steps` → per step: index, title, instruction, menuPath, `image {alt, caption}`
  - `image` → `{ ref (deterministic public index), alt, caption }` or `null` (missing-object placeholder)
  - `parameterTable` → per group: name, param count, and per parameter: index, displayName, technicalName, paramType, **defaultValue, safeRange, orderEffect** (renderer fallbacks applied so vm and HTML agree)
  - `supportedSetups` (injected into `requirements` / `presets`) → per row: symbol, timeframe, preset, tested-minimum-lot text, supported; + the broker-min-lot note
  - `placeholder` → the empty-templated-chapter lead

Normalisation collapses incidental whitespace only — real words / numbers are never rewritten,
meaningful order is never sorted. No DB uuid / storageKey / content hash / review metadata.

`diffOutputParity(web, pdf)` → `[{ path, web, pdf }]` (e.g.
`chapters[4].blocks[1].groups[0].parameters[7].defaultValue  web: 0.08  pdf: 9.99`). Empty ⇒ parity.

## Proof it is tied to real output

`tests/support/parity-html.ts::manifestFromA4Html(a4Html)` rebuilds the **same manifest by
parsing the rendered `.a4-document` HTML** (jsdom).

- **Unit** (`tests/unit/output-parity.test.tsx`, jsdom): `renderToStaticMarkup(<ManualRenderer
  vm={fixture}/>)` → `manifestFromA4Html` **deep-equals** `buildOutputParityManifest(fixture)` —
  **content-model diff EMPTY**. The comprehensive fixture (`tests/support/parity-fixture.ts`, 14
  chapters, every public block kind, 2 step images, a standalone image, an FAQ, a `presets`
  injected table, a 24-row parameter table, an empty chapter) exercises every path. Mutation
  tests prove the diff catches: missing chapter, reordered block, changed visible text, changed
  parameter default, changed image alt + caption, changed step-image caption.
- **Deployed** (`tests/e2e/output-parity.e2e.test.ts`): fetch the real web page + the real signed
  print page, extract each `.a4-document`, build both manifests, diff. For `p7-pdf-large/2.0.0`
  (**18 chapters**) the diff has **0 entries**. Repeated on ARCHIVED `p7-pdf-normal/1.0.0` — **0
  entries**, and `public-manual-banner` is present in the page HTML but **not** inside
  `.a4-document` (web-only chrome).

## Visual regression — `tests/e2e/visual-parity.e2e.test.ts`

Real Chromium (`playwright-core`) against the deployed Preview, fixed viewport 1280 px,
`document.fonts.ready`, every `<img>` decoded, animations/transitions disabled, no
timestamps/random content, `emulateMedia({ media: "print" })` on the print page so the screenshot
matches the PDF.

- **Determinism**: the print `.a4-document` screenshots **byte-identical across two renders**
  (~2.66 MB PNG). **Documented tolerance: 0 differing bytes.**
- **Structural** invariants on the representative content — cover, first chapter, rich text,
  callout, parameter table (incl. a ≥20-row one), table page-break, standalone image + caption,
  step image, FAQ, final chapter: 18 chapters, cover renders, first="Pendahuluan" /
  final="Dukungan", 64 rich-text paragraphs, 6 callouts **all with painted backgrounds**, 5
  parameter tables (one long), 10 figures **all with captions**, every image decoded,
  **`clippedChapters: []`** (no clipped text), **`docHScroll: 0`** (no document-level horizontal
  scroll), long tables paginate under print (`overflow: visible`).
- **Public reading surface**: 18 chapters, **`clipped: []`**, **`docHScroll: 0`**, body text
  14 px, parameter tables 12 px (scannable), wide tables scroll only inside `.manual-table-wrap`
  (`overflow-x: auto`), search + TOC chrome present and visually separate from the document.

Screenshot artifacts (cover / chapter-1 / callout / param-table / figure / step-image /
chapter-final / print-a4 / web-a4 .png) are written to `PDF_E2E_ARTIFACT_DIR`
(`…/scratchpad/s5-visual/`) — **test baselines, not committed**.

## AC-P7-10 regulatory sweep

**Model:** invalid public copy → publication validation blocks the new publication. The renderer
is never a censor — it stays faithful to the frozen snapshot.

Enforcement reuses the existing deterministic engine (no second engine): the Phase 4 claim scanner
rule `CLAIM-REGULATOR-ENDORSE` is **broadened** to also flag standalone regulatory-approval labels
on output — `Approved` / `Bappebti Approved` / `Certified` / `Compliant` (case-insensitive) as a
badge / heading / status label / "X certified by Bappebti" / "Manual ini Approved" / a bare
`APPROVED` badge line. That rule feeds `CHK-NO-PROHIBITED-CLAIMS`, which is `required` +
`publish_blocking` in `CHECKLIST_V1`; a `WARNING` on it makes `publish_manual_version` raise
`validation: publication is blocked …`.

- **Unit** (`tests/unit/regulatory-output-scan.test.ts`, 34 tests): every forbidden label +
  many case/spacing variants → a `CLAIM-REGULATOR-ENDORSE` finding; neutral / allowed wording
  ("siap untuk review kepatuhan", "disetujui klien" changelog language, plain EA prose) → **no**
  finding; a manual with `Bappebti Approved` → `CHK-NO-PROHIBITED-CLAIMS` = WARNING with
  `publishBlockingCategories` containing `CLAIM-REGULATOR-ENDORSE`; the comprehensive fixture is
  regulatory-clean; `CHK-NO-PROHIBITED-CLAIMS` is `required` + `publish_blocking`.
- **Negative publication** (`tests/integration/rls.test.ts`): a lineage forced APPROVED, its
  `CHK-NO-PROHIBITED-CLAIMS` result flipped to `WARNING` → `publish_manual_version` **refuses**
  (`publication is blocked` / `validation`); afterwards **no `published_snapshots`, no
  `public_manual_versions`, no `published_pdf_artifacts`, no publish audit event**, and the manual
  version never entered `PUBLISHED`. Control: flip it back to `PASS` → the same version publishes
  cleanly. No render-time mutation anywhere.
- **Deployed scan** (`tests/e2e/output-parity.e2e.test.ts`): the public WEB HTML, the PRINT HTML,
  and the extracted PDF text — case-insensitive — for `p7-pdf-large/2.0.0` and ARCHIVED
  `p7-pdf-normal/1.0.0`: **`{ approved: 0, "bappebti approved": 0, certified: 0, compliant: 0 }`
  in every surface.**

## Immutable-history rule

No already-published immutable snapshot was modified. The comprehensive parity fixture is a new
clean fixture; the negative test builds its own throwaway lineage. `p7-pdf-large` /
`p7-pdf-normal` READY artifacts are untouched.

## Final public-output styling

Scoped, minimal, same design language (navy / blue / Smartin green / white):

- **`app/globals.css` — `.public-manual` reading surface**: the `.manual-page` "paper page"
  framing (`aspect-ratio: 210/297; overflow: hidden`) clipped long chapters on the desktop web
  reader — replaced with **natural-height document cards** (`aspect-ratio: auto; overflow:
  visible`), a comfortable reading type scale (body 14 px, param tables 12 px with uppercase
  navy headers, captions 11 px, callouts 12.5 px, step text 13 px, h2 `clamp(21–26px)`),
  consistent chapter spacing (`.a4-document { gap: 22px }`), rounded image/figure cards, a
  neutral left-border archived banner, and `min-width: 0` containment so a wide parameter table
  scrolls **inside** `.manual-table-wrap` and never widens the page. **DOM structure + text are
  unchanged → AC-P7-4 parity holds; `.pdf-shell` / `@media print` (the PDF path) is untouched →
  the canonical PDF (`7f48294abf…`, 2 536 304 B, 24 pages) is unchanged.**
- **`app/icon.svg`**: a Smartin "S" brand favicon (green `#22c55e`) — the app previously had none,
  so every tab requested `/favicon.ico` → 404 in the console.

## Responsive results (public reading surface)

| width | doc h-scroll | clipped chapters | TOC | search | version switcher | focus visible | console errors |
|---|---|---|---|---|---|---|---|
| 375 px | **0** | 0 | mobile `<details>` ✓ | ✓ | ✓ | ✓ | 0 (a `/favicon.ico` 404 line — fixed by `app/icon.svg`) |
| 768 px | 0 | 0 | ✓ | ✓ | ✓ | ✓ | 0 |
| 1024 px | 0 | 0 | desktop sidebar ✓ | ✓ | ✓ | ✓ | 0 |
| 1440 px | 0 | 0 | ✓ | ✓ | ✓ | ✓ | 0 |

No overlapping controls, no clipped text, no nested document-level horizontal scroll.

## PDF / determinism impact

None. The styling pass touches only `.public-manual` (web) selectors and adds a favicon. The PDF
is rendered from `.pdf-shell` + `@media print`, which are unchanged; the deployed
`p7-pdf-large/2.0.0` PDF is still `application/pdf`, **2 536 304 B**, SHA-256
`7f48294abfbc6b04a021faade93a9a33ba0e1d6e6e4967a76cab9d85b6a09335`, 24 pages, and the
generation pipeline stays deterministic.

## Security / privacy re-sweep

The deployed WEB HTML + PRINT HTML + PDF text + response headers were re-scanned after the
styling + parity changes: no `SUPABASE_SECRET_KEY` / `PDF_PRINT_SECRET` /
`VERCEL_AUTOMATION_BYPASS_SECRET` / `x-smartin-print-token` value / generation lease token /
`storageKey` / private bucket path / raw `render_json` / DB uuid / review metadata / audit
information. The only content hash exposed is the PDF `pdf_sha256` as the intentional strong
`ETag`. Slice 1–4B security is unchanged.

## Tests

- **Unit** `+45`: `output-parity.test.tsx` (10 — manifest determinism, comprehensive fixture ⇒
  empty diff, 6 mutation-detection), `regulatory-output-scan.test.ts` (34).
- **Integration** `+1`: the AC-P7-10 negative publication test.
- **E2E** (dedicated `npm run test:e2e`): `output-parity.e2e.test.ts` (3 — PUBLISHED parity +
  regulatory, ARCHIVED), `visual-parity.e2e.test.ts` (3 — determinism + structural print + web).

## AC status after Slice 5 — complete Phase 7 AC matrix

| AC | PRD ref | MUST/SHOULD | Status | Evidence |
|---|---|---|---|---|
| **AC-P7-1** | PRD-DIST-001 | MUST | **PASS** (Slice 1) | Publishing a version creates one immutable `published_snapshots` row + a `public_manual_versions` index row in the global public namespace; `GET /manual/<slug>/<version>` serves it with no workspace session. RLS + `publish_manual_version` RPC integration tests. |
| **AC-P7-2** | PRD-DIST-002 | MUST | **PASS** (Slice 1) | The public page is readable unauthenticated; drafts / unpublished versions 404; archived versions still resolve with a banner. Deployed + integration. |
| **AC-P7-3** | PRD-NAV-001 | MUST | **PASS** (Slice 2) | Public TOC, in-page search, and version switcher on the public reading surface. Deployed e2e + component tests. |
| **AC-P7-4** | PRD-SUCC-005 | MUST | **PASS** (Slice 5) | Web render and PDF render contain the same chapters, blocks, and parameter values — **content-model diff EMPTY** (`manifestFromA4Html(web)` deep-equals `manifestFromA4Html(print)`; unit fixture + deployed `p7-pdf-large/2.0.0` 18 chapters + ARCHIVED `p7-pdf-normal/1.0.0`, 0 diff entries) **AND** a deterministic visual-regression fixture within tolerance (print `.a4-document` byte-identical across renders, **tolerance 0**; structural invariants hold under print-media emulation). Mutation tests prove the diff detects any content drift. |
| **AC-P7-5** | — | MUST | **PASS** (Slice 4) | Long parameter tables paginate with a repeated column header across ≥2 PDF pages; verified against generated PDF text/pages, not screenshots. |
| **AC-P7-6** | — | MUST | **PASS** (Slice 4) | Figure + caption stay together across page breaks (`break-inside: avoid`); verified on a near-break fixture. |
| **AC-P7-7** | — | SHOULD | **PASS** (Slice 4) | Download filename `Manual_<EAName>_v<X.Y.Z>.pdf` with sanitised `Content-Disposition: attachment`; filename-builder unit test + deployed header check. |
| **AC-P7-8** | PRD-DIST-003 | MUST | **PASS** (Slice 3) | Published images served through the private `/manual/<slug>/<version>/image/<idx>` proxy (no public bucket, no direct Supabase read in the renderer); works unauthenticated for a published version, 404 otherwise. |
| **AC-P7-9** | — | MUST | **PASS** (Slice 4B) | `GET /pdf` reliably serves PUBLISHED **and** ARCHIVED manuals as `application/pdf` from the immutable artifact (2 / 10 / 20 concurrent → 200 + canonical bytes, never launches Chromium), under the 4.5 MiB response cap. |
| **AC-P7-10** | GI-1 (output) | MUST | **PASS** (Slice 5) | The public web page and the PDF contain **no** "Approved" / "Bappebti Approved" / "Certified" / "Compliant" label anywhere — case-insensitive scan of WEB HTML + PRINT HTML + extracted PDF text for `p7-pdf-large/2.0.0` and ARCHIVED `p7-pdf-normal/1.0.0` = **`{approved:0, "bappebti approved":0, certified:0, compliant:0}`** in every surface. Enforced by broadening the existing `CLAIM-REGULATOR-ENDORSE` scanner rule → `CHK-NO-PROHIBITED-CLAIMS` (`required` + `publish_blocking`) → `publish_manual_version` refuses the new publication (no snapshot / public version / PDF artifact / audit event). Negative integration test + 34 unit tests. The renderer never censors the frozen snapshot. |

**All 9 Phase 7 MUST criteria and the 1 SHOULD are proven.** No migration was added (28 local == 28 remote). No already-published immutable snapshot or READY PDF artifact was modified. The canonical `p7-pdf-large/2.0.0` PDF is unchanged (`7f48294abf…`, 2 536 304 B, 24 pages).

> **Phase 7 is COMPLETE** pending Slice 5 review. Not committed / not pushed.
