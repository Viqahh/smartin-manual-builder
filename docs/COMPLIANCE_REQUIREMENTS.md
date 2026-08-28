# Compliance Requirements — Smartin Manual Builder

> Specification for the **documentation / compliance-assistance** layer: what a Smartin EA Manual Book must contain to be *ready for human compliance review*, how the automated checks behave, and — most importantly — the hard line between an automated documentation result and any form of regulatory approval.
>
> **Sources:** `Panduan_Manual_Book_EA_Kontributor.pdf` (its Perba Bappebti 12/2022 summary, §2.1–2.7, §7, §9-checklist) and the domain example `User Manual SAS SMARTBOT 2024 update.pdf`. This document summarises obligations that touch the manual book; it is **not legal advice** and does not reproduce the regulation. Contributors must read the official text.

---

## 0. The non-negotiable boundary

**This application does not grant regulatory approval. It never certifies a manual, an EA, or an organisation.**

| The tool MUST NEVER say | The tool MAY say |
|---|---|
| "Bappebti Approved" | "Ready for compliance review" |
| "Approved" / "Certified" / "Lolos verifikasi" | "Documentation checklist completed" |
| "Compliant with Perba 12/2022" | "All required documentation items present" |
| "Passed compliance" | "Compliance reviewer decision: approved" *(a named human action, with a timestamp)* |
| "Regulator-verified performance" | "Backtest information provided with test conditions" |

Rules:

1. **Automated checks** produce a *documentation-readiness* signal only. They are computed by rules, not by a person, and carry no regulatory weight.
2. **Human review** is a separate, explicit action by a named `TECHNICAL_REVIEWER` / `COMPLIANCE_REVIEWER`, recorded in `reviews` and `audit_events`. "Compliance reviewer approved" means one Smartin reviewer judged the *documentation* adequate for the workflow to proceed — not that Bappebti, Bursa, or any regulator approved anything.
3. **Actual regulatory processes** (Bursa recommendation + feature verification, Kepala Bappebti approval under Pasal 2(3)/4(1), the Pasal 9 disclosure statement + recorded video, client onboarding) happen **outside this tool**. The tool references them as checklist items and reminders; it never performs, simulates, or asserts their outcome.
4. The UI keeps the two visually and structurally separate: the **checklist panel** is labelled as documentation readiness; the **review decision** is a distinct control with an actor and a timestamp. They are never merged into a single "status: approved" badge.

---

## 1. Scope

| Situation | Compliance layer behaviour |
|---|---|
| EA offered/used in **Indonesian Perdagangan Berjangka Komoditi** via a Penasihat Berjangka | Full Perba 12/2022 checklist applies; chapters 15/16/17 required; the Pasal 5(5)d disclaimer sentence enforced; Pasal 9 reference required. |
| EA distributed **only** on MQL5 Market / offshore retail | The Bappebti-scope items become `NOT_APPLICABLE`; general documentation-quality checks still apply (installation, inputs, no profit guarantees, test conditions). Exact suppression set is `PRD-OQ-011`. |
| Manual still in early drafting | Checks run continuously and report `MISSING`/`WARNING`; nothing is blocked until submission. |

The organisation records whether an EA is "in Indonesian PBK scope" on the EA Product / EA Version; the checklist template reads that flag to decide which items apply (`NOT_APPLICABLE` vs evaluated).

---

## 2. Required manual information (Perba 12/2022, mapped)

### 2.1 The four mandatory manual elements — Pasal 4(3) huruf n and Pasal 5(4) huruf b

| Element | What must be written | Manual chapter(s) | Check id |
|---|---|---|---|
| **Cara kerja** (how it works) | Monitoring, signal, entry/exit, risk management, automation limits | 6 (and 1, 8) | `CHK-CARA-KERJA` |
| **Cara instalasi** (installation) | File, Data Folder, Refresh Navigator, dependencies | 4 (and 2, 3) | `CHK-INSTALASI` |
| **Cara setting** (settings) | All inputs, presets, units, when they may be changed | 7 (and 9) | `CHK-SETTING` |
| **Kontak bantuan** (support contact) | 24/7 channel; what is technical vs transactional | 16 | `CHK-KONTAK` |

