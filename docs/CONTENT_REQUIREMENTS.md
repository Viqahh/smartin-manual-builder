# Content Requirements — Smartin EA Manual Book

> The canonical structure and per-chapter content rules for a Smartin EA Manual Book.
>
> **Sources:** `Panduan_Manual_Book_EA_Kontributor.pdf` (contributor guide; its Bab 3 chapter table and Bab 4 per-chapter writing rules; its Perba Bappebti 12/2022 summary) and `User Manual SAS SMARTBOT 2024 update.pdf` (a real Smartin EA manual, used as a domain example). These are references, not visual templates.
>
> **Alignment:** the 18 chapters below match `features/manuals/mock-data.ts` `chapters` (`cover`…`transparency`) and the `docs/DATA_MODEL.md` section/block model. Block types are `text`, `steps`, `image`, `callout`, `parameterTable`, `faq`.
>
> **Non-negotiable principles (contributor guide §1.2):**
> 1. Never promise profit. The manual explains how it works, not future results.
> 2. One fact, one place. Input name, default, and unit are identical in code, `.set`, and manual.
> 3. Steps are followable without guessing — every action has a clear menu location.
> 4. Write what the EA does **not** do. Limits matter more than a feature list.
> 5. Version the manual with the EA release. Manual vX.Y must not describe vX.(Y+n) behaviour.
> 6. If the EA is for Indonesian Perdagangan Berjangka Komoditi, satisfy Perba Bappebti 12/2022 before the draft is "done".

---

## Chapter map

| # | Key (`section key`) | Title (ID) | Required? | Notes |
|---|---|---|---|---|
| 0 | `cover` | Sampul & Identitas Produk / Cover & Product Identity | **Required** | EA identity + both version strings |
| 1 | `overview` | Ringkasan Produk / Product Overview | **Required** | ≤ 1 page, 4 questions |
| 2 | `requirements` | Persyaratan Sistem & Broker / System & Broker Requirements | **Required** | Bappebti "cara instalasi" support |
| 3 | `package` | Isi Paket / Package Contents | Recommended | Required if extra files ship |
| 4 | `installation` | Instalasi / Installation | **Required** | Bappebti "cara instalasi" |
| 5 | `quick-start` | Mulai Cepat / Quick Start | **Required** | Demo-first, ≤ 10 min |
| 6 | `how-it-works` | Cara Kerja EA / How the EA Works | **Required** | Bappebti "cara kerja" |
| 7 | `parameters` | Referensi Input / Parameter / Input / Parameter Reference | **Required** | Bappebti "cara setting" |
| 8 | `risk` | Risiko & Manajemen Dana / Risk & Money Management | **Required** | Danger-mode warnings |
| 9 | `presets` | Preset, Pair & Timeframe / Presets, Pair & Timeframe | **Required** | Explicit `ea_version_setups` rows |
| 10 | `interface` | Antarmuka EA / EA Interface | Conditional | Required **if** the EA has a GUI/panel |
| 11 | `performance` | Informasi Backtest / Backtest & Performance Information | **Required** (with conditions) | No guarantees; test conditions mandatory |
| 12 | `troubleshooting` | Pemecahan Masalah / Troubleshooting | **Required** | Symptom-first |
| 13 | `faq` | Pertanyaan Umum / FAQ | Recommended | Mandatory question set below |
| 14 | `changelog` | Catatan Perubahan / Changelog | **Required** | Added/Changed/Fixed/Breaking |
| 15 | `disclaimer` | Pernyataan Risiko / Disclaimer & Risk Statement | **Required if Bappebti scope** (always recommended) | Must contain the Pasal 5(5)d sentence |
| 16 | `support` | Dukungan / Support | **Required if Bappebti scope** (always recommended) | 24/7 contact, real channels |
| 17 | `transparency` | Transparansi Strategi / Strategy Transparency | **Required if Bappebti scope** | Algorithm/strategy + effective period, no results |

> **Open question `PRD-OQ-005`:** `mock-data.ts` currently marks 15 of 18 chapters `required`; `templates/page.tsx` copy says 13. The table above proposes the intended split (10, 15, 16, 17 are conditional on GUI presence / Bappebti scope). The exact `required` flag per chapter is finalised with the manual template in Phase 2 and the checklist template in Phase 5.

