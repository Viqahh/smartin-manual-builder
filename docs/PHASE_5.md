# Phase 5 completion report — Validation & compliance readiness

> **Status: implemented + checklist-completeness correction applied + verified against Supabase DEV,
> awaiting review. NOT COMMITTED, NOT PUSHED.**
>
> Phase 5 adds a **deterministic documentation-readiness** layer: a versioned checklist template
> (**v1 = the full 31 checks of `COMPLIANCE_REQUIREMENTS.md` §12**, PRD-OQ-004 final), one persisted
> `checklist_result` per item per manual version, a single central evaluator (31 rules, one `RULES`
> registry, a drift guard), a completion score with a **dynamic** denominator, a submission-eligibility
> signal, and a real validation panel in the builder inspector (31 items grouped by category).
> **No LLM is used for any checklist rule.** The Phase 4 claim scanner is reused (not duplicated).
> No Phase 6 workflow (review assignment, comments, approvals, DRAFT→TECHNICAL_REVIEW transition,
> publishing) is implemented.
>
> The engine **never grants approval**. Every rendered string is "kesiapan dokumentasi" /
> "siap dikirim untuk review" / "perlu dilengkapi" — never "Approved" / "Compliant" / "Bappebti".

Approved Phase 4 commit: `73d5683efaf56246019f20063c110a2a584ce776`.

Baseline read: `docs/IMPLEMENTATION_PLAN.md` Phase 5, `docs/ACCEPTANCE_CRITERIA.md` AC-P5-1…13,
`docs/PRD.md` (PRD-VAL-*, PRD-COMP-*, PRD-VER-003/008, PRD-CNT-008, PRD-SEC-009, OQ-004/005/009/011),
`docs/COMPLIANCE_REQUIREMENTS.md` (§0–§13), `docs/CONTENT_REQUIREMENTS.md`, `docs/DATA_MODEL.md`.

---

## 0. Ponytail / simplicity decisions

| Decision | Why |
|---|---|
| **Checklist v1 = the full 31 items** of `COMPLIANCE_REQUIREMENTS.md` §12 (product-owner final call, §1 below) | The temporary 10-item subset shipped first only covered the AC-P5-4/5 fixtures. v1 now carries every documented check id. Rules share small deterministic primitives (`chapterHasContent`, `phrasesPresent`, `conceptCoverage`) — 31 items, **not** 31 hand-rolled implementations, and never a blanket PASS. |
| **PBK scope = a JSON key** (`requirements.pbkScope`) on `ea_versions`, not a new column | `ea_versions.requirements` is already the Zod-validated home for structured EA-version facts; `COMPLIANCE_REQUIREMENTS.md` §1 says the flag lives "on the EA Product / EA Version". No migration, no new query path — the evaluator loads the whole EA version anyway. Same pattern for the two new keys `gui` and `verifiedFeatures` (needed by `CHK-INTERFACE` / `CHK-FITUR-DIJELASKAN`). |
| **`checklist_results` has no client write policy at all** — server-owned via the service client | Simplest way to guarantee "browser cannot forge PASS / score / evaluator / developer N/A" without an RPC. The server action *is* the security boundary (`requireActiveOrg` + `assertCan`); RLS blocks every direct client write. |
| **One central pure evaluator** `evaluateManual(vm, items)` | `lib/validation/rules.ts` holds the rule functions + one `RULES` registry; `lib/validation/evaluate.ts` orchestrates + scores. React and SQL contain **zero** rule logic — the UI renders `checklist_results`. A drift guard (unit + integration) fails if a seeded `rule_key` has no entry in `RULES`. |
| **Score denominator is dynamic** — `required, in-scope, non-NA` item count from the *active template* | Nothing hardcodes 10 / 26 / 31. |
| **Reuse `projectManualLines` / `scanClaims` / `richTextToPlainText` / `eaDeclaresDangerMode`** | All already exist. `CHK-NO-PROHIBITED-CLAIMS` calls the Phase 4 scanner verbatim. |
| **Refresh = one coalesced client call** after the existing autosave settles | No queue, no dependency. `ManualBuilder` schedules `refreshValidation(manualId)` ~1.2 s after any successful block/section mutation; the server re-reads the DB (never trusts client state). |
| **31 items grouped by category in the inspector** | The panel renders one collapsible-free subheading per category so 31 rows stay legible; no builder redesign. |
| **Reviewer N/A override is sticky** (survives re-evaluation; no "un-override") | The documented rule is "re-evaluation must not silently erase a legitimate reviewer override". Clearing an override is Phase 6 territory. |

---

## 1. Open-question decisions (AC-P5-13)

### PRD-OQ-004 — checklist item set (v1) — **RESOLVED**

**Decision (product owner): checklist template v1 contains all 31 items enumerated in
`COMPLIANCE_REQUIREMENTS.md` §12**, using those exact check ids, in the order below (`position 0…30`).
The Phase-1 "/ 26" figure was mock/target data; Phase 5 uses the active template's real item count.
Every item is `required` except `CHK-PACKAGE-FILES` (`required = false`) and `CHK-INTERFACE`
(`required = true` but `NOT_APPLICABLE` unless the EA declares a GUI). `bappebti_only = true` items
become `NOT_APPLICABLE` when `pbkScope = OUT_OF_SCOPE` (§ "PBK suppression" below).

| pos | check_key | category | required | bappebti_only | publish_blocking | applies when |
|---|---|---|---|---|---|---|
| 0 | `CHK-VERSI-DUA` | identity | yes | no | yes | always |
| 1 | `CHK-VERSI-MATCH` | identity | yes | no | yes | always |
| 2 | `CHK-DEV-LEGAL` | identity | yes | no | yes | always (NA-style pass if self-built & org = Smartin) |
| 3 | `CHK-INSTALASI` | installation | yes | no | yes | always |
| 4 | `CHK-INSTALL-AUTOTRADING` | installation | yes | no | no | always |
| 5 | `CHK-DEPENDENCIES-LISTED` | installation | yes | no | no | EA version declares dependencies (custom indicators / DLL / WebRequest) |
| 6 | `CHK-PACKAGE-FILES` | installation | **no** | no | no | extra files ship (dependencies or preset refs) |
| 7 | `CHK-CARA-KERJA` | how-it-works | yes | no | yes | always |
| 8 | `CHK-SPECIAL-CONDITIONS` | how-it-works | yes | no | no | always |
| 9 | `CHK-SETTING` | how-it-works | yes | no | yes | always |
| 10 | `CHK-PARAM-COMPLETE` | how-it-works | yes | no | yes | EA version has ≥ 1 parameter |
| 11 | `CHK-PARAM-DEFAULT-MATCH` | how-it-works | yes | no | no (WARNING only) | EA version has ≥ 1 parameter |
| 12 | `CHK-UNITS-DEFINED` | how-it-works | yes | no | no (WARNING only) | manual text uses point/pip/poin |
| 13 | `CHK-QUICKSTART-DEMO` | how-it-works | yes | no | no | always |
| 14 | `CHK-SAFE-STOP` | how-it-works | yes | no | no | always |
| 15 | `CHK-DISCLAIMER-5-5-D` | risk | yes | **yes** | yes | `pbkScope = IN_SCOPE` |
| 16 | `CHK-RISK-GENERAL` | risk | yes | no | yes | always |
| 17 | `CHK-PAST-NOT-FUTURE` | risk | yes | no | yes | always |
| 18 | `CHK-DANGER-MODE-WARN` | risk | yes | no | yes | EA version declares a danger mode |
| 19 | `CHK-NO-PROHIBITED-CLAIMS` | risk | yes | no | yes when a §4 publish-blocking category is present | always |
| 20 | `CHK-KONTAK` | support | yes | **yes** | yes | `pbkScope = IN_SCOPE` |
| 21 | `CHK-KONTAK-SPLIT` | support | yes | no | no | always |
| 22 | `CHK-TRANSPARANSI` | support | yes | **yes** | no | `pbkScope = IN_SCOPE` |
| 23 | `CHK-BAHASA-ALGO` | support | yes | **yes** | no | `pbkScope = IN_SCOPE` |
| 24 | `CHK-PERIODE-EFEKTIF` | support | yes | **yes** | no | `pbkScope = IN_SCOPE` |
| 25 | `CHK-PERFORMANCE-KONDISI` | performance | yes | no | no (WARNING only) | a performance figure appears in the `performance` chapter |
| 26 | `CHK-CHANGELOG-VERSI` | identity | yes | no | no | always |
| 27 | `CHK-DISCLOSURE-REF` | bappebti | yes | **yes** | yes | `pbkScope = IN_SCOPE` |
| 28 | `CHK-ONBOARDING-MARGIN` | bappebti | yes | **yes** | no | `pbkScope = IN_SCOPE` |
| 29 | `CHK-FITUR-DIJELASKAN` | how-it-works | yes | no | no | EA version declares verified features (`requirements.verifiedFeatures[]`) |
| 30 | `CHK-INTERFACE` | how-it-works | yes | no | no | EA version declares a GUI (`requirements.gui = true`); else `NOT_APPLICABLE` |