These four may not be replaced by marketing slogans.

### 2.2 Documents that must accompany the manual — Pasal 5(4)

| Item | For the docs author | Chapter / artefact | Check id |
|---|---|---|---|
| **Developer legality** (a–, Pasal 6) | If the EA is not self-built: developer identity + the cooperation arrangement | 0, 17 | `CHK-DEV-LEGAL` |
| **Algorithm transparency** (c) | Strategy and trading system described, no results promised | 17 (consistent with 6) | `CHK-TRANSPARANSI` |
| **Program command language** (d) | The algorithm/instructions are in Bahasa Indonesia or English | 17 | `CHK-BAHASA-ALGO` |
| **5-year transaction record** (e) | Historical performance kept; in the manual: honest backtest **with test conditions** | 11 | `CHK-PERFORMANCE-KONDISI` |
| **24/7 assistance** (f) | The support contact in the manual actually operates | 16 | `CHK-KONTAK` |

### 2.3 Features that must be explainable — Pasal 4(3)

Every feature claimed to have passed Bursa verification must have usage instructions in the manual: open/close positions and change SL/TP; technical analysis by indicator parameters; statistical/algorithmic calculation; notifications per settings; 24-hour operation running only scripted instructions; no potential to disrupt the trading system; backtestable with net profit / growth profit / drawdown; multi-pair and multi-strategy; code usable and upgradeable; the application file, source code and/or master code included in the request dossier.

Check `CHK-FITUR-DIJELASKAN`: if the EA Version declares a feature, the manual must document how to use it; and the manual must not document a feature the verified build does not have.

### 2.4 Pre-use explanation material — Pasal 5(6)

The manual is the raw material a Wakil Penasihat uses to explain, before the client uses the EA:

1. client risk profile / appetite / objective analysis;
2. characteristics, price, and risks of the contract;
3. how to use the EA;
4. algorithm, strategy, and trading system;
5. the **effective period** of EA usage;
6. after-sales service for technical problems.

Points 3–6 must be answerable from the manual (Chapters 4/5/6/7 for point 3, Chapter 17 + 6 for point 4, Chapter 17 for point 5, Chapters 16/17 for point 6). Check `CHK-PRA-PAKAI`.

### 2.5 Onboarding facts to mention — Pasal 5(7)

So the user is not surprised: minimum margin capability **at least Rp50,000,000**; understanding of PBK and EA risk; command of how the EA works; awareness that the EA does not guarantee profit. The manual (Chapter 2 or 15/17) should state these onboarding expectations where the EA is in Bappebti scope. Check `CHK-ONBOARDING-MARGIN`.

### 2.6 Disclosure statement + recorded video — Pasal 9