Allowed everywhere: a chapter may always contain `text` and `callout` blocks. Chapter-specific block guidance is in each section below. `custom` chapters (Phase 3) may be added after #17 and are never `required`.

---

## 0. Cover & Product Identity — `cover`

- **Purpose:** unambiguously identify the product and the exact version this document describes.
- **Required information:**
  - EA name (must match the Navigator name and the compiled file base name).
  - Platform: MT4 or MT5 (if both editions exist, state the file difference, do not merge conflicting steps — contributor guide §4.1).
  - **EA version** string (e.g. `1.4.2`) and **Manual version** string, shown as distinct values.
  - Build/release date.
  - Compiled file name(s): `NamaEA.ex4` / `NamaEA.ex5`.
  - Developer / contributor and organisation (PT Smartin Advisor Sistem, or the third-party developer + the cooperation note if not self-built — Perba 12/2022 Pasal 5(4)a, Pasal 6).
  - The statement "Dokumentasi ini berlaku untuk versi X.Y.Z."
  - Support contact (at least email; full channels in Chapter 16).
- **Optional:** logo/brand lockup, document classification, language marker, a "Sample / Demo" marker for non-production content.
- **Allowed blocks:** `text`, `image` (brand only), `callout` (e.g. demo marker).
- **Expected screenshots / tables:** none required. A small identity `<dl>` (Platform / EA Version / Manual Version / Release Date).
- **Validation:** EA name present; EA version and Manual version both present and both valid semver; platform ∈ {MT4, MT5}; release date present; developer + organisation present; "berlaku untuk versi X.Y.Z" present; EA version equals the referenced `ea_versions` string (version-mismatch check).
- **Risky / prohibited:** no tagline that promises results ("robot auto profit", "winrate tinggi"); no "disetujui Bappebti" / "Bappebti Approved" / "Approved" unless a verified approval record exists (there is none in this tool).

---

## 1. Product Overview — `overview`

- **Purpose:** in ~10 lines, tell the reader what the EA does and does not do (contributor guide §4.2).
- **Required information (answer exactly these four):**
  1. On what basis does the EA enter the market? (e.g. candlestick pattern + MA + RSI; breakout of the Asian session; mean reversion on H1.)
  2. How does it manage positions? (single position, grid, martingale, hedging, partial close.)
  3. What must the user supervise? (fully auto, semi-auto, needs button confirmation.)
  4. Who is it **not** for? (1-minute scalpers on wide-spread brokers, cent accounts, etc.)