Category slugs: `identity`, `installation`, `how-it-works`, `risk`, `support`, `performance`, `bappebti`.
`publish_blocking` is **recorded** metadata only — Phase 6 consumes it; Phase 5 does not enforce publish.

### PRD-OQ-005 — required chapters — **RESOLVED**

**Decision:** chapter-requirement semantics come from `CONTENT_REQUIREMENTS.md` (the "Chapter map").
A chapter "has content" = ≥ 1 non-deleted block with non-empty projected text, **or** a
`parameterTable` / `image` block.

- **Always required:** `cover`, `overview`, `requirements`, `installation`, `quick-start`,
  `how-it-works`, `parameters`, `risk`, `presets`, `performance`, `troubleshooting`, `changelog`.
- **Conditional:**
  - `package` — required when the EA version declares dependencies / preset refs / extra files (else recommended).
  - `interface` — required when `requirements.gui = true` (else `NOT_APPLICABLE`).
  - `disclaimer`, `support`, `transparency` — required when `pbkScope = IN_SCOPE`.
- **Recommended, never globally required:** `faq`.
- **Custom chapters** (Phase 3, keys outside the canonical set) are never automatically required.

There is **no** single umbrella `CHK-REQUIRED-CHAPTER` item in v1 (it was removed — not one of the 31).
Chapter presence is enforced *per chapter* by the item that owns it:
`installation → CHK-INSTALASI`, `how-it-works → CHK-CARA-KERJA` + `CHK-SPECIAL-CONDITIONS`,
`parameters → CHK-SETTING` + `CHK-PARAM-COMPLETE`, `quick-start → CHK-QUICKSTART-DEMO` + `CHK-SAFE-STOP`,
`risk → CHK-RISK-GENERAL` + `CHK-PAST-NOT-FUTURE`, `performance → CHK-PERFORMANCE-KONDISI`,
`changelog → CHK-CHANGELOG-VERSI`, `disclaimer → CHK-DISCLAIMER-5-5-D` (PBK),
`support → CHK-KONTAK` + `CHK-KONTAK-SPLIT` (PBK for 24/7), `transparency → CHK-TRANSPARANSI` (PBK),
`cover → CHK-VERSI-DUA` + `CHK-DEV-LEGAL`. Presence of `overview`, `presets`, `troubleshooting`
(no dedicated §12 item) stays covered by the Phase 3 per-chapter completion state; adding items for
them would exceed the agreed 31 and is left for a future template version.

### PRD-OQ-009 — image scan gate

**Decision:** image `scan_status` is **not a Phase 5 checklist item and not a submission
blocker.** No scanner is wired (Phase 2 leaves assets `pending`/`skipped`); making an
unimplemented scan a blocker would block every manual. Treated as advisory; a real gate is
deferred to the Phase 6 publish precondition. Recorded so the OQ has a decision.

### PRD-OQ-011 — non-Bappebti suppression set

**Decision:** when the linked EA version has `requirements.pbkScope = "OUT_OF_SCOPE"`, exactly these
seven `bappebti_only` items become `NOT_APPLICABLE` automatically (evaluator scope rule,
`evaluator = "system"`):

- `CHK-DISCLAIMER-5-5-D`
- `CHK-KONTAK` (its 24/7 PBK obligation is the scoped part; the general "real contact channel exists"
  need is still covered OUT_OF_SCOPE by `CHK-KONTAK-SPLIT`, which requires support-chapter content)
- `CHK-TRANSPARANSI`
- `CHK-BAHASA-ALGO`
- `CHK-PERIODE-EFEKTIF`
- `CHK-DISCLOSURE-REF`
- `CHK-ONBOARDING-MARGIN`

…and the OQ-005 required-chapter set drops `support`, `disclaimer`, `transparency` when
`OUT_OF_SCOPE`. **Every other item still evaluates** for OUT_OF_SCOPE (identity/version, installation,
how-it-works + special conditions, settings + parameter completeness/defaults, units, quick-start +
safe-stop, general risk, past≠future, danger-mode, prohibited claims, contact split, changelog,
performance conditions, features, interface). No false `MISSING` for the suppressed items.

---

## 2. Checklist data model — migrations `20260901001100` + `20260901001200`

- **`20260901001100_phase5_checklist.sql`** — the three tables + RLS + grants + the initial seed
  (added after `20260901001000_ai_revisions.sql`).
- **`20260901001200_phase5_checklist_v1_full.sql`** — the **checklist-completeness correction**
  (added after `…001100`; the deployed `…001100` was **not** edited). It deletes the umbrella
  `CHK-REQUIRED-CHAPTER` item (and any result rows referencing it) and upserts the full **31-item**
  catalog with `on conflict (checklist_template_id, check_key) do update`, so it is idempotent and
  self-correcting — the 9 items carried over from `…001100` are re-pointed to their final
  position/metadata, the other 22 are inserted. Template identity + version are unchanged
  (`key = smartin-documentation-checklist`, `version = 1`).

Three tables, all `NOT NULL` unless stated:

### `checklist_templates`
`id` (uuid pk) · `organization_id` (uuid → organizations, **NULL = system-owned**, like `manual_templates`) ·
`key` · `version` (int ≥ 1) · `title` · `is_active` (bool, default true) · `created_at` · `updated_at` (touch trigger).
`unique (organization_id, key, version)`.

### `checklist_items` (the items of one template version)
`id` · `checklist_template_id` (→ templates, cascade) · `check_key` · `label` · `category` ·
`description` (default `''`) · `required` (bool) · `rule_key` (evaluator dispatch key; `== check_key` in v1) ·
`bappebti_only` (bool — the OQ-011 suppression set) · `publish_blocking` (bool — Phase 6 consumes it, Phase 5 only records it) ·
`position` (int) · `created_at`. `unique (checklist_template_id, check_key)`.

### `checklist_results` (one per manual version + item)
`id` · `organization_id` (→ organizations, cascade) · `manual_version_id` (uuid) ·
`checklist_template_id` (→ templates) · `checklist_template_version` (int — **AC-P5-11**) ·
`check_key` · `category` · `required` (bool) ·
`state` `text check (state in ('PASS','WARNING','MISSING','NOT_APPLICABLE'))` — **no `APPROVED`** ·
`evidence` (jsonb, default `{}`) · `evaluator` `text check (evaluator in ('system','reviewer'))` (default `'system'`) ·
`evaluated_at` (timestamptz) · `override_actor_id` (uuid → profiles, `on delete set null`) ·
`override_reason` (text, nullable) · `override_at` (timestamptz, nullable) · `created_at`.

Constraints:
- `foreign key (manual_version_id, organization_id) references manual_versions (id, organization_id) on delete cascade` — composite FK, same org-isolation pattern as every other Phase 2/3 child table.
- `foreign key (checklist_template_id, check_key) references checklist_items (checklist_template_id, check_key)` — a result can only exist for a real item of that template.
- **`unique (manual_version_id, check_key)`** — enforces "exactly one `checklist_result` per manual version + item" (**AC-P5-2**). Verified live: a duplicate service-role insert returns `23505`.
- `index checklist_results_mv_idx on (manual_version_id)`.