The Pialang Berjangka issues the disclosure statement (form in the Perba's annex); the client reads it aloud on video and sends it to the pialang. The manual **references** this process (Chapter 15) with wording such as: "Sebelum EA dijalankan di akun pialang berjangka Indonesia, nasabah menyelesaikan disclosure statement dan rekaman video sesuai Perba 12/2022." The tool does not produce the form. Check `CHK-DISCLOSURE-REF`.

### 2.7 Version changes and liability — Pasal 8, Pasal 7(3)

Feature/system changes must be communicated to and approved by the client, then reported to Kepala Bappebti. Every feature change = manual update + changelog entry + client education if behaviour changed. If Bappebti finds a process violation, a mismatch against Pasal 4(3) features, or neglect of Pasal 5(1), the "adviser not liable" clause stops applying. Implication for the tool: a stale or wrong manual is a product-liability surface, not just an editorial issue. Check `CHK-CHANGELOG-VERSI`.

---

## 3. Risk disclosure requirements

| Requirement | Detail | Chapter | Check id |
|---|---|---|---|
| Mandatory disclaimer sentence | Pasal 5(5)d: the EA is an automated system, only a tool/aid, **does not guarantee profit**, and **does not remove PBK risk**. Placed in the Disclaimer body, not a footnote. | 15 | `CHK-DISCLAIMER-5-5-D` |
| General trading-risk statement | Forex/CFD is risky; capital can decrease or be lost. | 15 | `CHK-RISK-GENERAL` |
| Past ≠ future | Tester/past results do not guarantee future results. | 11, 15 | `CHK-PAST-NOT-FUTURE` |
| User responsibility | The user chooses the broker, lot size, and the decision to trade live. | 15 | `CHK-USER-RESP` |
| Uncontrollable factors | The developer cannot control slippage, delay, stop-out, or broker policy. | 15 | `CHK-UNCONTROLLABLE` |
| Danger-mode warning | Martingale / unbounded grid / recovery: a prominent warning at the top of the risk chapter. | 8 | `CHK-DANGER-MODE-WARN` |

---

## 4. Prohibition on profit guarantees and risky marketing claims

The claim scanner (`AIProvider.detectClaims`, Phase 4) and the compliance reviewer both check the whole manual — headings, captions, FAQ, callouts — against Pasal 5(3) and contributor guide §2.4.

| Category | Flagged phrasing (examples, ID/EN) | Result state | Check id |
|---|---|---|---|
| Profit guarantee | "profit pasti", "pasti untung", "guaranteed profit", "profit setiap hari" | `MISSING` if in a required chapter's core claim; else `WARNING` until removed | `CLAIM-PROFIT-GUARANTEE` |
| Consistency claim | "konsisten profit", "selalu profit", "no-loss" | `WARNING` → must be removed before publish | `CLAIM-CONSISTENCY` |
| Risk-free claim | "bebas risiko", "tanpa risiko", "risk-free", "aman 100%" | `WARNING` → block publish | `CLAIM-RISK-FREE` |
| Unconditioned performance | win-rate / return figures with no broker/spread/model/date context | `WARNING`/`MISSING` in Chapter 11 | `CLAIM-UNCONDITIONED-PERF` |
| Profit sharing | "bagi hasil", "profit sharing" from EA use | `WARNING` → block publish | `CLAIM-PROFIT-SHARING` |
| Trades on client's behalf | "EA berttransaksi atas nama Anda/klien" | `WARNING` → block publish | `CLAIM-ON-BEHALF` |
| MLM / referral distribution | "member get member", "jaringan", "downline" for spreading the EA | `WARNING` → block publish | `CLAIM-MLM` |
| Margin to developer | "transfer margin ke rekening kami/developer" | `WARNING` → block publish | `CLAIM-DEV-MARGIN` |
| Regulator endorsement | "disetujui Bappebti", "Bappebti approved", "resmi terdaftar sebagai EA lolos" (without a verified record — none exists in this tool) | `WARNING` → block publish | `CLAIM-REGULATOR-ENDORSE` |
| Broker partnership | "official partner broker X", broker logos, without proof | `WARNING` | `CLAIM-BROKER-PARTNER` |

Behaviour: scanner findings are **advisory**. They never auto-edit. They appear in the builder inspector for the developer and in `/reviews/compliance` for the reviewer. Publish is gated on **zero unresolved `MISSING`** required items and (Phase 6) compliance approval; an unresolved publish-blocking `WARNING` in the list above prevents the compliance reviewer from approving.

---

## 5. Disclaimer expectations (summary)

- The Pasal 5(5)d sentence is present, in the Disclaimer chapter body, in plain language, not softened.
- The disclaimer does not use "aman", "low risk", "modal terlindungi".
- The disclaimer references the Pasal 9 disclosure-statement + video process for Bappebti-scope EAs.
- The disclaimer does not disclaim the adviser's statutory obligations (it cannot contract out of Pasal 7(3)).

---

## 6. Developer and support identification

| Requirement | Check id |
|---|---|
| Organisation identified on the cover (PT Smartin Advisor Sistem, or the third-party developer + cooperation note if not self-built). | `CHK-DEV-LEGAL` |
| Real support channels (email, phone, WhatsApp) in Chapter 16, matching the EA Version support record. | `CHK-KONTAK` |
| The 24/7 assistance statement where the EA is in Bappebti scope. | `CHK-KONTAK` |
| The technical-vs-transaction responsibility split stated (technical → Smartin; transaction/financial → pialang). | `CHK-KONTAK-SPLIT` |
| No instruction to send margin/payment to a developer contact. | `CLAIM-DEV-MARGIN` |

---

## 7. Version consistency

| Requirement | Check id |
|---|---|
| EA version and Manual version are both present and shown as distinct values (cover, metadata, running header). | `CHK-VERSI-DUA` |
| The Manual Version references exactly one EA Version; the manual describes that version's behaviour only. | `CHK-VERSI-MATCH` |
| The changelog has an entry for the current EA version; breaking entries state open-position impact. | `CHK-CHANGELOG-VERSI` |
| Screenshots are from the same EA/terminal version being released (guidance; not machine-verified). | `CHK-SCREENSHOT-VERSI` (WARNING-only) |
| The manual template version and checklist template version used are recorded on the manual version. | `CHK-TEMPLATE-VERSI` |

---

## 8. Strategy transparency requirements

| Requirement | Check id |
|---|---|
| Plain-language algorithm/strategy description present (Chapter 17), consistent with Chapter 6. | `CHK-TRANSPARANSI` |
| Statement that the algorithm/instructions are in Bahasa Indonesia or English (Pasal 5(4)d). | `CHK-BAHASA-ALGO` |
| The effective period of EA usage stated (Pasal 5(6) point 5). | `CHK-PERIODE-EFEKTIF` |
| After-sales/technical support referenced (Pasal 5(6) point 6). | `CHK-PURNA-JUAL` |
| No source-code dump; no "holy grail / undisclosed" language that discloses nothing. | `CHK-NO-SOURCE-DUMP` (WARNING) |

---

## 9. Evidence and documentation expectations

Every `checklist_result` carries **evidence**: a reference to the chapter, block, field, or parameter that satisfies (or fails) the item, so a reviewer can jump to it.

| Item type | Expected evidence |
|---|---|
| Chapter-presence item (e.g. `CHK-INSTALASI`) | The `manual_section` key + at least one qualifying block (e.g. a `steps` block with ≥ 5 steps). |
| Field-presence item (e.g. `CHK-DISCLAIMER-5-5-D`) | The `text` block id + the matched sentence span. |
| Parameter-completeness item | The set of `ea_parameters` vs the EA Version's declared inputs; the diff is the evidence. |
| Claim item | The block id + the flagged phrase span + the `ClaimFinding`. |
| Reference item (e.g. `CHK-DISCLOSURE-REF`, `CHK-ONBOARDING-MARGIN`) | The `text` block id containing the required reference wording. |
| Performance item | The Chapter 11 table rows + whether each metric has its condition columns filled. |

Evidence is stored with the result and shown in the inspector (developer) and the compliance queue (reviewer). Evidence never includes credentials, signed URLs, or source code.

---

## 10. Checklist states

Exactly four states. No others.

| State | Meaning | Blocks submission? | Blocks compliance approval / publish? |
|---|---|---|---|
| **PASS** | The item's rule is satisfied; evidence recorded. | No | No |
| **WARNING** | The item is partly satisfied or a soft rule is triggered (e.g. a claim phrase, a performance figure missing one condition, a screenshot-version note). Needs attention; a human may accept or require a fix. | No | A publish-blocking `WARNING` (the claim categories in §4) blocks compliance approval until resolved; other `WARNING`s are advisory. |
| **MISSING** | A required item's rule is not satisfied (e.g. no installation steps, no disclaimer sentence, an EA input absent from the parameter tables). | **Yes**, if the item is required and the chapter is required/in-scope. | Yes. |
| **NOT_APPLICABLE** | The item does not apply to this EA (e.g. GUI chapter for a headless EA; Bappebti items for an offshore-only EA). Set by the checklist template's scope rule, or by a reviewer with a recorded reason. | No | No |

Transitions:

- Automated re-evaluation runs after relevant content changes; `MISSING`↔`PASS`↔`WARNING` flip automatically.
- `NOT_APPLICABLE` is set by a scope rule or by an explicit reviewer action (audited); it is not chosen by the developer to bypass a check.
- Completion score = required, in-scope items in `PASS` ÷ required, in-scope items (WARNING counts as not-yet-PASS for the score; `NOT_APPLICABLE` is excluded from both numerator and denominator).

---

## 11. Automated checks vs human / regulatory approval — the separation, restated

```mermaid
flowchart LR
    subgraph Automated["Automated documentation checks (rules, no person)"]
      A1[Chapter presence] --> S[checklist_results\nPASS / WARNING / MISSING / NOT_APPLICABLE]
      A2[Field / sentence presence] --> S
      A3[Parameter completeness] --> S
      A4[Version consistency] --> S
      A5[Claim scan findings] --> S
      S --> SC[Completion score\n\"Documentation checklist completed\"]
    end

    subgraph Human["Human review (named actor + timestamp, audited)"]
      T[Technical reviewer decision\napprove / request changes]
      C[Compliance reviewer decision\napprove / request changes]
    end

    subgraph Regulatory["Regulatory / external (NOT in this tool)"]
      B1[Bursa recommendation + feature verification]
      B2[Kepala Bappebti approval]
      B3[Pasal 9 disclosure statement + recorded video]
      B4[Client onboarding / KYC]
    end

    SC -. informs .-> T
    T --> C
    C -. informs, does not equal .-> B2
    Regulatory -. referenced as checklist items / reminders .-> Automated
```

- The automated layer outputs a **readiness signal**, never an approval.
- The human layer outputs a **workflow decision** by a Smartin reviewer, never a regulator's decision.
- The regulatory layer is **not implemented here**; the tool only points to it and records related obligations (changelog, disclosure reference, developer legality).
- Nowhere in data, UI copy, PDF output, or public web output does a computed value or a Smartin reviewer decision get rendered as "Bappebti Approved" or equivalent (`PRD-COMP-001`, `docs/ACCEPTANCE_CRITERIA.md`).

---

## 12. Proposed checklist items (v1 draft — finalised in Phase 5, `PRD-OQ-004`)

Categories: **Identity & Version**, **Installation & Package**, **How it works & Settings**, **Risk & Claims**, **Support & Transparency**, **Performance evidence**, **Bappebti-scope references**. Target count aligns with the contributor guide's ~26-item pre-publication checklist (the Phase 1 mock uses "/ 26").

| # | Check id | Category | Required | Applies when |
|---|---|---|---|---|
| 1 | `CHK-VERSI-DUA` | Identity & Version | Yes | always |
| 2 | `CHK-VERSI-MATCH` | Identity & Version | Yes | always |
| 3 | `CHK-DEV-LEGAL` | Identity & Version | Yes | always (NA text if self-built and org = Smartin) |
| 4 | `CHK-INSTALASI` | Installation & Package | Yes | always |
| 5 | `CHK-INSTALL-AUTOTRADING` | Installation & Package | Yes | always |
| 6 | `CHK-DEPENDENCIES-LISTED` | Installation & Package | Yes | EA Version declares dependencies |
| 7 | `CHK-PACKAGE-FILES` | Installation & Package | No | extra files ship |
| 8 | `CHK-CARA-KERJA` | How it works & Settings | Yes | always |
| 9 | `CHK-SPECIAL-CONDITIONS` | How it works & Settings | Yes | always |
| 10 | `CHK-SETTING` | How it works & Settings | Yes | always |
| 11 | `CHK-PARAM-COMPLETE` | How it works & Settings | Yes | EA Version has an input list |
| 12 | `CHK-PARAM-DEFAULT-MATCH` | How it works & Settings | Yes | as above |
| 13 | `CHK-UNITS-DEFINED` | How it works & Settings | Yes | any points/pips value used |
| 14 | `CHK-QUICKSTART-DEMO` | How it works & Settings | Yes | always |
| 15 | `CHK-SAFE-STOP` | How it works & Settings | Yes | always |
| 16 | `CHK-DISCLAIMER-5-5-D` | Risk & Claims | Yes (Bappebti) / Recommended | in scope |
| 17 | `CHK-RISK-GENERAL` | Risk & Claims | Yes | always |
| 18 | `CHK-PAST-NOT-FUTURE` | Risk & Claims | Yes | always |
| 19 | `CHK-DANGER-MODE-WARN` | Risk & Claims | Yes | EA Version declares a danger mode |
| 20 | `CHK-NO-PROHIBITED-CLAIMS` | Risk & Claims | Yes | always (aggregates §4 scanner findings) |
| 21 | `CHK-KONTAK` | Support & Transparency | Yes (Bappebti) / Recommended | in scope |
| 22 | `CHK-KONTAK-SPLIT` | Support & Transparency | Yes | always |
| 23 | `CHK-TRANSPARANSI` | Support & Transparency | Yes (Bappebti) | in scope |
| 24 | `CHK-BAHASA-ALGO` | Support & Transparency | Yes (Bappebti) | in scope |
| 25 | `CHK-PERIODE-EFEKTIF` | Support & Transparency | Yes (Bappebti) | in scope |
| 26 | `CHK-PERFORMANCE-KONDISI` | Performance evidence | Yes | any performance data shown |
| 27 | `CHK-CHANGELOG-VERSI` | Identity & Version | Yes | always |
| 28 | `CHK-DISCLOSURE-REF` | Bappebti-scope references | Yes (Bappebti) | in scope |
| 29 | `CHK-ONBOARDING-MARGIN` | Bappebti-scope references | Yes (Bappebti) | in scope |
| 30 | `CHK-FITUR-DIJELASKAN` | How it works & Settings | Yes | EA Version declares verified features |
| 31 | `CHK-INTERFACE` | How it works & Settings | Conditional | EA Version declares a GUI (else NOT_APPLICABLE) |

> The final v1 set (exact membership, the 26 vs ~31 count, and the required/conditional split) is a Phase 5 deliverable agreed with the product owner. Items 27–31 are shown so the mapping is complete; some may merge (e.g. `CHK-VERSI-MATCH` + `CHK-CHANGELOG-VERSI`) to land on the intended count.

---

## 13. Tool obligations (what the software must do, not just check)

| Obligation | Phase | Note |
|---|---|---|
| Enforce "ready for review" wording everywhere; forbid "Approved"/"Bappebti Approved" in UI, PDF, and public output. | 1 (copy) / 5 (engine) / 7 (output) | Acceptance criteria per phase. |
| Keep the checklist panel and the review decision visually + structurally separate. | 5 / 6 | Never one merged "approved" badge. |
| Record every review decision in `reviews` + `audit_events` with actor + timestamp. | 6 | Append-only audit. |
| Block publish while any required, in-scope item is `MISSING` or a publish-blocking claim `WARNING` is unresolved. | 5 / 6 | Server-side precondition on the publish command. |
| Prevent self-approval (actor ≠ author/editor of the manual version). | 6 | Typed error, not a silent skip. |
| Store evidence with each result; never store credentials/signed URLs/source in evidence or logs. | 5 | Also `PRD-SEC-009`. |
| Flag the Pasal 8 obligation (client approval + report to Kepala Bappebti) on feature-change changelog entries. | 6 | The tool records; it does not file (`PRD-OQ-010`). |
| Version the checklist template; record which version evaluated each manual version. | 5 | `CHK-TEMPLATE-VERSI`. |
| Apply scope rules so offshore-only EAs get `NOT_APPLICABLE` on Bappebti items rather than false `MISSING`. | 5 | `PRD-OQ-011` for the exact set. |

---

## 14. Out of scope for this tool

- Producing or submitting the Pasal 9 disclosure statement form or the client's recorded video.
- Interacting with Bursa Berjangka or Bappebti systems; obtaining Kepala Bappebti approval.
- KYC, risk-profiling, or the advisory agreement itself.
- Storing client margin or any funds.
- Legal advice. The compliance layer is documentation assistance; the official Perba text and qualified counsel govern.