- **Optional:** a short fact grid (Platform, EA version, primary symbol, primary timeframe), a one-line strategy family label.
- **Allowed blocks:** `text` (lead + prose), `callout` (`tip`/`info`), small `text`/fact grid.
- **Expected screenshots / tables:** none required.
- **Validation:** all four questions answered in prose; length ≤ ~1 page; no performance figures; consistent with Chapter 6 (strategy) and the EA Version requirements (symbols/timeframes).
- **Risky / prohibited:** "EA super akurat, winrate tinggi, cocok semua pair, profit setiap hari" (contributor guide's rejected example); any guaranteed/consistent/risk-free claim; comparisons to competitor EAs.

---

## 2. System & Broker Requirements — `requirements`

- **Purpose:** state the conditions that make the EA fail if ignored (contributor guide §4.3).
- **Required information:**
  - Platform + minimum build (e.g. "MetaTrader 5 build 4000 atau lebih baru").
  - Account type: hedging / netting; state which is tested and which is untested.
  - The **explicit supported configurations** — each an addressable `symbol × timeframe` row from the EA Version (`ea_version_setups`), with `symbol` keeping any broker prefix/suffix (e.g. `XAUUSD`, `XAUUSD.m`, `EURUSD.pro`). Render them as discrete rows; never a free-text list, and never imply a combination that has no row.
  - Chart timeframe to attach on (from the configuration rows), and the effect of using an unlisted timeframe.
  - Minimum deposit for **testing** (demo). Where a configuration carries a **Tested Minimum Lot**, present it as developer test data and add: *"The actual minimum lot is determined by the broker's symbol specification."* Any broker/account volume constraint is documented separately and must not contradict the tested value.
  - Leverage stance (usually "risk computed from equity; no specific leverage forced").
  - VPS need: Ya / Tidak / Disarankan, with the reason (AutoTrading must stay alive).
  - DLL required: Ya / Tidak. WebRequest required: Ya / Tidak (+ the URL allowlist if yes).
  - Custom indicator dependencies (e.g. `SessionHighLow.ex5` in `Indicators/`); what happens if missing (OnInit fails, red smiley).
- **Optional:** OS notes, terminal locale notes, broker server-time example (how to read it in Market Watch).
- **Allowed blocks:** `text`, `parameterTable`-style `text` table (Item / Contoh isian), `callout` (`warning` for a hard requirement), `image` (Market Watch server-time example).
- **Expected screenshots / tables:** a requirements table (Item → concrete value). Optional screenshot of the symbol spec / server time.
- **Validation:** platform + build present; account type stated with tested/untested; ≥ 1 supported configuration row rendered explicitly (no inferred `symbol × timeframe`); suffix handling covered; testing deposit present; any Tested Minimum Lot labelled as tested data with the "broker's symbol specification" statement present; VPS/DLL/WebRequest each explicitly Ya/Tidak/Disarankan; every declared custom indicator dependency listed with the missing-file behaviour; consistency with the EA Version record.
- **Risky / prohibited:** implying "works on any pair / any account" without testing; omitting the suffix problem (a top contributor mistake); presenting Tested Minimum Lot as an EA-controlled universal minimum lot; stating a required minimum **real** deposit as a promise of adequacy.

---

## 3. Package Contents — `package`

- **Purpose:** list exactly the files the user receives (contributor guide §4.4).
- **Required (if any non-EA file ships):**
  - `Experts/NamaEA.ex5` — main file.
  - Each `Indicators/*.ex5` dependency, marked "wajib" where inisialisasi fails without it.
  - Each `Presets/*.set` official preset.
  - `Docs/Manual_NamaEA_vX.Y.Z.pdf` — this document.
  - Licence file, if any.
  - For each support file: what happens if it is missing (OnInit failure, red smiley, a specific log line).
- **Optional:** checksums, archive layout, "where to get updates".
- **Allowed blocks:** `text` (file list), `callout` (`warning` for "missing file → EA will not init").
- **Expected screenshots / tables:** a file list; optionally a screenshot of the correct folder layout (shared with Chapter 4).
- **Validation:** if the EA Version declares dependencies or presets, this chapter (or Chapter 4) must list them; the manual PDF name follows `Manual_<EAName>_v<X.Y.Z>.pdf`.
- **Risky / prohibited:** listing files not actually distributed; referencing an internal build path.

---

## 4. Installation — `installation`

- **Purpose:** a followable, no-guessing install for both "from Market" and "from outside Market" (contributor guide §4.5). Keep the two separate — do not mix.
- **Required information (ordered steps):**
  1. Open the correct terminal (MT4 or MT5).
  2. `File → Open Data Folder`.
  3. Enter `MQL5/Experts` (or `MQL4/Experts`).
  4. Copy the `.ex5`/`.mq5` file there.
  5. If custom indicators: copy to `MQL5/Indicators`.
  6. If presets: copy to `MQL5/Presets`.
  7. In Navigator, right-click **Expert Advisors → Refresh**.
  8. Restart the terminal if the name does not appear.
  - Then AutoTrading conditions: the global **Algo Trading** button must be on; on the EA's **Common** tab, **Allow Algo Trading** must be checked.
  - Explain the smiley icon in the chart corner (green/normal vs red/blocked).
- **Optional:** Market install path (Navigator → Market → Installed), update-in-place notes, a "close the platform before copying" note if the broker requires it.
- **Allowed blocks:** `steps` (primary), `image` (one per decisive click), `callout` (`warning`: use a demo account first; EA is an aid, results not guaranteed).
- **Expected screenshots / tables:** at least one screenshot of the `File → Open Data Folder` path and the `MQL5/Experts` location; a screenshot of the Navigator Refresh; a screenshot of the AutoTrading / Common permission. Each figure has a caption describing what it shows (not "Gambar 3").
- **Validation:** ≥ 1 `steps` block with ≥ 5 ordered steps; each step has a title + instruction; menu paths present where an action has a location; AutoTrading + Allow Algo Trading covered; smiley explained; ≥ 1 image with alt text and a descriptive caption; MT4 and MT5 steps not intermixed.
- **Risky / prohibited:** instructions to disable account protection or work around a broker limit (contributor guide §5.3); "install and it just profits".

---

## 5. Quick Start — `quick-start`

- **Purpose:** the most valuable chapter — a first-time user sees the EA alive on **demo** within 10 minutes (contributor guide §4.6).
- **Required information (ordered):**
  - Choose a **demo** account, not live.
  - Open a chart for an official symbol at an official timeframe.
  - Attach the EA, load the official preset.
  - Check the trading-permission box, press OK.
  - What must be visible: green smiley, panel/label, log line "initialized".
  - How to safely stop the EA (do not just close the chart if positions are open).
- **Optional:** a 3-line "if nothing happens, see Troubleshooting" pointer; expected first-signal timeframe.
- **Allowed blocks:** `steps` (primary), `image` (attach dialog, smiley, log), `callout` (`warning`: demo only; `tip`: safe-stop).
- **Expected screenshots / tables:** attach-EA dialog with the permission box; the "alive" state (smiley + panel + log).
- **Validation:** demo-only stated; official symbol + timeframe referenced from the EA Version setups; "what you should see" listed; safe-stop procedure present; ≥ 1 image with alt text + caption.
- **Risky / prohibited:** starting on a live account; implying immediate profit; skipping the safe-stop instruction.

---

## 6. How the EA Works — `how-it-works`

- **Purpose:** explain the logic in a trader's language, then technical terms (contributor guide §4.7). This is Perba 12/2022's "cara kerja".
- **Required information:**
  - Entry conditions ("jika–maka" rules). Example shape: "Jika candle M15 ditutup di atas high sesi Asia dan tidak ada posisi pada magic number EA ini, maka EA mengirim order Buy dengan SL di low sesi + buffer."
  - Non-entry conditions (when it deliberately does nothing).
  - Position management (single, grid spacing, averaging, partial close, trailing).
  - Exit conditions (TP, SL, opposite signal, time).
  - Time / news filters, if any (state times as **server time**).
  - Behaviour in special conditions (contributor guide §4.7, mandatory):
    - spread too wide — skip or still enter?
    - reconnect / weekend gap — what happens to open positions?
    - OnInit fails — does the EA refuse to start, or run without filters?
    - two charts of the same symbol — double orders?
    - user manually closes a position — does the EA reopen on the next tick?
  - Indicators used and their role (from the domain example: MA/SMA/EMA, RSI with 70/30/50 levels, Engulfing bullish/bearish; whether all must agree or any one triggers).
  - Trade modes if applicable (from the domain example: single entry; stop grid via BUY STOP/SELL STOP; limit grid via BUY LIMIT/SELL LIMIT; stop+limit grid) and how order count / distance / lot multiply interact.
- **Optional:** a labelled diagram of the decision flow; a glossary of the EA's own terms.
- **Allowed blocks:** `text` (rules), `callout` (`info` for special-condition behaviour, `warning` for risky mechanics), `image` (decision diagram), `faq`-style Q/A for edge cases.
- **Expected screenshots / tables:** optional decision diagram; no performance charts.
- **Validation:** entry, non-entry, management, exit, and all five special-condition questions answered; times labelled as server time; indicator roles match the EA Version's declared indicators; no strategy fact appears that is not grounded in EA data (AI no-fabrication rule).
- **Risky / prohibited:** describing behaviour the verified build does not have (contributor guide §2.3); "this logic guarantees wins"; hiding a martingale/grid mechanism in vague language.

---

## 7. Input / Parameter Reference — `parameters`

- **Purpose:** the heart of the manual — every input, grouped, with meaning (contributor guide §4.8). This is Perba 12/2022's "cara setting".
- **Ownership:** parameter definitions belong to the **EA Version** (`EAProduct → EAVersion → EAParameterGroup → EAParameter`). This chapter's `parameterTable` blocks *reference* the linked EA Version's groups; they never hold a manual-local copy. Every manual version documenting the same EA Version shows identical definitions (`PRD-CNT-010`).
- **Required information:**
  - Inputs grouped as in the code (e.g. Risk, Signal, Filter, Time, Display; from the domain example also Lot, Filtration, Adjustment).
  - Every input row has: **terminal name** (as shown on the Inputs tab), **technical name** (code identifier), **type** (`bool`/`int`/`double`/`string`/`enum`/`color`), **default** (the value on first attach), **safe range** (min–max or the enum options), **effect** (what changes when the value changes), **when it may be changed** (before start / may change live / needs re-attach).
  - Unit consistency: state explicitly whether values are **points** or **pips** and that points follow `_Point`. If `200` on a 5-digit EURUSD means 20 pips, say so.
  - Special inputs from the domain example, each with an effect: Magic Number (order grouping; must differ per pair when multi-pair), Comment Order (MT4 comment column text), Lot mode (fix vs compound with the compounding divisor), Allow Multiorder, Lot + Max Order, SL / TP / Trailing Stop (0 = disabled), Level order / Lots Multiply / Distance (pending-order modes), TP USD / SL USD (close-all on aggregate USD profit / loss).
- **Optional:** a "most-changed inputs" shortlist; per-group intro sentence.
- **Allowed blocks:** `parameterTable` (references `parameter_groups` **of the manual version's linked EA Version**), `text` (group intros, unit definition), `callout` (`warning`: "do not set two EAs to the same magic on one account").
- **Expected screenshots / tables:** one parameter table per group (columns at minimum: Parameter, Type, Default, Safe range, Effect); optionally a screenshot of the Inputs tab.
- **Validation:** every EA input present (no "phantom" or missing inputs — version-parameter completeness check, `PRD-SUCC-002`); default in the manual equals the code default; type set; safe range set; effect non-empty; points/pips defined; groups have a heading; enum inputs list their options.
- **Risky / prohibited:** raw variable names where a human terminal label exists; copying a marketing description into the effect column; presenting a "recommended aggressive" default without a range and warning.

---

## 8. Risk & Money Management — `risk`

- **Purpose:** explain the lot maths verbally and warn about dangerous modes (contributor guide §4.9).
- **Required information:**
  - The lot formula in words, e.g. "lot = (equity × RiskPercent / 100) ÷ nilai rugi jika SL terkena".
  - Floor lot, step lot, and what happens when the computed lot is below the broker minimum.
  - Fixed-lot vs compounding behaviour (from the domain example: fixed lot stays constant regardless of margin; compounding recomputes lot from `modal ÷ compounding divisor`).
  - Aggregate risk controls (SL USD / TP USD): what they close and on what basis.
  - If the EA has **martingale / unbounded grid / recovery**: a prominent `warning` `callout` at the **top** of the chapter (not a footnote) describing the drawdown risk.
- **Optional:** a worked example ("with USD 1,000 equity and 1% risk and a 200-point SL, lot ≈ …"), a max-exposure table.
- **Allowed blocks:** `callout` (`warning` first if danger mode), `text` (formula + rules), `parameterTable`-style `text` table for exposure.
- **Expected screenshots / tables:** optional exposure table; no equity-curve images.
- **Validation:** verbal lot formula present; floor/step/below-min behaviour present; if the EA Version declares a danger mode, a top-of-chapter warning callout exists; aggregate SL/TP explained if those inputs exist.
- **Risky / prohibited:** "risk-free", "guaranteed recovery", "the grid always recovers"; presenting martingale as safe; omitting the below-min-lot behaviour.

---

## 9. Presets, Pair & Timeframe — `presets`

- **Purpose:** publish only tested presets and the supported setups (contributor guide §4.10). "A preset is a promise."
- **Required information:**
  - The list of **supported configurations** (explicit `ea_version_setups` rows on the EA Version; e.g. `XAUUSD / M15`, `XAUUSD / H1`, `EURUSD / H1`) — one row each, with `symbol` (broker suffixes kept), `timeframe` (controlled MetaTrader value), optional preset reference, optional Tested Minimum Lot (labelled as tested data), optional notes, supported flag. Never a free-text sentence; never an inferred combination.
  - For each official `.set` preset: symbol, timeframe, test broker, test date range, test model, spread notes.
  - How to load a preset (Inputs tab → Load).
- **Optional:** a "conservative vs standard" pair of presets (with honest context), a note on why other pairs are unsupported.
- **Allowed blocks:** `parameterTable`-style `text` table (one row per preset/setup), `text`, `callout` (`info`: "presets are tested configurations, not performance promises").
- **Expected screenshots / tables:** a preset table (symbol / TF / broker / date range / model / spread); optional Load-preset screenshot.
- **Validation:** ≥ 1 supported configuration row rendered explicitly (no inferred `symbol × timeframe`); each published preset has all context columns filled; configurations are consistent with Chapter 2; any Tested Minimum Lot shown is labelled as tested data; no preset is listed that was not tested.
- **Risky / prohibited:** "12 optimal presets" without context; a preset table implying expected returns; "works on all timeframes".

---

## 10. EA Interface — `interface`

- **Purpose:** document the on-chart panel/buttons **if the EA has a GUI** (contributor guide Bab 3 row 10: "Jika ada GUI").
- **Required (when a GUI exists):**
  - A labelled screenshot of the panel.
  - Every button/toggle/field: name, what it does, and any confirmation it triggers.
  - Dashboard read-outs (open PnL, order count, status) and their meaning.
  - How panel actions relate to inputs (e.g. a "Close All" button vs the SL USD input).
- **Optional:** keyboard shortcuts, panel drag/minimise behaviour, multi-monitor notes.
- **Allowed blocks:** `image` (annotated panel), `text` (control-by-control list), `callout` (`warning` for destructive buttons like Close All).
- **Expected screenshots / tables:** at least one annotated panel screenshot; a control table.
- **Validation:** if the EA Version declares a GUI, this chapter is required and must contain ≥ 1 annotated image + a control list; if no GUI, the chapter is `NOT_APPLICABLE`.
- **Risky / prohibited:** a panel screenshot showing a real account number / balance / broker name (must be masked); implying a button "locks in profit".

---

## 11. Backtest & Performance Information — `performance`

- **Purpose:** present test information honestly, always with conditions (contributor guide §4.10, §5.3, §7; Perba 12/2022 Pasal 5(4)e — historical performance kept 5 years, presented with test conditions).
- **Required information (whenever any performance data is shown):**
  - Test conditions: broker, account type, spread model, data model (every tick / control points / open prices), date range, initial deposit, leverage.
  - The metrics named by Perba 12/2022 Pasal 4(3): net profit, growth profit, drawdown — each with its test context.
  - An explicit statement that tester/past results are **not** a guarantee of future results.
  - Why tester results differ from live (spread, slippage, execution).
- **Optional:** forward-test notes, a link to a longer report, screenshots of the Strategy Tester report (with account identifiers masked).
- **Allowed blocks:** `text` (conditions + caveat), `parameterTable`-style `text` table (metric / value / condition), `image` (tester report, masked), `callout` (`warning`: past ≠ future).
- **Validation:** no metric appears without its test conditions (a bare win-rate is `MISSING`/`WARNING`); the "not a guarantee" caveat present; consistent EA version.
- **Risky / prohibited:** win-rate or profit figures without conditions ("data menyesatkan"); an equity curve presented as expected performance; "konsisten profit"; profit-sharing framing.

---

## 12. Troubleshooting — `troubleshooting`

- **Purpose:** resolve problems from the **symptom** the user sees, not the internal cause (contributor guide §4.11).
- **Required information (symptom → common cause → fix), at minimum:**
  - EA not in Navigator → wrong folder / not refreshed → check Data Folder, restart.
  - Red smiley / AutoTrading off → global button or chart permission → enable Algo Trading + check Common.
  - No orders at all → spread/session/TF filter → check Experts log and server time.
  - Duplicate orders → same magic / two charts → one chart per symbol, unique magic.
  - Lot 0 / order rejected → margin or min lot → raise equity or lower risk.
  - Error 130 / invalid stops → SL too close + stop level → widen SL, check symbol spec.
- **Optional:** a "how to read the Experts/Journal log" primer; a decision tree.
- **Allowed blocks:** `parameterTable`-style `text` table (Symptom / Cause / Fix), `text`, `callout` (`tip`).
- **Validation:** ≥ the six standard rows present; each fix has a concrete action; references to logs/menus are accurate.
- **Risky / prohibited:** "if it loses, that's normal, keep it running"; advising to disable stop-outs or broker protections.

---

## 13. FAQ — `faq`

- **Purpose:** answer the recurring questions that generate support tickets (contributor guide §4.12).
- **Required questions (must be answered):**
  - Can it run on many pairs at once?
  - Can the timeframe be changed after the EA is running?
  - Does the EA keep managing positions if moved to another chart?
  - What happens when the VPS reboots?
  - How do I update the version without breaking open positions?
  - Is it suitable for cent accounts / symbols with a suffix?
  - Why do tester results differ from live?
- **Optional:** licensing questions, multi-account use, contact for edge cases.
- **Allowed blocks:** `faq` (question + answer) primarily; `text` for intro.
- **Validation:** every required question present with a real answer (not "TBD"); answers consistent with Chapters 2, 6, 7, 12.
- **Risky / prohibited:** an answer that promises a result; "yes it works on everything".

---

## 14. Changelog — `changelog`

- **Purpose:** record what changed per version (contributor guide §4.13; Perba 12/2022 Pasal 8 — feature/system changes must be told to the client, approved, and reported to Kepala Bappebti).
- **Required information:**
  - One entry per version: `[X.Y.Z] — YYYY-MM-DD`.
  - Change types: **Added / Changed / Fixed / Breaking**.
  - For a **Breaking** change: its impact on users with open positions (e.g. magic number changed, input renamed, lot engine changed).
  - The source EA version each entry corresponds to.
- **Optional:** links to the relevant chapter updates; migration steps.
- **Allowed blocks:** `text` (structured entries), `callout` (`warning` on a breaking entry).
- **Validation:** an entry exists for the current Manual Version's EA version; every breaking change states its open-position impact; entry EA version matches an `ea_versions` record.
- **Risky / prohibited:** silently dropping a breaking change; "no changes" when inputs changed.
- **Tool behaviour:** the builder records the changelog and (Phase 6) flags the Pasal 8 obligation (client approval + report to Kepala Bappebti). The tool does not perform the regulatory filing (`PRD-OQ-010`).

---

## 15. Disclaimer & Risk Statement — `disclaimer`

- **Purpose:** state the limits of responsibility clearly, without belittling the user (contributor guide §7; Perba 12/2022 Pasal 5(5)d).
- **Required information:**
  - The mandatory sentence (Pasal 5(5)d), in the disclaimer body — **not** a footnote: the EA is an automated system that is only a tool/aid, does not guarantee profit, and does not remove the risks of Perdagangan Berjangka Komoditi.
  - Trading forex/CFD is risky; capital can decrease or be lost.
  - Tester or past results are not a guarantee of future results.
  - The user is responsible for choosing the broker, lot size, and the decision to go live.
  - The developer cannot control slippage, delay, stop-out, or broker policy.
  - No use of broker logos or "official partner" claims without proof.
  - Reference to the disclosure-statement + recorded-video process with the pialang before running on an Indonesian futures account (Perba 12/2022 Pasal 9).
- **Optional:** jurisdiction notes; a pointer to the full risk-disclosure document the client signed.
- **Allowed blocks:** `text` (statement), `callout` (`warning`).
- **Validation:** the Pasal 5(5)d sentence present in the body (string/intent check); the risk, past-≠-future, and responsibility statements present; the Pasal 9 disclosure/video reference present when the EA is in Bappebti scope.
- **Risky / prohibited:** softening or removing the mandatory sentence; "low risk", "safe", "capital protected"; burying the disclaimer in fine print.

---

## 16. Support — `support`

- **Purpose:** give the user a real way to get help (contributor guide Bab 3 row 16; Perba 12/2022 Pasal 5(4)f — 24/7 assistance that actually operates).
- **Required information:**
  - Support channels that genuinely operate: email, phone, WhatsApp (from the EA Version support details).
  - Hours / availability, and the 24/7 statement where applicable.
  - What support handles vs what it does not: technical issues (install, inputs, errors) vs transaction/financial matters (which go to the pialang).
  - Escalation path if the VPS/EA stops (contact admin to reactivate — from the domain example).
- **Optional:** expected response time, a ticket link, language(s) supported.
- **Allowed blocks:** `text`, `callout` (`info`: what support does not cover).
- **Validation:** at least one real contact channel present; the technical-vs-transaction split stated; the 24/7 line present when in Bappebti scope; channels match the EA Version support record.
- **Risky / prohibited:** a dead phone/email; implying support will manage the account or guarantee outcomes; directing margin/payments to a developer contact (Perba 12/2022 — margin only at a licensed pialang).

---

## 17. Strategy Transparency — `transparency`

- **Purpose:** disclose the algorithm/strategy and the effective usage period without promising results (Perba 12/2022 Pasal 5(4)c and Pasal 5(6) points 4–5).
- **Required information (when in Bappebti scope):**
  - A plain-language description of the algorithm / trading system (consistent with Chapter 6, at the level a Wakil Penasihat can explain to a client).
  - The command/algorithm language note: the program's algorithm/instructions are in Bahasa Indonesia or English (Perba 12/2022 Pasal 5(4)d).
  - The **effective period** of EA usage (how long a chosen advisory period runs) — Pasal 5(6) point 5.
  - After-sales service on technical problems — Pasal 5(6) point 6 (may cross-reference Chapter 16).
  - Where the EA is not built in-house: developer identity and the cooperation arrangement (Pasal 5(4)a, Pasal 6).
- **Optional:** a high-level architecture summary (without source code), a statement of what is intentionally not disclosed and why.
- **Allowed blocks:** `text`, `callout` (`info`).
- **Validation:** algorithm/strategy description present and consistent with Chapter 6; algorithm language (ID/EN) stated; effective period present; developer legality present when the EA is third-party; no source-code dump (contributor guide §5.3).
- **Risky / prohibited:** "proprietary holy grail" language that discloses nothing; performance claims; profit-sharing framing; MLM/referral framing for EA distribution.

---

## Appendix A — Content blocks reference

| Block | Payload (schema-versioned) | Typical chapters | Notes |
|---|---|---|---|
| `text` | `RichTextDocument` | all | Rendered through an allowlist; no raw HTML. |
| `steps` | `Step[]` (title, instruction, menuPath?, imageAssetId?) | 4, 5 | Ordered; reorder has keyboard/button paths. |
| `image` | `imageAssetId`, `caption?` | 2, 4, 5, 6, 10, 11 | Alt text required for completion; private until publish; caption describes content. |
| `callout` | `tone` ∈ `warning`/`info`/`tip`, `content` | all | `warning` for danger modes / demo-only / destructive controls. |
| `parameterTable` | `groupIds[]` | 7 (and 2/9/11 as `text` tables) | References `parameter_groups` **of the manual version's linked EA Version** (definitions owned by EA Version); renders group heading + columns. |
| `faq` | `question`, `answer` (RichText) | 6 (edge cases), 13 | Required question set in Chapter 13. |

## Appendix B — Prohibited claim language (applies to every chapter, incl. headings, captions, FAQ)

From Perba 12/2022 Pasal 5(3) and contributor guide §2.4:

| Prohibited | Use instead |
|---|---|
| Profit pasti / konsisten / bebas risiko | Alat bantu; hasil tidak dijamin |
| Winrate / hasil tanpa kondisi tes | State broker, spread, model, date range, data limits |
| Profit sharing dari pemakaian EA | Advisory fee only, in a lawful agreement |
| EA bertransaksi atas nama klien | The client decides; the EA executes the client's settings |
| Skema MLM / referral atas penyebaran EA | Official pialang / penasihat channels |
| Kumpulkan margin ke rekening developer | Margin only at a licensed pialang berjangka |
| "Disetujui Bappebti" / "Bappebti Approved" / "Approved" / "Certified" | "Ready for compliance review" / "Documentation checklist completed" |

## Appendix C — Length guidance (contributor guide §3)

- Simple EA: ~8–20 pages. EA with a GUI and many modes: ~20–40 pages.
- Do not compress 80 inputs into one unbroken table — group them.
- Prefer 4 clear chapters over 2 overloaded ones. Custom chapters are allowed; required chapters are never removed.