### RLS
- `checklist_templates_select` / `checklist_items_select`: `SELECT` to `authenticated` where the template is system (`organization_id is null`) or org-owned by a member. No write policy.
- `checklist_results_select_members`: `SELECT` to `authenticated` where `organization_id in (select app.member_org_ids())`. **No `INSERT` / `UPDATE` / `DELETE` policy at all.**
- Grants: `authenticated` → `SELECT` only on all three; `service_role` → full DML (RLS still decides the effective op for non-service callers).

### Seed (idempotent)
One template row: `id = c5000000-0000-4000-8000-000000000001`, `key = smartin-documentation-checklist`,
`version = 1`, `title = 'Smartin Documentation Checklist v1'`, `is_active = true`.
**31** `checklist_items` rows after `…001200` — the OQ-004 set (§1), `position 0…30`, each with its
`check_key`, Indonesian `label` + `description`, `category`, `rule_key` (`== check_key`),
`bappebti_only`, `publish_blocking`. Verified live: `select count(*) from checklist_items where
checklist_template_id = 'c5000000-…-001'` → **31**; `CHK-REQUIRED-CHAPTER` absent.

---

## 3. Template & version semantics

- **Identity** is `(key, version)`. `checklist_results.checklist_template_id` + `.checklist_template_version` pin the exact template a result set was computed against (**AC-P5-11**).
- `loadActiveTemplate()` (`features/validation/actions.ts`) reads the highest-`version` `is_active` row for `key = smartin-documentation-checklist`, then its items ordered by `position`. If the row is somehow absent it falls back to the built-in `CHECKLIST_V1` metadata (the same 31 ids / positions / flags, `version 1`, template id `c5000000-…-001`) so the evaluator never hard-fails. `CHECKLIST_V1` mirrors the `…001200` seed and is the single source the unit tests assert against.
- **No silent version migration.** `evaluateAndPersist` always writes the *currently active* template's id + version. A stored result set is only re-pointed to a newer template when an evaluation is explicitly re-run (autosave-triggered refresh, the "Perbarui" button, or a reviewer override). There is no historical-result rewrite path, and no background job. A future v2 template would be a new seed row (`version = 2, is_active = true` + flip v1's `is_active`); existing DRAFT manuals keep computing against whatever is active at evaluation time (all Phase-5 manuals are DRAFT — there is no frozen/published snapshot yet; that is Phase 6).
- **No template-management UI.** No AC-P5 item needs one; authoring/activation is a migration/seed concern.

---

## 4. Evaluator architecture — one central deterministic function

```
app/(workspace)/manuals/[manualId]/edit/page.tsx      ── server component: getValidation({manualId}) on load
        │
features/validation/actions.ts   ("use server")        ── the security + I/O boundary
        │   requireActiveOrg() → assertCan(manual:read) → assembleManualViewModel(SupabaseManualDataSource(orgId), manualId)
        │   loadActiveTemplate() + loadExistingResults()  (RLS-scoped server client)
        ▼
lib/validation/evaluate.ts   evaluateManual(vm, items, opts)   ── PURE. loads nothing. no LLM, no DB, no network.
        │   scope = eaPbkScope(vm.eaVersion.requirements)
        │   for each item (sorted by position):
        │     bappebtiOnly && scope==OUT_OF_SCOPE → systemState NOT_APPLICABLE (scope reason)
        │     else !ruleApplies(checkKey, vm)     → systemState NOT_APPLICABLE (applicability reason)
        │     else RULES[ruleKey](vm)             → {state, reason, evidence, navigateSectionKey}
        │     if opts.overrides[checkKey]         → state NOT_APPLICABLE, evaluator "reviewer", systemState kept
        ▼
lib/validation/rules.ts   RULES: Record<string, (vm) => RuleOutcome>   ── 31 rule functions, ONE definition each
        │   shared primitives: sectionText / sectionHasContent / phrasesHit / conceptOutcome / stepsBlocks / ea* readers
        │   reuses: projectManualLines / scanClaims (Phase 4), richTextToPlainText, eaDeclaresDangerMode
        ▼
features/validation/actions.ts   service-role upsert into checklist_results (onConflict manual_version_id,check_key)
        ▼
features/validation/validation-panel.tsx   ("use client")   ── renders checklist_results ONLY. contains zero rule logic.
```

Rule logic lives in exactly one place (`lib/validation/rules.ts`). React renders `ItemResult[]`; SQL stores
them; server actions orchestrate. `computeScore` / `computeEligibility` / `computeCounts` are pure and shared
by both the fresh-evaluation path (`evaluateManual`) and the reconstruct-from-rows path (`shapeFromRows`).

**Drift guard (§9 of the correction).** `RULE_KEYS = Object.keys(RULES)` is exported. A unit test asserts
every `CHECKLIST_V1` `rule_key` has a `RULES` entry **and** every `RULES` key is used by exactly one item;
a live-DB integration test does the same against the seeded `checklist_items`. If a future template adds an
item whose `rule_key` has no evaluator, both fail. At runtime an unknown `rule_key` yields `MISSING` with
`reason = "Aturan tidak dikenal: …"` — visible, never a silent PASS.

---

## 5. Rule semantics (exact, deterministic)

All rules are pure functions of the assembled `ManualViewModel` (`vm`). "section text" = a plain-text
projection of a section's non-deleted blocks (`text`/`callout` content, `faq` question+answer,
`steps` title/instruction/menuPath, `image` caption). "manual text" = `projectManualLines(vm)` joined by `\n`
(the same Phase-4 projection the claim scanner consumes). The VM already excludes soft-deleted blocks.

"chapter has content" = ≥ 1 non-deleted block with non-empty projected text, **or** a `parameterTable` /
`image` block. Concept checks use a shared `conceptOutcome(vm, sectionKeys, regexes, {min})` helper:
MISSING if no listed chapter has content or fewer than `min` concept regexes match; PASS otherwise.
All 31:

| # | Check | Applies when | PASS | non-PASS |
|---|---|---|---|---|
| 0 | **CHK-VERSI-DUA** | always | EA & manual version both present, distinct, and the `cover` chapter names a version / "berlaku untuk versi X.Y.Z" | WARNING if the two versions are byte-identical or the cover doesn't show them; MISSING if either version string is absent. ev `{eaVersion, manualVersion, coverMentionsVersion}` |
| 1 | **CHK-VERSI-MATCH** | always | linked `eaVersion.id`+`version` exist, no conflicting `x.y.z` near "ea/expert advisor/robot"+"versi" in manual text | MISSING on a conflicting version. ev `{eaVersion, manualVersion, conflictingVersions[]}` |
| 2 | **CHK-DEV-LEGAL** | always | org named on the cover; **self-built** (org matches Smartin / developer) → PASS once the cover names the org; **third-party** → PASS only when the developer name **and** a cooperation-note phrase appear in cover/transparency | WARNING (self-built, cover doesn't name org) / MISSING (third-party, no dev+cooperation note, or no org name). ev `{organization, developer, selfBuilt, mentionsDeveloper, mentionsCooperation}` |
| 3 | **CHK-INSTALASI** | always | `installation` has a `steps` block with ≥ 5 steps **and** the text names Data Folder / MQL5\Experts / Navigator | MISSING otherwise. ev `{sectionId, stepsBlockIds[], maxSteps, mentionsDataFolder}` |
| 4 | **CHK-INSTALL-AUTOTRADING** | always | `installation` text mentions Algo Trading / Allow Algo Trading **and** the smiley icon (green/red) | WARNING (algo only) / MISSING (neither). ev `{mentionsAlgoTrading, mentionsSmiley}` |
| 5 | **CHK-DEPENDENCIES-LISTED** | `requirements.customIndicators[]` non-empty **or** `dll` **or** `webRequest` | every declared indicator name appears in installation/package/requirements text, DLL/WebRequest documented, and missing-file behaviour (OnInit/smiley) stated | MISSING otherwise. ev `{declaredIndicators[], missingIndicatorMentions[], needsDll, needsWebRequest, dllDocumented, webRequestDocumented, missingFileBehaviourDocumented}` |
| 6 | **CHK-PACKAGE-FILES** (`required = false`) | extra files ship (deps or preset refs) | `package` chapter has content, or installation text lists file paths (`.ex5` / `Indicators\` / …) | WARNING otherwise (never MISSING — optional). ev `{packageSectionId, packageHasContent}` |
| 7 | **CHK-CARA-KERJA** | always | `how-it-works` text ≥ 200 chars covering entry + management + exit keywords | MISSING if empty/thin; WARNING if content present but one of entry/mgmt/exit unclear. ev `{sectionId, length, hasEntry, hasExit, hasManagement}` |
| 8 | **CHK-SPECIAL-CONDITIONS** | always | ≥ 4 of the 5 special-condition regexes match in `how-it-works` (spread wide / reconnect+gap / OnInit fail / two charts / manual close reopen) | WARNING (1–3) / MISSING (0 or empty). ev `{conditionsAnswered, conditionsExpected:5}` |
| 9 | **CHK-SETTING** | always | `parameters` chapter has a `parameterTable` referencing a linked EA-Version group, **or** ≥ 150 chars of settings prose | MISSING otherwise. ev `{sectionId, referencesOwnGroups, proseLength}` |
| 10 | **CHK-PARAM-COMPLETE** | EA version has ≥ 1 parameter | every group-with-params referenced by a `parameterTable` whose group id belongs to the linked EA version (foreign ids ignored) | MISSING otherwise. ev `{sectionId, paramTableBlockIds[], referencedGroupIds[], missingGroups[]}` |
| 11 | **CHK-PARAM-DEFAULT-MATCH** | EA version has ≥ 1 parameter | no contradicting free-text default claim in `parameters` prose | WARNING when a "default … <number>" phrase names a param whose stated value ≠ the EA definition (normalised). ev `{sectionId, mismatches[]}` |
| 12 | **CHK-UNITS-DEFINED** | manual text uses `point`/`pip`/`poin` | a unit-definition pattern present (`_Point`, `1 pip = …`, `… poin = … pip`, …) | WARNING (term used, no definition). ev `{usesUnitTerms, hasDefinition}` |
| 13 | **CHK-QUICKSTART-DEMO** | always | `quick-start` text tells the user to use a demo account first (not live) | MISSING otherwise. ev `{sectionId, demoFirst}` |
| 14 | **CHK-SAFE-STOP** | always | `quick-start`/`how-it-works` describes stopping the EA safely **with open positions in mind** | MISSING otherwise. ev `{quickStartId, hasSafeStop}` |
| 15 | **CHK-DISCLAIMER-5-5-D** | `pbkScope = IN_SCOPE` | all 3 concepts in `disclaimer` text: automated-tool/aid, does-not-guarantee-profit, does-not-remove-PBK-risk | MISSING (empty or any concept missing). ev `{sectionId, matchedConcepts[], missingConcepts[]}` |
| 16 | **CHK-RISK-GENERAL** | always | `risk`/`disclaimer` states trading is risky **and** capital can decrease/be lost | MISSING otherwise. ev `{sectionKeys, conceptsMatched}` |
| 17 | **CHK-PAST-NOT-FUTURE** | always | `performance`/`disclaimer`/`risk` states past/tester results don't guarantee future results | MISSING otherwise. ev `{sectionKeys, conceptsMatched}` |
| 18 | **CHK-DANGER-MODE-WARN** | `eaDeclaresDangerMode(requirements)` | first block of `risk` is a `callout` with `tone === "warning"` | MISSING (no risk section / not a top warning). ev `{sectionId, firstBlockId, firstBlockType, firstBlockTone}` |
| 19 | **CHK-NO-PROHIBITED-CLAIMS** | always | `scanClaims(projectManualLines(vm))` returns 0 findings | WARNING with ≥ 1 finding — advisory, **no auto-edit**. ev `{findingCount, categories:[{category,categoryLabel,count,excerpt≤160,location}], publishBlockingCategories[]}` |
| 20 | **CHK-KONTAK** | `pbkScope = IN_SCOPE` | ≥ 1 real channel in `ea_versions.support` **and** a 24/7 phrase in `support` text or `support.hours` | WARNING (channel, no 24/7) / MISSING (no channel or empty support). ev `{sectionId, channelKinds[], has247}` |
| 21 | **CHK-KONTAK-SPLIT** | always | `support` text states technical → Smartin, transaction/financial → pialang | MISSING otherwise. ev `{sectionId, mentionsTechnical, mentionsTransaction}` |
| 22 | **CHK-TRANSPARANSI** | `pbkScope = IN_SCOPE` | `transparency` text ≥ 150 chars describing the algorithm/strategy | MISSING (empty/thin) / WARNING (content but no strategy language). ev `{sectionId, length, describesStrategy}` |
| 23 | **CHK-BAHASA-ALGO** | `pbkScope = IN_SCOPE` | `transparency` states the algorithm language is Bahasa Indonesia or English | MISSING otherwise. ev `{sectionKeys, conceptsMatched}` |
| 24 | **CHK-PERIODE-EFEKTIF** | `pbkScope = IN_SCOPE` | `transparency`/`overview` states the effective period of EA usage | MISSING otherwise. ev `{sectionKeys, conceptsMatched}` |
| 25 | **CHK-PERFORMANCE-KONDISI** | a performance figure regex matches in `performance` | ≥ 2 test-condition hits (broker / spread / model / date-range / deposit / leverage / account-type) | WARNING (figure, < 2 conditions). ev `{sectionId, contextHits}` |
| 26 | **CHK-CHANGELOG-VERSI** | always | `changelog` contains the linked EA version string or a `[X.Y.Z]` entry | MISSING (empty or no version entry). ev `{sectionId, eaVersion, hasVersionEntry}` |
| 27 | **CHK-DISCLOSURE-REF** | `pbkScope = IN_SCOPE` | `disclaimer`/`transparency` references the Pasal 9 disclosure statement + recorded-video process | MISSING otherwise. ev `{sectionKeys, conceptsMatched}` |
| 28 | **CHK-ONBOARDING-MARGIN** | `pbkScope = IN_SCOPE` | `overview`/`risk`/`transparency`/`requirements` mentions the ≥ Rp50.000.000 onboarding-margin expectation | MISSING otherwise. ev `{sectionKeys, conceptsMatched}` |
| 29 | **CHK-FITUR-DIJELASKAN** | `requirements.verifiedFeatures[]` non-empty | every declared feature name appears in `how-it-works`/`interface` text | MISSING otherwise. ev `{declaredFeatures[], undocumentedFeatures[]}` |
| 30 | **CHK-INTERFACE** | `requirements.gui === true` | `interface` chapter has an `image` block **and** ≥ 80 chars of control text | MISSING otherwise. ev `{sectionId, hasImage, textLength}` |

Every rule's evidence is id/key/count/bool + (claims only) a ≤ 160-char excerpt — see §9.

`CHK-PARAM-DEFAULT-MATCH` note (spec §14): the Phase-3 `parameterTable` block is **by-reference** — it
always renders the EA definition's exact defaults, so a correctly-referenced table can never itself
mismatch. The rule therefore only scans *free-text* default claims in the `parameters` prose and warns
when an author has typed a number that contradicts the EA definition. This is a `WARNING`, never publish-blocking.

`PUBLISH_BLOCKING_CLAIM_CATEGORIES` (recorded for Phase 6, from `COMPLIANCE_REQUIREMENTS.md` §4): every
claim category **except** `CLAIM-BROKER-PARTNER` (which is advisory-only).

---

## 6. Scope / applicability model

Two independent reasons an item becomes `NOT_APPLICABLE` automatically (`evaluator = "system"`):

1. **PBK scope** — `item.bappebtiOnly && eaPbkScope(requirements) === "OUT_OF_SCOPE"`.
   `eaPbkScope` reads **only** `ea_versions.requirements.pbkScope` (an explicit enum
   `IN_SCOPE | OUT_OF_SCOPE`, default `IN_SCOPE`, Zod-validated at the write boundary in
   `features/ea-versions/schema.ts`, settable in the version-create form). Scope is **never** inferred
   from locale, broker, country, currency, or EA name (spec §1 / PRD-COMP-005). The seven
   `bappebti_only` items (OQ-011): `CHK-DISCLAIMER-5-5-D`, `CHK-KONTAK`, `CHK-TRANSPARANSI`,
   `CHK-BAHASA-ALGO`, `CHK-PERIODE-EFEKTIF`, `CHK-DISCLOSURE-REF`, `CHK-ONBOARDING-MARGIN`. The
   OQ-005 required-chapter set additionally drops `support`/`disclaimer`/`transparency` when
   `OUT_OF_SCOPE`. Every other check still evaluates for `OUT_OF_SCOPE` — including
   `CHK-KONTAK-SPLIT`, which keeps the "a real support chapter exists" obligation alive offshore
   (the 24/7 requirement is the scoped part of `CHK-KONTAK`).
2. **Applicability** — `ruleApplies(checkKey, vm)` is `false`: no EA parameters
   (`CHK-PARAM-COMPLETE`, `CHK-PARAM-DEFAULT-MATCH`), manual never uses point/pip terms
   (`CHK-UNITS-DEFINED`), no performance figure in `performance` (`CHK-PERFORMANCE-KONDISI`),
   EA declares no danger mode (`CHK-DANGER-MODE-WARN`), EA declares no dependencies
   (`CHK-DEPENDENCIES-LISTED`), nothing extra ships (`CHK-PACKAGE-FILES`), no verified features
   (`CHK-FITUR-DIJELASKAN`), no GUI (`CHK-INTERFACE`). Each carries a specific Indonesian reason
   string (`notApplicableReason`).

`NOT_APPLICABLE` is excluded from the score numerator **and** denominator, and never blocks submission.

---

## 7. Automatic vs reviewer `NOT_APPLICABLE` (AC-P5-8)

| | Automatic (`evaluator = "system"`) | Reviewer override (`evaluator = "reviewer"`) |
|---|---|---|
| Trigger | scope rule or `ruleApplies` = false | `overrideChecklistItem({manualId, checkKey, reason})` server action |
| Who | nobody — deterministic | only `canReview(roles)` = `canAny(roles,"review:technical") \|\| canAny(roles,"review:compliance")`. **A pure `DEVELOPER` gets `FORBIDDEN`** (unit-asserted in `tests/unit/permissions.test.ts`; a developer who *also* holds a reviewer role may override, per the multi-role model). |
| Reason | system string | **required**, `5…500` chars, Zod-validated server-side; stored in `override_reason` + surfaced in `reason` |
| Audit | none | `writeAudit(orgId, userId, "checklist:override_na", "checklist_result", null, {checkKey, manualVersionId, previousState, newState, reason≤200})` → append-only `audit_events` |
| Persistence | recomputed every evaluation | **sticky** — `evaluateAndPersist` rebuilds the `overrides` map from `checklist_results` rows that have `override_actor_id`, and `evaluateManual` re-applies it. `systemState` still records what the rule computes now (shown in the panel as "evaluasi otomatis: …"). There is no "un-override" in Phase 5 (spec §26). |

A developer **cannot** self-set `NOT_APPLICABLE`: there is no client write path to `checklist_results`
(no RLS write policy), and `overrideChecklistItem` rejects non-reviewers before any write.

---

## 8. Score formula + zero-denominator (AC-P5-3)

`computeScore(items)` in `lib/validation/evaluate.ts`:

```
inScope     = items.filter(i => i.required && i.state !== "NOT_APPLICABLE")
numerator   = inScope.filter(i => i.state === "PASS").length
denominator = inScope.length
percent     = denominator === 0 ? null : Math.round(numerator * 100 / denominator)
```

- `WARNING` and `MISSING` stay in the denominator and do **not** count as `PASS`.
- `NOT_APPLICABLE` is removed from both sides.
- **Nothing hardcodes 10 / 26 / 31.** The denominator is `items.filter(required && !NA).length` from
  the *active template's* results, so it tracks the real applicable set. On the DEV `VMax EA (DEMO)`
  manual it renders **"3/24 item wajib berstatus Lolos · templat v1"** — 24, because of the 31 items
  `CHK-PACKAGE-FILES` is `required = false` and 6 are `NOT_APPLICABLE` (no deps / danger mode /
  performance figure / verified features / GUI). It moves to 25 when a performance figure appears, etc.
- `CHK-PACKAGE-FILES` (`required = false`) never enters the score or the eligibility gate.
- **Zero-denominator** (`percent === null`): the panel shows `—` (not `0`, not `100`), the heading
  becomes **"Tidak ada item wajib yang berlaku"**, and the sub-line reads
  `0/0 item wajib berstatus Lolos · templat v1`. Never a misleading 100 %.
- Integer arithmetic only (`Math.round`) — 3/7 → 43 %, 4/7 → 57 %, 6/7 → 86 %, 7/7 → 100 %
  (`tests/unit/validation-score.test.ts`); 3/24 → 13 %, 4/24 → 17 % (verified in-browser).

---

## 9. Evidence model (AC-P5-12, PRD-SEC-009)

Every rule returns `evidence` built **only** from ids, keys, counts, booleans, small enum-ish strings,
and — for claims — an excerpt capped at 160 chars. Persisted evidence additionally carries
`_reason` (the human summary, sliced to 400 chars), `_navigateSectionKey`, and `_systemState`
(the reevaluation hint for a reviewer override).

**Never persisted:** credentials, API keys, tokens, signed URLs, any `http(s)://` URL, source code,
the entire manual body, whole fact bundles, whole parameter tables. A dedicated test
(`tests/unit/validation-rules.test.ts`, "evidence & output-string safety") `JSON.stringify`s the full
`ValidationView` and asserts the lower-cased blob contains none of:
`ai_api_key`, `sb_secret`, `sb_publishable`, `authorization`, `bearer `, `http://`, `https://`,
`-----begin`, **and** none of the forbidden compliance strings
(`bappebti approved`, `certified`, `compliant`, `passed compliance`, `regulator approved`,
`disetujui regulator`, `lolos verifikasi`).

---

## 10. Refresh / invalidation model

- **On page load** — the edit server component calls `getValidation({manualId})`. If no
  `checklist_results` rows exist yet it evaluates + persists once; otherwise it reconstructs the
  view from the stored rows (`shapeFromRows`, no rule re-run) so a page load is cheap and stable.
- **After a builder edit** — `SectionEditor` calls `onBlockSaved()` when an autosave settles
  (`state === "saved"`). `ManualBuilder.scheduleValidationRefresh` debounces 1 200 ms then bumps
  `validationNonce`; the panel's `useEffect` calls `refreshValidation({manualId})`, which
  **re-reads the DB** and re-evaluates server-side (never trusts client state).
- **Manual** — the "Perbarui" button calls the same `refreshValidation`.
- **Reviewer override** — `overrideChecklistItem` persists then returns a fresh `evaluateAndPersist` view.
- **Not auto-wired:** chapter add/delete (Phase 3 protects the required canonical sections from
  deletion; custom chapters have non-canonical keys, so they cannot change a checklist result) and
  EA-version edits (picked up on the next page load or "Perbarui"). Documented limitation, not a bug.

---

## 11. Submission-eligibility semantics (AC-P5-6)

`computeEligibility(items)` → `{ ready: boolean, blockingReasons: string[] }`:

```
blocking = items.filter(i => i.required && i.state === "MISSING")
ready    = blocking.length === 0
blockingReasons = blocking.map(i => i.label)
```

- Any required, in-scope `MISSING` ⇒ `ready = false` ⇒ panel shows **"Belum siap dikirim untuk review"** + the list of blocking item labels.
- A `WARNING` alone never sets `ready = false` (verified both directions in unit + browser tests).
- All `PASS` / `NOT_APPLICABLE` ⇒ **"Siap dikirim untuk review"**.
- **This is a signal only.** No Phase 6 transition happens. The **"Kirim review"** button in the builder
  header is permanently `disabled` with `title="Pengiriman review tersedia pada Phase 6"`. No
  DRAFT→TECHNICAL_REVIEW write, no reviewer assignment, no status change anywhere.

---

## 12. RLS / security (verified live — §15)

- `checklist_results` has **no** client `INSERT`/`UPDATE`/`DELETE` policy. Every authenticated role
  tested (developer, technical reviewer, compliance-less outsider, anon) fails a direct write.
  All writes go through the two server actions via the **service-role** client, *after*
  `requireActiveOrg()` + `assertCan`/`canReview`.
- Cross-org: `checklist_results_select_members` scopes reads to `app.member_org_ids()`; an org-B
  user reads zero of org A's results; anon reads nothing.
- The composite FK `(manual_version_id, organization_id) → manual_versions` blocks planting a result
  under another org's manual version.
- `unique (manual_version_id, check_key)` — duplicate service insert ⇒ `23505` (tested).
- Browser (`ManualBuilder`) never computes an authoritative state; it posts intent
  (`refreshValidation` / `overrideChecklistItem`) and renders what the server returns.

---

## 13. Audit behaviour

- Only the reviewer N/A override writes audit: action `checklist:override_na`, entity type
  `checklist_result`, metadata `{checkKey, manualVersionId, previousState, newState:"NOT_APPLICABLE", reason≤200}`.
- Uses the existing append-only `audit_events` table + `writeAudit` helper — **no second audit table**.
- `audit_events` has no `UPDATE`/`DELETE` policy, so an override record cannot be rewritten or erased
  (one such row remains in DEV from the §15 browser test — intentional, it is a real audit record).
- Automated evaluations do **not** write audit (they are reproducible from content + template version).

---

## 14. UI behaviour + responsive evidence

**Placement.** Builder inspector → "Validasi" tab. Three structurally separate regions, in order
(**AC-P5-10** — not one merged badge):
1. `<ValidationPanel>` — `<h3>Kesiapan dokumentasi</h3>`, the score block, the readiness disclaimer,
   the state-count chips, the eligibility line + blocking list, the per-item list, the "Perbarui" foot.
2. "Status bab ini" — the Phase 3 per-chapter completion buttons (unchanged).
3. "Asisten AI" — the Phase 4 `AiPanel` (unchanged; the Mock-AI banner still reads
   "Mock AI — mode pengembangan, hasil simulasi").

The old Phase 2/3 mock `inspector-score` "%"" display was **removed** (the `progress` prop is gone
from `Inspector`).

**Wording.** Only: "Kesiapan dokumentasi", "Kesiapan dokumentasi X %", "Tidak ada item wajib yang
berlaku", "Siap dikirim untuk review", "Belum siap dikirim untuk review", "Lolos", "Perlu ditinjau",
"Perlu dilengkapi", "Tidak berlaku", and the fixed line **"Skor ini mengukur kelengkapan dokumentasi
dan bukan persetujuan regulator. Keputusan review kepatuhan adalah tindakan manusia yang terpisah
(Phase 6)."** No "Approved / Bappebti / Certified / Compliant / Lolos verifikasi / Disetujui regulator"
anywhere (**AC-P5-9**, string-scanned in tests and in-browser).

**31 items, grouped.** The panel renders one `<section class="v-group">` per category, in the fixed
order `identity → installation → how-it-works → risk → support → performance → bappebti`, each with a
`<h4>` subheading + a `passed/total` tally (e.g. "Identitas & Versi 1/4", "Cara Kerja & Setelan 1/10").
Category labels come from `CATEGORY_LABELS` in `lib/validation/types.ts`. No builder redesign; the
grouping is CSS-only (`.v-group` / `.v-group-head` / `.v-group-tally`).

**Per-item affordances.** state icon + text label (never colour alone) · the item label · the reason ·
(reviewer only, non-N/A items) a "Tandai tidak berlaku" button opening an inline reason form
(textarea, `maxLength 500`, "Simpan" disabled until `reason.trim().length ≥ 5`, "Batal") ·
a "Buka bab …" link that calls `onNavigateSection(key)` → selects that section in the builder ·
an override provenance line ("Ditandai tidak berlaku oleh <name> (evaluasi otomatis: <systemState>)").

**Responsive — re-verified with the full 31-item grouped panel in the in-app browser at 1440 / 1024 /
768 / 375** (geometry, not CSS inspection alone). For every width: `documentElement.scrollWidth ===
clientWidth`, no page or body horizontal scroll; `.validation-panel` / `.v-counts` / `.v-group-head` /
`.v-item` / `.v-item-head` / `.v-item-reason` / `.v-blocking` all have `scrollWidth ≤ clientWidth`;
count chips wrap; the 19-item blocking list wraps; the 7 group subheadings wrap; the inspector (inline
≥ 1280, drawer `.inspector-panel` < 1280) scrolls vertically for all 31 rows; every control stays
inside the panel (`panelW 299`, `right ≤ viewport`); the inline N/A reason form + Simpan/Batal fit.
375 measured: `panelW 299`, `right 360 < 375`, `allButtonsInside true`. A **fresh** editor tab loaded
after a clean dev-server restart shows **zero console errors** (the `groupedItems` errors seen earlier
were a Turbopack HMR hot-swap artifact during editing; they do not occur on a clean load or in
`npm run build`).

---

## 15. Live Supabase DEV evidence

- **`20260901001100`** applied earlier (first Phase 5 pass). **`20260901001200`** (the completeness
  correction) content inspected, then `npx supabase db push --dry-run` → `db push` →
  `npx supabase migration list`: **`20260901001200` present as both `local` and `remote`**; all
  **13** migrations aligned (local == remote).
- Post-migration DB inspection (service role): 1 active template row
  (`smartin-documentation-checklist` v1), **31** `checklist_items` at positions `0…30`,
  `CHK-REQUIRED-CHAPTER` absent, `rule_key == check_key` for all 31, exactly one non-required item
  (`CHK-PACKAGE-FILES`) and seven `bappebti_only` items. `checklist_results` policies =
  `checklist_results_select_members` only (no write policy); grants = `authenticated` SELECT /
  `service_role` full.
- `npx vitest run tests/integration` against Supabase DEV (`SUPABASE_TEST_URL` /
  `SUPABASE_TEST_ANON_KEY` = the DEV project's URL + publishable key, `SUPABASE_SECRET_KEY` = the DEV
  service key): **50 passed, 0 failed, 0 skipped**. Run **twice** back-to-back with the same result —
  idempotent cleanup confirmed (the Phase-5 group's `afterAll` deletes its seeded result and asserts
  it is gone; the new drift-guard test reads the live template and checks evaluator coverage).
- Fixture hygiene: browser-test blocks + `checklist_results` (31 rows, evaluated during the §14
  developer flow / re-evaluation check) created on the `VMax EA (DEMO)` manual version were deleted
  afterwards; DEV `checklist_results` for that manual version = 0, `manual_blocks` = 0 (back to seed
  steady state). See §21 for the one `checklist:override_na` `audit_events` row that intentionally
  remains.

---

## 16. Test evidence

### Unit / logic (`npm run test`) — 305 passed, 50 skipped (the integration file, no creds in that run)
- `tests/unit/validation-rules.test.ts` (70) — **template membership**: `CHECKLIST_V1` is exactly the
  31 decided check ids in order, no duplicates, positions `0…30`, one non-required item, seven
  `bappebti_only`. **Drift guard**: every `rule_key` maps to a `RULES` fn and every `RULES` key is used
  once. **`passingContent()`** (a full 31-chapter fixture) → every item PASS or NA, score 100 %.
  **fail → pass pairs** for all nine AC-P5-4 checks (CHK-INSTALASI, CHK-INSTALL-AUTOTRADING,
  CHK-CARA-KERJA, CHK-SPECIAL-CONDITIONS, CHK-SETTING, CHK-PARAM-COMPLETE, CHK-PARAM-DEFAULT-MATCH,
  CHK-UNITS-DEFINED, CHK-VERSI-MATCH, CHK-PERFORMANCE-KONDISI, CHK-DANGER-MODE-WARN) **plus** the
  PRD-COMP-002 four (CHK-CARA-KERJA / CHK-INSTALASI / CHK-SETTING / CHK-KONTAK all evaluated) and the
  PRD-COMP-005 set (CHK-DEV-LEGAL third-party fail→pass, CHK-TRANSPARANSI, CHK-BAHASA-ALGO,
  CHK-PERIODE-EFEKTIF, CHK-DISCLOSURE-REF, CHK-ONBOARDING-MARGIN). **CHK-NO-PROHIBITED-CLAIMS**
  clean/dirty (publish-blocking categories non-empty; VM unchanged). **Applicability**:
  DEPENDENCIES-LISTED / PACKAGE-FILES / FITUR-DIJELASKAN / INTERFACE each NA → MISSING → PASS.
  **"no silent PASS"**: an all-empty manual earns PASS only on the two "nothing contradicts / nothing
  prohibited" scans; every content check is MISSING. **Evidence + output-string safety** scan (§9).
- `tests/unit/validation-score.test.ts` (15) — `computeScore` (100 / 80 / NA-excluded 67 /
  optional-excluded / zero-denominator→null), `computeEligibility` (MISSING blocks + names; WARNING
  does not), `computeCounts`; **PBK-scope suppression** — the seven `bappebti_only` items all NA
  OUT_OF_SCOPE, no false MISSING, general checks (incl. CHK-KONTAK-SPLIT) still run, **the score
  denominator shrinks OUT_OF_SCOPE**; recompute after a content change (CHK-INSTALASI MISSING→PASS,
  score rises); reviewer override preserved across re-evaluation (state NA, evaluator "reviewer",
  `systemState` MISSING, `override.actorName`).
- `tests/unit/permissions.test.ts` (+1) — `canAny(["DEVELOPER"], "review:technical") === false`,
  `… "review:compliance" === false`, `canReview(["DEVELOPER"]) === false`; a reviewer role flips it.

### Live integration (`npx vitest run tests/integration`, Supabase DEV) — 50 passed, 0 failed, 0 skipped
`tests/integration/rls.test.ts` → "Phase 5 — checklist RLS" (9): the live template has **31 items**
in the decided order at positions `0…30` with `CHK-REQUIRED-CHAPTER` gone, one non-required + seven
bappebti-only; **drift guard** — every seeded `rule_key` maps to a `RULES` fn and vice-versa; a seeded
result records template version 1; templates/items readable, not client-writable; **no authenticated
role** can `INSERT`/`UPDATE`/`DELETE` a `checklist_result`; a developer reads its own org's results;
an org-B outsider reads none; anon can neither read nor write; the `(manual_version_id, check_key)`
unique constraint returns `23505` on a duplicate service insert.

### Browser (in-app browser, dev server on Supabase DEV, `developer@smartin.demo`)
- **Full v1 item set**: the "Validasi" tab renders **31 items in 7 category groups** ("Identitas &
  Versi 1/4", "Instalasi & Paket 0/4", "Cara Kerja & Setelan 1/10", "Risiko & Klaim 1/5", "Dukungan &
  Transparansi 0/5", "Bukti Kinerja 0/1", "Rujukan Lingkup Bappebti 0/2"). Score reads
  **"3/24 item wajib berstatus Lolos · templat v1"** — 13 %, a **dynamic** denominator (24, not
  10/26/31); counts 3 / 3 / 19 / 6 sum to 31.
- **Fix one item → re-evaluate**: adding a `[1.0.0] — …` text block to the Changelog chapter →
  autosave → after ~1.2 s the panel refreshed on its own: `CHK-CHANGELOG-VERSI` MISSING → "Lolos",
  score 13 % → 17 % (3/24 → 4/24), counts updated. Deleting the block (soft-delete) reverts it.
- **Wording / separation**: inspector headings are `Kesiapan dokumentasi` (+ 7 group subheadings) /
  `Status bab ini` / `Asisten AI` — three separate regions (AC-P5-10). "Kirim review" `disabled`,
  `title="Pengiriman review tersedia pada Phase 6"`. A panel-text scan finds none of
  "bappebti approved / certified / compliant / lolos verifikasi / disetujui regulator / passed
  compliance" (AC-P5-9).
- **Responsive**: §14.

---

## 17. Regression (Phase 2 / 3 / 4)

- `npm run lint` clean · `npm run typecheck` clean · `npm run test` 305 passed / 50 skipped ·
  `npm run build` exit 0 · integration 50 passed (2 runs, idempotent).
- **Phase 2** — role-aware access confirmed earlier in-browser: `reviewer@` gets a read-only builder,
  `developer@` gets the editor. Org isolation + composite-FK integrity covered by the live integration
  suite (still green after the migration).
- **Phase 3** — add block (type menu Teks / Langkah instalasi / Gambar / Callout / Tabel parameter /
  FAQ), edit + autosave, Undo → Redo, soft-delete + restore — verified; the `SectionEditor`
  `onBlockSaved` prop is optional and fires only on `state === "saved"` (unchanged from first pass).
- **Phase 4** — `AiPanel` still renders as its own "Asisten AI" region distinct from the 31-item
  checklist; Mock-AI banner intact; `scanClaims` imported not modified; its unit suites still pass.

---

## 18. Known limitations (deliberate, within Phase 5 scope)

- Checklist **v1 = 31 items** (the full `COMPLIANCE_REQUIREMENTS.md` §12 set). Presence of the
  `overview` / `presets` / `troubleshooting` chapters (which have no dedicated §12 item) is covered by
  the Phase 3 per-chapter completion state, not a Phase 5 checklist item.
- Rule matchers are conservative deterministic regex / keyword / concept-count matchers (no LLM). They
  can miss a cleverly-worded statement or over-warn on unusual phrasing — by design; a human reviewer
  is the backstop and can mark an item `NOT_APPLICABLE` with a recorded reason. Threshold choices
  (`CHK-CARA-KERJA` ≥ 200 chars + entry/mgmt/exit; `CHK-SPECIAL-CONDITIONS` ≥ 4 of 5;
  `CHK-TRANSPARANSI` ≥ 150 chars) are documented in §5 and the seed descriptions.
- `CHK-FITUR-DIJELASKAN` and `CHK-INTERFACE` depend on the new `requirements.verifiedFeatures[]` /
  `requirements.gui` keys. `gui` has a create-form checkbox; `verifiedFeatures` has no UI yet (a
  future EA-version edit surface) so it is empty → `CHK-FITUR-DIJELASKAN` is `NOT_APPLICABLE` until
  that data exists. Neither key is ever inferred.
- Auto-refresh covers block/section autosave only; chapter add/delete and EA-version edits need a page
  reload or "Perbarui" (§10).
- Reviewer N/A is sticky with no in-product "un-override" (spec §26 — clearing is Phase 6).
- `publish_blocking` is **recorded** on items and in claim evidence but nothing enforces it in Phase 5
  (no publish path exists yet).
- Image `scan_status` is not a checklist item or a submission blocker (OQ-009 decision).
- `pbkScope` / `dangerMode` / `gui` are `ea_versions.requirements` JSON keys with no dedicated *edit*
  screen — set at version-create time; existing rows default to `IN_SCOPE` / `false` / `false`.

---

## 19. Acceptance-criteria matrix (AC-P5-1 … AC-P5-13)

| AC | Verdict | Evidence |
|---|---|---|
| **AC-P5-1** | PASS | Phase-gate: lint / typecheck / build / 305 unit / 50 live integration all green; GI-1 extended to computed output (§9 output-string scan test + browser panel-text scan); GI-11 (foreign EA-Version group rejected) still green in integration. |
| **AC-P5-2** | PASS | Migration §2: `unique (manual_version_id, check_key)`, `state` CHECK ∈ {PASS,WARNING,MISSING,NOT_APPLICABLE}, `evidence` jsonb, `evaluator` CHECK ∈ {system,reviewer}, `evaluated_at`. Live DB inspection ("31 items at positions 0…30") + the `23505` duplicate test. |
| **AC-P5-3** | PASS | `computeScore` (§8) — `validation-score.test.ts` (100/80/67/null); "recompute after content change" (MISSING→PASS, score rises); browser: score moved 13 %→17 % live after an edit; **denominator is dynamic** (24 on the DEV manual — 31 minus 1 non-required minus 6 NA), no 10/26/31 hardcode. |
| **AC-P5-4** | PASS | `validation-rules.test.ts` — a fail→pass fixture pair for all nine machine-checkable checks (CHK-INSTALASI, CHK-CARA-KERJA, CHK-SETTING, CHK-PARAM-COMPLETE, CHK-PARAM-DEFAULT-MATCH, CHK-DISCLAIMER-5-5-D, CHK-KONTAK, CHK-UNITS-DEFINED, CHK-VERSI-MATCH, CHK-PERFORMANCE-KONDISI, CHK-DANGER-MODE-WARN) + the remaining 20 items each have fail/pass or scope/applicability fixtures. |
| **AC-P5-5** | PASS | `CHK-NO-PROHIBITED-CLAIMS` clean→PASS / dirty→WARNING; `publishBlockingCategories` non-empty on a profit-guarantee fixture; VM unchanged (no auto-edit). Reuses the Phase 4 `scanClaims` — no second scanner. |
| **AC-P5-6** | PASS | `computeEligibility` (§11) — both directions (required MISSING blocks + names; WARNING does not); browser: 19-item blocking list on the empty DEV manual, "Belum siap dikirim untuk review". No Phase 6 transition; "Kirim review" stays `disabled`. |
| **AC-P5-7** | PASS | `eaPbkScope` + the seven `bappebti_only` items (§6); `validation-score.test.ts` "PBK scope suppression" — all seven NA OUT_OF_SCOPE (evaluator system), no false MISSING, `CHK-KONTAK-SPLIT` + general checks still run, score denominator shrinks. |
| **AC-P5-8** | PASS | `overrideChecklistItem` requires `canReview` (pure DEVELOPER → FORBIDDEN, unit-asserted), a 5–500-char reason (Zod), writes `audit_events` `checklist:override_na`; integration confirms no role can write `checklist_results` directly; §21 (a real audit row from the first-pass browser test remains). |
| **AC-P5-9** | PASS | Wording set §14; output-string safety test scans the full `ValidationView` JSON; browser scan of the rendered panel/inspector text. None of the forbidden strings present. |
| **AC-P5-10** | PASS | §14 — three separate inspector regions (`ValidationPanel` `<section>` with 7 category groups / "Status bab ini" / "Asisten AI" `AiPanel`); no review-decision control; not one badge. Verified in-browser. |
| **AC-P5-11** | PASS | `checklist_results.checklist_template_id` + `.checklist_template_version` written by `evaluateAndPersist`; integration test; §3 no-silent-migration; `…001200` keeps `version = 1`. |
| **AC-P5-12** | PASS | Evidence model §9 — id/key/count/bool + ≤160-char excerpt only; dedicated `JSON.stringify` scan for `ai_api_key`/`sb_secret`/`authorization`/`bearer`/`http(s)://`/`-----begin`. |
| **AC-P5-13** | PASS | §1 — recorded decisions for PRD-OQ-004 (**31-item set**), OQ-005 (required chapters + conditionals), OQ-009 (image scan not a Phase 5 gate), OQ-011 (seven bappebti-only items suppressed OUT_OF_SCOPE). Written before the dependent code + migration. |

No AC is FAIL / NOT TESTED / BLOCKED.

---

## 20. §55 report checklist

1. **Phase implemented:** 5 only (+ the checklist-completeness correction). 2. **Phase 6 not started:**
confirmed — no review assignment, comments, approvals, DRAFT→TECHNICAL_REVIEW, publishing, snapshots,
public routes, PDF, or cloning. 3. **New migration:**
`supabase/migrations/20260901001200_phase5_checklist_v1_full.sql` (after the already-deployed
`…001100`). 4. **Deployed migrations edited:** none. 5. **Applied to DEV:** yes — content inspected +
dry-run + push + `migration list` local == remote (13 migrations). 6. **New tables:** none this pass
(the three from `…001100`); the correction only reseeds `checklist_items`. 7. **RLS:** unchanged —
SELECT-only for authenticated; no client write on any of the three; service-role DML. 8. **New deps:**
none. 9. **LLM in checklist rules:** none. 10. **Claim scanner:** the Phase 4 `scanClaims` reused
verbatim; no duplicate. 11. **Central evaluator:** `lib/validation/evaluate.ts` `evaluateManual` — one
definition; 31 rules in `rules.ts` sharing small primitives; UI renders only; drift guard fails on an
unmapped `rule_key`. 12. **States:** exactly PASS / WARNING / MISSING / NOT_APPLICABLE. 13. **Score:**
required in-scope PASS ÷ required in-scope, NA excluded both sides; **dynamic denominator** from the
active template (24 on the DEV manual); zero-denominator → `—` + "Tidak ada item wajib yang berlaku".
14. **Eligibility:** `{ready, blockingReasons}`; any required in-scope MISSING blocks; WARNING does
not. 15. **No workflow transition:** "Kirim review" permanently `disabled` with a Phase 6 title.
16. **Reviewer N/A:** reviewer-only, reason 5–500 chars, audited, sticky. 17. **Developer self-N/A:**
impossible (no write path + role check). 18. **Scope:** explicit `requirements.pbkScope` only; never
inferred; seven `bappebti_only` items suppressed OUT_OF_SCOPE. 19. **Evidence safety:**
id/key/count/bool + ≤160-char excerpt; scanned in tests. 20. **Versioning:**
`checklist_template_version` on every result; `…001200` keeps `version = 1`; no silent migration.
21. **UI:** real panel, 31 items in 7 category groups; checklist / chapter-status / AI-assistant are
three separate regions. 22. **Responsive:** 1440 / 1024 / 768 / 375 re-verified in-browser with the
full 31-item panel (geometry + a clean-tab console read = zero errors). 23. **Tests:** `npm run lint`
clean, `npm run typecheck` clean, `npm run test` 305 pass / 50 skip, `npm run build` exit 0,
`npx vitest run tests/integration` 50 pass / 0 fail / 0 skip (×2, idempotent). 24. **State at
finalization:** committed + pushed as `feat(phase-5): add validation and compliance checklist`; DEV
`checklist_results` + test `manual_blocks` cleaned to seed steady state; one append-only
`checklist:override_na` audit row remains (§21).

---

## 21. DEV QA audit event (not fixture leakage)

The DEV `audit_events` table holds **one** `checklist:override_na` row. Its metadata:

```
checkKey        CHK-NO-PROHIBITED-CLAIMS
previousState   WARNING
newState        NOT_APPLICABLE
manualVersionId 20000000-0000-4000-8000-000000000020   (VMax EA (DEMO))
reason          "Frasa uji browser Phase 5 — bukan konten manual sebenarnya; ditinjau reviewer."
created_at      2026-08-29T10:11:47Z
```

It was written during the Phase 5 reviewer-override verification: `reviewer@smartin.demo` marked
`CHK-NO-PROHIBITED-CLAIMS` (which had gone `WARNING` on a deliberately-planted test claim) as
`NOT_APPLICABLE` with a recorded reason, exercising `overrideChecklistItem` end to end. `audit_events`
is **append-only** by design (no `UPDATE` / `DELETE` policy) — deleting it would violate the audit
model, so it is kept.

- It **is** a DEV QA audit event, produced by the Phase 5 reviewer-override test.
- It is **not** checklist/result fixture leakage: all test-created `checklist_results` (31 rows) and
  `manual_blocks` on that manual version were removed; the manual version is back to seed steady state
  (0 blocks, 0 results, verified live).
- Future automated integration tests should avoid accumulating permanent audit rows where possible —
  the current Phase 5 integration suite writes none (it seeds/deletes only `checklist_results`, which
  are not audited).
