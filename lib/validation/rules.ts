/**
 * Phase 5 — the ONE place checklist rule logic lives (PRD-VAL-003, AC-P5-4/5).
 *
 * Checklist template v1 carries all 31 items from COMPLIANCE_REQUIREMENTS.md §12 (PRD-OQ-004).
 * Every rule is a deterministic pure function over the assembled `ManualViewModel`. NO LLM,
 * no network, no DB. `CHK-NO-PROHIBITED-CLAIMS` reuses the Phase 4 deterministic claim scanner
 * verbatim — there is no second scanner. Rules share the small primitives below rather than
 * duplicating 31 implementations, but no rule returns a blanket PASS: each asserts real evidence.
 *
 * OQ-005 chapter-requirement semantics are encoded in `chapterRequired`. `bappebti_only` items
 * become NOT_APPLICABLE for `pbkScope = OUT_OF_SCOPE` in `evaluate.ts` (item flag), not here.
 */

import type { ManualViewModel } from "@/lib/manual/view-model";
import { richTextToPlainText } from "@/lib/domain/rich-text";
import { faqItems } from "@/lib/domain/blocks";
import { eaDeclaresDangerMode } from "@/lib/domain/section-completion";
import { projectManualLines } from "@/lib/ai/manual-projection";
import { scanClaims } from "@/lib/ai/claim-scanner";
import type { ChecklistItemDef, PbkScope, RuleOutcome } from "./types";

type Section = ManualViewModel["sections"][number];
type Block = Section["blocks"][number];

// ---------------------------------------------------------------------------
// v1 item metadata — mirrors the migration seed (fallback / test fixture).
// The DB rows are authoritative; this is used when they are not loaded.
// rule_key === check_key for every v1 item.
// ---------------------------------------------------------------------------
type Row = Omit<ChecklistItemDef, "ruleKey" | "description"> & { description?: string };
const item = (r: Row): ChecklistItemDef => ({ description: "", ruleKey: r.checkKey, ...r });

export const CHECKLIST_V1: ChecklistItemDef[] = [
  item({ checkKey: "CHK-VERSI-DUA", label: "Versi EA & versi manual ditampilkan terpisah", category: "identity", required: true, bappebtiOnly: false, publishBlocking: true, position: 0 }),
  item({ checkKey: "CHK-VERSI-MATCH", label: "Versi EA & versi manual konsisten", category: "identity", required: true, bappebtiOnly: false, publishBlocking: true, position: 1 }),
  item({ checkKey: "CHK-DEV-LEGAL", label: "Identitas pengembang & organisasi", category: "identity", required: true, bappebtiOnly: false, publishBlocking: true, position: 2 }),
  item({ checkKey: "CHK-INSTALASI", label: "Langkah instalasi lengkap", category: "installation", required: true, bappebtiOnly: false, publishBlocking: true, position: 3 }),
  item({ checkKey: "CHK-INSTALL-AUTOTRADING", label: "Instruksi Algo Trading / Allow Algo Trading", category: "installation", required: true, bappebtiOnly: false, publishBlocking: false, position: 4 }),
  item({ checkKey: "CHK-DEPENDENCIES-LISTED", label: "Ketergantungan file didaftarkan", category: "installation", required: true, bappebtiOnly: false, publishBlocking: false, position: 5 }),
  item({ checkKey: "CHK-PACKAGE-FILES", label: "Isi paket dijelaskan", category: "installation", required: false, bappebtiOnly: false, publishBlocking: false, position: 6 }),
  item({ checkKey: "CHK-CARA-KERJA", label: "Cara kerja EA dijelaskan", category: "how-it-works", required: true, bappebtiOnly: false, publishBlocking: true, position: 7 }),
  item({ checkKey: "CHK-SPECIAL-CONDITIONS", label: "Perilaku kondisi khusus", category: "how-it-works", required: true, bappebtiOnly: false, publishBlocking: false, position: 8 }),
  item({ checkKey: "CHK-SETTING", label: "Cara setting terdokumentasi", category: "how-it-works", required: true, bappebtiOnly: false, publishBlocking: true, position: 9 }),
  item({ checkKey: "CHK-PARAM-COMPLETE", label: "Semua input EA terdokumentasi", category: "how-it-works", required: true, bappebtiOnly: false, publishBlocking: true, position: 10 }),
  item({ checkKey: "CHK-PARAM-DEFAULT-MATCH", label: "Nilai default sesuai definisi EA", category: "how-it-works", required: true, bappebtiOnly: false, publishBlocking: false, position: 11 }),
  item({ checkKey: "CHK-UNITS-DEFINED", label: "Satuan poin/pip didefinisikan", category: "how-it-works", required: true, bappebtiOnly: false, publishBlocking: false, position: 12 }),
  item({ checkKey: "CHK-QUICKSTART-DEMO", label: "Panduan mulai cepat berbasis demo", category: "how-it-works", required: true, bappebtiOnly: false, publishBlocking: false, position: 13 }),
  item({ checkKey: "CHK-SAFE-STOP", label: "Cara menghentikan EA dengan aman", category: "how-it-works", required: true, bappebtiOnly: false, publishBlocking: false, position: 14 }),
  item({ checkKey: "CHK-DISCLAIMER-5-5-D", label: "Kalimat disclaimer Pasal 5(5)d", category: "risk", required: true, bappebtiOnly: true, publishBlocking: true, position: 15 }),
  item({ checkKey: "CHK-RISK-GENERAL", label: "Pernyataan risiko umum trading", category: "risk", required: true, bappebtiOnly: false, publishBlocking: true, position: 16 }),
  item({ checkKey: "CHK-PAST-NOT-FUTURE", label: "Kinerja masa lalu bukan jaminan", category: "risk", required: true, bappebtiOnly: false, publishBlocking: true, position: 17 }),
  item({ checkKey: "CHK-DANGER-MODE-WARN", label: "Peringatan mode berisiko tinggi", category: "risk", required: true, bappebtiOnly: false, publishBlocking: true, position: 18 }),
  item({ checkKey: "CHK-NO-PROHIBITED-CLAIMS", label: "Tidak ada klaim terlarang", category: "risk", required: true, bappebtiOnly: false, publishBlocking: true, position: 19 }),
  item({ checkKey: "CHK-KONTAK", label: "Kontak dukungan & pernyataan 24/7", category: "support", required: true, bappebtiOnly: true, publishBlocking: true, position: 20 }),
  item({ checkKey: "CHK-KONTAK-SPLIT", label: "Pembagian tanggung jawab teknis vs transaksi", category: "support", required: true, bappebtiOnly: false, publishBlocking: false, position: 21 }),
  item({ checkKey: "CHK-TRANSPARANSI", label: "Deskripsi algoritma / strategi", category: "support", required: true, bappebtiOnly: true, publishBlocking: false, position: 22 }),
  item({ checkKey: "CHK-BAHASA-ALGO", label: "Pernyataan bahasa algoritma", category: "support", required: true, bappebtiOnly: true, publishBlocking: false, position: 23 }),
  item({ checkKey: "CHK-PERIODE-EFEKTIF", label: "Periode efektif penggunaan EA", category: "support", required: true, bappebtiOnly: true, publishBlocking: false, position: 24 }),
  item({ checkKey: "CHK-PERFORMANCE-KONDISI", label: "Angka kinerja disertai kondisi uji", category: "performance", required: true, bappebtiOnly: false, publishBlocking: false, position: 25 }),
  item({ checkKey: "CHK-CHANGELOG-VERSI", label: "Entri changelog untuk versi EA saat ini", category: "identity", required: true, bappebtiOnly: false, publishBlocking: false, position: 26 }),
  item({ checkKey: "CHK-DISCLOSURE-REF", label: "Rujukan disclosure statement Pasal 9", category: "bappebti", required: true, bappebtiOnly: true, publishBlocking: true, position: 27 }),
  item({ checkKey: "CHK-ONBOARDING-MARGIN", label: "Ekspektasi margin onboarding", category: "bappebti", required: true, bappebtiOnly: true, publishBlocking: false, position: 28 }),
  item({ checkKey: "CHK-FITUR-DIJELASKAN", label: "Fitur terverifikasi dijelaskan", category: "how-it-works", required: true, bappebtiOnly: false, publishBlocking: false, position: 29 }),
  item({ checkKey: "CHK-INTERFACE", label: "Antarmuka EA terdokumentasi", category: "how-it-works", required: true, bappebtiOnly: false, publishBlocking: false, position: 30 }),
];


// OQ-005 — canonical chapter requirement.
const CHAPTERS_ALWAYS = [
  "cover", "overview", "requirements", "installation", "quick-start", "how-it-works",
  "parameters", "risk", "presets", "performance", "troubleshooting", "changelog",
];
const CHAPTERS_BAPPEBTI = ["disclaimer", "support", "transparency"];

// Claim categories that block publishing (COMPLIANCE_REQUIREMENTS.md §4; CLAIM-BROKER-PARTNER is
// advisory-only). Recorded now; Phase 6 enforces it.
const PUBLISH_BLOCKING_CLAIM_CATEGORIES = new Set([
  "CLAIM-PROFIT-GUARANTEE", "CLAIM-CONSISTENCY", "CLAIM-RISK-FREE", "CLAIM-UNCONDITIONED-PERF",
  "CLAIM-PROFIT-SHARING", "CLAIM-ON-BEHALF", "CLAIM-MLM", "CLAIM-DEV-MARGIN", "CLAIM-REGULATOR-ENDORSE",
]);

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function eaPbkScope(requirements: Record<string, unknown> | null | undefined): PbkScope {
  return requirements?.pbkScope === "OUT_OF_SCOPE" ? "OUT_OF_SCOPE" : "IN_SCOPE";
}

function sectionByKey(vm: ManualViewModel, key: string): Section | undefined {
  return vm.sections.find((s) => s.key === key);
}

function safePlain(v: unknown): string {
  try {
    if (v && typeof v === "object") return richTextToPlainText(v as never);
  } catch {
    /* ignore */
  }
  return "";
}

/** Plain-text projection of one section's blocks (no headings). */
function sectionText(section: Section | undefined): string {
  if (!section) return "";
  const parts: string[] = [];
  for (const b of section.blocks) {
    const p = b.payload as Record<string, unknown>;
    switch (b.type) {
      case "text":
      case "callout":
        parts.push(safePlain(p.content));
        break;
      case "faq":
        for (const it of faqItems(p)) parts.push(it.question, safePlain(it.answer));
        break;
      case "steps": {
        const steps = Array.isArray(p.steps) ? (p.steps as Record<string, unknown>[]) : [];
        for (const s of steps) parts.push([s.title, s.instruction, s.menuPath].filter((x) => typeof x === "string").join(" "));
        break;
      }
      case "image":
        parts.push(typeof p.caption === "string" ? p.caption : "");
        break;
    }
  }
  return parts.join("\n").trim();
}

/** ≥1 non-deleted block that carries real content (VM already excludes soft-deleted blocks). */
function sectionHasContent(section: Section | undefined): boolean {
  if (!section || section.blocks.length === 0) return false;
  if (section.blocks.some((b) => b.type === "parameterTable" || b.type === "image")) return true;
  return sectionText(section).length > 0;
}

function manualText(vm: ManualViewModel): string {
  return projectManualLines(vm).map((l) => l.text).join("\n");
}

function stepsBlocks(section: Section | undefined): Block[] {
  return section ? section.blocks.filter((b) => b.type === "steps") : [];
}
function stepCount(block: Block): number {
  const s = (block.payload as Record<string, unknown>).steps;
  return Array.isArray(s) ? s.length : 0;
}
function hasImageBlock(section: Section | undefined): boolean {
  return !!section && section.blocks.some((b) => b.type === "image");
}

/** how many of `res` match `text` */
function phrasesHit(text: string, res: RegExp[]): number {
  return res.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
}

function reqOf(vm: ManualViewModel): Record<string, unknown> {
  return (vm.eaVersion.requirements ?? {}) as Record<string, unknown>;
}
function eaHasDeps(vm: ManualViewModel): boolean {
  const r = reqOf(vm);
  const ci = r.customIndicators;
  return (Array.isArray(ci) && ci.length > 0) || r.dll === true || r.webRequest === true;
}
function eaCustomIndicatorNames(vm: ManualViewModel): string[] {
  const ci = reqOf(vm).customIndicators;
  return Array.isArray(ci) ? (ci as unknown[]).filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}
function eaShipsExtraFiles(vm: ManualViewModel): boolean {
  return eaHasDeps(vm) || vm.supportedSetups.some((s) => (s.presetRef ?? "").trim() !== "");
}
function eaHasGui(vm: ManualViewModel): boolean {
  return reqOf(vm).gui === true;
}
function eaVerifiedFeatures(vm: ManualViewModel): string[] {
  const vf = reqOf(vm).verifiedFeatures;
  return Array.isArray(vf) ? (vf as unknown[]).filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

/** OQ-005 canonical chapter requirement (context for evidence / reasons). */
export function chapterRequired(vm: ManualViewModel, key: string): boolean {
  const scope = eaPbkScope(vm.eaVersion.requirements);
  if (CHAPTERS_ALWAYS.includes(key)) return true;
  if (CHAPTERS_BAPPEBTI.includes(key)) return scope === "IN_SCOPE";
  if (key === "package") return eaShipsExtraFiles(vm);
  if (key === "interface") return eaHasGui(vm);
  return false;
}

/** Generic "this chapter must carry a plain-language statement covering these concepts". */
function conceptOutcome(
  vm: ManualViewModel,
  sectionKeys: string | string[],
  concepts: RegExp[],
  opts: { min?: number; navigate?: string; passReason: string; missingReason: (missing: number) => string; emptyReason: string },
): RuleOutcome {
  const keys = Array.isArray(sectionKeys) ? sectionKeys : [sectionKeys];
  const nav = opts.navigate ?? keys[0];
  const sections = keys.map((k) => sectionByKey(vm, k));
  const text = sections.map((s) => sectionText(s)).join("\n").toLowerCase();
  const anyContent = sections.some((s) => sectionHasContent(s));
  const hit = phrasesHit(text, concepts);
  const min = opts.min ?? concepts.length;
  if (!anyContent) {
    return { state: "MISSING", reason: opts.emptyReason, evidence: { sectionKeys: keys, hasContent: false }, navigateSectionKey: nav };
  }
  if (hit >= min) {
    return { state: "PASS", reason: opts.passReason, evidence: { sectionKeys: keys, conceptsMatched: hit, conceptsExpected: min }, navigateSectionKey: nav };
  }
  return {
    state: "MISSING",
    reason: opts.missingReason(min - hit),
    evidence: { sectionKeys: keys, conceptsMatched: hit, conceptsExpected: min },
    navigateSectionKey: nav,
  };
}

// ---------------------------------------------------------------------------
// Applicability (encodes the "Applies when" column deterministically)
// ---------------------------------------------------------------------------
export function ruleApplies(checkKey: string, vm: ManualViewModel): boolean {
  switch (checkKey) {
    case "CHK-PARAM-COMPLETE":
    case "CHK-PARAM-DEFAULT-MATCH":
      return vm.parameterGroups.some((g) => g.parameters.length > 0);
    case "CHK-UNITS-DEFINED":
      return /\b(point|points|poin|pip|pips)\b/i.test(manualText(vm));
    case "CHK-PERFORMANCE-KONDISI":
      return hasPerformanceFigure(vm);
    case "CHK-DANGER-MODE-WARN":
      return eaDeclaresDangerMode(vm.eaVersion.requirements);
    case "CHK-DEPENDENCIES-LISTED":
      return eaHasDeps(vm);
    case "CHK-PACKAGE-FILES":
      return eaShipsExtraFiles(vm);
    case "CHK-FITUR-DIJELASKAN":
      return eaVerifiedFeatures(vm).length > 0;
    case "CHK-INTERFACE":
      return eaHasGui(vm);
    default:
      return true;
  }
}

export function notApplicableReason(checkKey: string): string {
  switch (checkKey) {
    case "CHK-PARAM-COMPLETE":
    case "CHK-PARAM-DEFAULT-MATCH":
      return "Tidak berlaku: EA Version belum memiliki daftar input.";
    case "CHK-UNITS-DEFINED":
      return "Tidak berlaku: manual tidak memakai istilah poin/pip.";
    case "CHK-PERFORMANCE-KONDISI":
      return "Tidak berlaku: tidak ada angka kinerja pada bab Informasi Backtest.";
    case "CHK-DANGER-MODE-WARN":
      return "Tidak berlaku: EA Version tidak menyatakan mode berisiko tinggi.";
    case "CHK-DEPENDENCIES-LISTED":
      return "Tidak berlaku: EA Version tidak menyatakan ketergantungan file.";
    case "CHK-PACKAGE-FILES":
      return "Tidak berlaku: tidak ada file tambahan yang dikirim.";
    case "CHK-FITUR-DIJELASKAN":
      return "Tidak berlaku: EA Version tidak menyatakan daftar fitur terverifikasi.";
    case "CHK-INTERFACE":
      return "Tidak berlaku: EA Version tidak menyatakan adanya GUI/panel.";
    default:
      return "Tidak berlaku.";
  }
}

const PERF_FIGURE_RE =
  /\b(win\s*rate|winrate|drawdown|max\s*dd|return|net\s*profit|growth|profit\s*factor|rata-?rata\s*profit)\b[^.\n]{0,40}?(\d{1,3}(?:[.,]\d+)?\s*%|[$]\s?\d|rp\s?\d|usd\s?\d)|(\d{1,3}(?:[.,]\d+)?\s*%)[^.\n]{0,20}?\b(win\s*rate|winrate|drawdown|return|profit)\b/i;
function hasPerformanceFigure(vm: ManualViewModel): boolean {
  return PERF_FIGURE_RE.test(sectionText(sectionByKey(vm, "performance")));
}

// ---------------------------------------------------------------------------
// Rules — identity & version
// ---------------------------------------------------------------------------

function checkVersiDua(vm: ManualViewModel): RuleOutcome {
  // Requirement (docs/CONTENT_REQUIREMENTS §0): EA Version and Manual Version are two DISTINCT
  // metadata concepts, each carried in its own labelled field. This check verifies exactly that:
  //   - the EA Version field exists
  //   - the Manual Version field exists
  //   - both are valid semver MAJOR.MINOR.PATCH
  // Their VALUES MAY BE IDENTICAL (EA 1.0.0 + Manual 1.0.0 => PASS). This check does NOT require
  // any additional Cover-body prose such as "Dokumentasi ini berlaku untuk versi X.Y.Z." — that is
  // a separate authoring nudge surfaced as chapter guidance, not a gate on this rule.
  const ea = (vm.eaVersion.version ?? "").trim();
  const man = (vm.manualVersion.version ?? "").trim();
  const semverRe = /^\d+\.\d+\.\d+$/;

  if (!ea || !man) {
    return {
      state: "MISSING",
      reason: "Versi EA dan/atau versi Manual tidak tersedia pada data versi.",
      evidence: { eaVersion: ea, manualVersion: man },
      navigateSectionKey: "cover",
    };
  }
  if (!semverRe.test(ea) || !semverRe.test(man)) {
    return {
      state: "WARNING",
      reason: "Versi EA / versi Manual belum berupa semver MAJOR.MINOR.PATCH yang valid.",
      evidence: { eaVersion: ea, manualVersion: man },
      navigateSectionKey: "cover",
    };
  }
  return {
    state: "PASS",
    reason: `Versi EA (${ea}) dan versi Manual (${man}) tersedia sebagai dua field metadata terpisah${
      ea === man ? " (nilai boleh sama)" : ""
    }.`,
    evidence: { eaVersion: ea, manualVersion: man, equal: ea === man },
    navigateSectionKey: "cover",
  };
}

const EA_VERSION_MENTION_RE =
  /\b(?:ea|expert advisor|robot)\b[^.\n]{0,40}?\bversi(?:on)?\b[^.\n]{0,16}?\b(\d+\.\d+\.\d+)\b|\bversi(?:on)?\b[^.\n]{0,16}?\b(?:ea|expert advisor|robot)\b[^.\n]{0,16}?\b(\d+\.\d+\.\d+)\b|\bea\s*v(\d+\.\d+\.\d+)\b/gi;

function checkVersiMatch(vm: ManualViewModel): RuleOutcome {
  const eaVer = (vm.eaVersion.version ?? "").trim();
  if (!vm.eaVersion.id || !eaVer) {
    return { state: "MISSING", reason: "EA Version tidak tertaut ke Manual Version ini.", evidence: {}, navigateSectionKey: "cover" };
  }
  const text = manualText(vm);
  const found = new Set<string>();
  for (const m of text.matchAll(EA_VERSION_MENTION_RE)) {
    const v = m[1] || m[2] || m[3];
    if (v && v !== eaVer && v !== vm.manualVersion.version) found.add(v);
  }
  const conflicts = [...found];
  return {
    state: conflicts.length ? "MISSING" : "PASS",
    reason: conflicts.length
      ? `Teks menyebut versi EA lain (${conflicts.join(", ")}) yang berbeda dari EA Version tertaut (${eaVer}).`
      : `Versi EA tertaut (${eaVer}) konsisten; tidak ada penyebutan versi EA yang bertentangan.`,
    evidence: { eaVersion: eaVer, manualVersion: vm.manualVersion.version, conflictingVersions: conflicts },
  };
}

function checkDevLegal(vm: ManualViewModel): RuleOutcome {
  const org = (vm.organization.name ?? "").trim();
  const dev = (vm.developer?.name ?? "").trim();
  const cover = sectionByKey(vm, "cover");
  const transparency = sectionByKey(vm, "transparency");
  const txt = `${sectionText(cover)}\n${sectionText(transparency)}`.toLowerCase();
  if (!org) {
    return { state: "MISSING", reason: "Nama organisasi tidak tersedia untuk ditampilkan pada Sampul.", evidence: {}, navigateSectionKey: "cover" };
  }
  const selfBuilt = !dev || dev.toLowerCase() === org.toLowerCase() || /smartin/i.test(org);
  const orgToken = org.toLowerCase().split(/\s+/).find((w) => w.length > 2) ?? org.toLowerCase();
  if (selfBuilt) {
    const ok = sectionHasContent(cover) && txt.includes(orgToken);
    return {
      state: ok ? "PASS" : "WARNING",
      reason: ok
        ? `Organisasi (${org}) tercantum; EA dibuat sendiri sehingga catatan kerja sama pihak ketiga tidak diperlukan.`
        : "Bab Sampul belum mencantumkan nama organisasi secara eksplisit.",
      evidence: { organization: org, selfBuilt: true },
      navigateSectionKey: "cover",
    };
  }
  const mentionsDev = txt.includes(dev.toLowerCase());
  const mentionsCoop = /kerja ?sama|kerjasama|pihak ketiga|cooperation|lisensi pengembang|perjanjian/.test(txt);
  const ok = mentionsDev && mentionsCoop;
  return {
    state: ok ? "PASS" : "MISSING",
    reason: ok
      ? `Identitas pengembang pihak ketiga (${dev}) dan catatan kerja sama tercantum.`
      : "EA bukan buatan sendiri: cantumkan identitas pengembang pihak ketiga dan catatan kerja sama (Pasal 5(4)a, Pasal 6).",
    evidence: { organization: org, developer: dev, mentionsDeveloper: mentionsDev, mentionsCooperation: mentionsCoop },
    navigateSectionKey: "transparency",
  };
}

function checkChangelogVersi(vm: ManualViewModel): RuleOutcome {
  const eaVer = (vm.eaVersion.version ?? "").trim();

  // Slice 4: structured changelog_entries are the primary source. Any structured entry satisfies
  // the "changelog for this version" check; note whether one references the linked EA version.
  const entries = vm.changelog ?? [];
  if (entries.length > 0) {
    const linked = entries.filter((e) => e.sourceEaVersionId === vm.eaVersion.id).length;
    return {
      state: "PASS",
      reason:
        linked > 0
          ? `Catatan Perubahan memuat ${entries.length} entri terstruktur (${linked} untuk versi EA ${eaVer || "?"}).`
          : `Catatan Perubahan memuat ${entries.length} entri terstruktur.`,
      evidence: { structuredEntries: entries.length, linkedToEaVersion: linked, eaVersion: eaVer },
      navigateSectionKey: "changelog",
    };
  }

  // Fallback: the legacy free-text heuristic on the chapter's blocks.
  const section = sectionByKey(vm, "changelog");
  const txt = sectionText(section);
  if (!sectionHasContent(section)) {
    return { state: "MISSING", reason: "Bab Catatan Perubahan belum memiliki isi.", evidence: { sectionId: section?.id ?? null }, navigateSectionKey: "changelog" };
  }
  const hasEntry = (eaVer && txt.includes(eaVer)) || /\[\s*\d+\.\d+\.\d+\s*\]/.test(txt) || /\bv?\d+\.\d+\.\d+\b\s*[-–—:]/.test(txt);
  return {
    state: hasEntry ? "PASS" : "MISSING",
    reason: hasEntry
      ? "Catatan Perubahan memuat entri versi (mis. [X.Y.Z] — tanggal)."
      : `Belum ada entri changelog untuk versi EA tertaut (${eaVer || "?"}).`,
    evidence: { sectionId: section?.id ?? null, eaVersion: eaVer, hasVersionEntry: hasEntry },
    navigateSectionKey: "changelog",
  };
}

// ---------------------------------------------------------------------------
// Rules — installation & package
// ---------------------------------------------------------------------------

function checkInstalasi(vm: ManualViewModel): RuleOutcome {
  const section = sectionByKey(vm, "installation");
  const steps = stepsBlocks(section);
  const best = steps.reduce((n, b) => Math.max(n, stepCount(b)), 0);
  const txt = sectionText(section).toLowerCase();
  const mentionsDataFolder = /open data folder|data folder|mql5[\/\\]experts|mql4[\/\\]experts|navigator/.test(txt);
  if (!sectionHasContent(section)) {
    return { state: "MISSING", reason: "Bab Instalasi belum memiliki isi.", evidence: { sectionId: section?.id ?? null }, navigateSectionKey: "installation" };
  }
  const ok = best >= 5 && mentionsDataFolder;
  return {
    state: ok ? "PASS" : "MISSING",
    reason: ok
      ? `Instalasi memuat blok langkah dengan ${best} langkah dan menyebut Data Folder / Navigator.`
      : `Instalasi butuh blok langkah ≥ 5 langkah berurutan dengan jalur menu (Data Folder, MQL5/Experts, Refresh). Ditemukan: ${best} langkah.`,
    evidence: { sectionId: section?.id ?? null, stepsBlockIds: steps.map((b) => b.id), maxSteps: best, mentionsDataFolder },
    navigateSectionKey: "installation",
  };
}

function checkInstallAutotrading(vm: ManualViewModel): RuleOutcome {
  // The real requirement (docs/CONTENT_REQUIREMENTS §4): the manual documents how to ENABLE
  // automated trading for the supported MetaTrader platform AND how the user can VERIFY the
  // required status. It does NOT require the legacy "smiley hijau/merah" wording specifically —
  // any concrete verification signal (status icon, "initialized" log line, active-state label,
  // panel indicator) satisfies the verify half.
  const section = sectionByKey(vm, "installation");
  const txt = sectionText(section).toLowerCase();
  const hitAlgo = /algo\s*trading|allow\s*algo|auto\s*trading|autotrading|izinkan trading otomatis|trading otomatis/.test(txt);
  const hitVerify =
    /smiley|senyum|ikon\s*(status|senyum)?.{0,14}(hijau|merah|aktif)|wajah.{0,10}(hijau|merah)/.test(txt) ||
    /log.{0,24}(initialized|inisialisasi|siap)|status.{0,20}(aktif|berjalan|running|menyala)|tombol.{0,20}(hijau|menyala|aktif)|autotrading.{0,12}(aktif|menyala|hijau)|indikator.{0,16}(status|aktif|panel)/.test(
      txt,
    );
  if (!sectionHasContent(section)) {
    return { state: "MISSING", reason: "Bab Instalasi belum memiliki isi.", evidence: {}, navigateSectionKey: "installation" };
  }
  const ok = hitAlgo && hitVerify;
  return {
    state: ok ? "PASS" : hitAlgo ? "WARNING" : "MISSING",
    reason: ok
      ? "Instalasi menjelaskan cara mengaktifkan trading otomatis dan cara memverifikasi statusnya."
      : hitAlgo
        ? "Aktivasi trading otomatis dijelaskan, tetapi cara memverifikasi status aktif belum disebut (mis. ikon status, baris log “initialized”, atau indikator panel)."
        : "Instalasi belum menjelaskan cara mengaktifkan trading otomatis (tombol Algo Trading global + Allow Algo Trading pada tab Common).",
    evidence: { sectionId: section?.id ?? null, mentionsAlgoTrading: hitAlgo, mentionsVerify: hitVerify },
    navigateSectionKey: "installation",
  };
}

function checkDependenciesListed(vm: ManualViewModel): RuleOutcome {
  const names = eaCustomIndicatorNames(vm);
  const r = reqOf(vm);
  const install = sectionByKey(vm, "installation");
  const pkg = sectionByKey(vm, "package");
  const reqs = sectionByKey(vm, "requirements");
  const txt = `${sectionText(install)}\n${sectionText(pkg)}\n${sectionText(reqs)}`.toLowerCase();
  const missingNames = names.filter((n) => !txt.includes(n.toLowerCase()));
  const needsDll = r.dll === true;
  const needsWeb = r.webRequest === true;
  const dllOk = !needsDll || /\bdll\b/.test(txt);
  const webOk = !needsWeb || /webrequest|web request|url yang diizinkan|allowlist|daftar url/.test(txt);
  const behaviourOk = /oninit|gagal init|inisialisasi gagal|smiley merah|tidak akan (jalan|berfungsi|init)/.test(txt) || names.length === 0;
  const ok = missingNames.length === 0 && dllOk && webOk && behaviourOk;
  return {
    state: ok ? "PASS" : "MISSING",
    reason: ok
      ? "Semua ketergantungan (indikator/DLL/WebRequest) terdaftar beserta akibat bila file hilang."
      : `Ketergantungan belum lengkap di manual: ${[...missingNames, needsDll && !dllOk ? "DLL" : "", needsWeb && !webOk ? "WebRequest" : "", !behaviourOk ? "akibat file hilang" : ""].filter(Boolean).join(", ")}.`,
    evidence: {
      declaredIndicators: names,
      missingIndicatorMentions: missingNames,
      needsDll,
      needsWebRequest: needsWeb,
      dllDocumented: dllOk,
      webRequestDocumented: webOk,
      missingFileBehaviourDocumented: behaviourOk,
    },
    navigateSectionKey: "installation",
  };
}

function checkPackageFiles(vm: ManualViewModel): RuleOutcome {
  const pkg = sectionByKey(vm, "package");
  const install = sectionByKey(vm, "installation");
  const covered = sectionHasContent(pkg) || /\.ex[45]\b|\.set\b|experts[\/\\]|indicators[\/\\]|presets[\/\\]/i.test(sectionText(install));
  return {
    state: covered ? "PASS" : "WARNING",
    reason: covered
      ? "Isi paket / daftar file terdokumentasi (bab Isi Paket atau bab Instalasi)."
      : "Ada file tambahan yang dikirim tetapi bab Isi Paket belum mendaftarkannya (item tidak wajib).",
    evidence: { packageSectionId: pkg?.id ?? null, packageHasContent: sectionHasContent(pkg) },
    navigateSectionKey: "package",
  };
}

// ---------------------------------------------------------------------------
// Rules — how it works & settings
// ---------------------------------------------------------------------------

function checkCaraKerja(vm: ManualViewModel): RuleOutcome {
  const section = sectionByKey(vm, "how-it-works");
  const txt = sectionText(section);
  const low = txt.toLowerCase();
  const entry = /\b(entry|masuk|sinyal|signal|buka posisi|kondisi masuk|jika[^.\n]{0,60}maka|order (buy|sell))\b/.test(low);
  const exit = /\b(exit|keluar|tutup posisi|take profit|\btp\b|stop loss|\bsl\b|kondisi keluar|trailing)\b/.test(low);
  const manage = /\b(manajemen posisi|grid|martingale|hedging|partial close|averaging|satu posisi|single position)\b/.test(low);
  if (!sectionHasContent(section) || txt.length < 200) {
    return {
      state: "MISSING",
      reason: "Bab Cara Kerja EA belum berisi uraian yang cukup (butuh kondisi masuk, tidak masuk, manajemen posisi, dan keluar).",
      evidence: { sectionId: section?.id ?? null, length: txt.length },
      navigateSectionKey: "how-it-works",
    };
  }
  const ok = entry && exit && manage;
  return {
    state: ok ? "PASS" : "WARNING",
    reason: ok
      ? "Cara Kerja menjelaskan kondisi masuk, manajemen posisi, dan kondisi keluar."
      : "Cara Kerja ada isinya tetapi belum jelas pada salah satu dari: kondisi masuk, manajemen posisi, kondisi keluar.",
    evidence: { sectionId: section?.id ?? null, length: txt.length, hasEntry: entry, hasExit: exit, hasManagement: manage },
    navigateSectionKey: "how-it-works",
  };
}

const SPECIAL_CONDITION_RES: RegExp[] = [
  /spread[^.\n]{0,40}(lebar|tinggi|melebar|wide)|skip[^.\n]{0,20}spread/,
  /reconnect|koneksi terputus|putus koneksi|gap[^.\n]{0,20}(akhir pekan|weekend)|weekend gap|sambung(kan)? kembali/,
  /oninit[^.\n]{0,40}(gagal|fail)|inisialisasi gagal|gagal init/,
  /dua chart|2 chart|chart (kembar|ganda)|simbol sama[^.\n]{0,30}(dua|2)|double order/,
  /(tutup|close)[^.\n]{0,20}(manual|sendiri)[^.\n]{0,40}(buka lagi|reopen|membuka kembali|tick berikut)/,
];

function checkSpecialConditions(vm: ManualViewModel): RuleOutcome {
  const section = sectionByKey(vm, "how-it-works");
  const low = sectionText(section).toLowerCase();
  if (!sectionHasContent(section)) {
    return { state: "MISSING", reason: "Bab Cara Kerja EA belum memiliki isi.", evidence: {}, navigateSectionKey: "how-it-works" };
  }
  const hit = phrasesHit(low, SPECIAL_CONDITION_RES);
  const state: RuleOutcome["state"] = hit >= 4 ? "PASS" : hit >= 1 ? "WARNING" : "MISSING";
  return {
    state,
    reason:
      state === "PASS"
        ? `Kondisi khusus dijawab (${hit}/5: spread lebar, reconnect/gap, OnInit gagal, dua chart, tutup manual).`
        : `Kondisi khusus belum lengkap (${hit}/5 terjawab). Perlu minimal 4 dari 5.`,
    evidence: { sectionId: section?.id ?? null, conditionsAnswered: hit, conditionsExpected: 5 },
    navigateSectionKey: "how-it-works",
  };
}

function checkSetting(vm: ManualViewModel): RuleOutcome {
  const section = sectionByKey(vm, "parameters");
  if (!section) {
    return { state: "MISSING", reason: "Bab Referensi Input / Parameter tidak ada.", evidence: { sectionKey: "parameters" }, navigateSectionKey: "parameters" };
  }
  const validGroupIds = new Set(vm.parameterGroups.map((g) => g.id));
  const tableRefsOwn = section.blocks.some(
    (b) => b.type === "parameterTable" && b.parameterGroupIds.some((id) => validGroupIds.has(id)),
  );
  const prose = sectionText(section);
  const ok = tableRefsOwn || prose.length >= 150;
  return {
    state: ok ? "PASS" : "MISSING",
    reason: ok
      ? tableRefsOwn
        ? "Setelan didokumentasikan melalui tabel parameter yang mereferensikan definisi milik EA Version."
        : "Setelan diuraikan dalam prosa yang cukup pada bab Parameter."
      : "Bab Parameter belum mendokumentasikan setelan (tambahkan tabel parameter by-reference atau uraian setelan).",
    evidence: { sectionId: section.id, referencesOwnGroups: tableRefsOwn, proseLength: prose.length },
    navigateSectionKey: "parameters",
  };
}

function checkParamComplete(vm: ManualViewModel): RuleOutcome {
  const paramSection = sectionByKey(vm, "parameters");
  const validGroupIds = new Set(vm.parameterGroups.map((g) => g.id));
  const groupsWithParams = vm.parameterGroups.filter((g) => g.parameters.length > 0);

  if (!paramSection) {
    return { state: "MISSING", reason: "Bab Referensi Input / Parameter tidak ada.", evidence: { sectionKey: "parameters" }, navigateSectionKey: "parameters" };
  }
  const paramTableBlocks = paramSection.blocks.filter((b) => b.type === "parameterTable");
  const referenced = new Set<string>();
  for (const b of paramTableBlocks) {
    for (const gid of b.parameterGroupIds) if (validGroupIds.has(gid)) referenced.add(gid);
  }
  const missingGroups = groupsWithParams
    .filter((g) => !referenced.has(g.id))
    .map((g) => ({ groupId: g.id, name: g.name, paramCount: g.parameters.length }));

  return {
    state: missingGroups.length ? "MISSING" : "PASS",
    reason: missingGroups.length
      ? `Grup parameter belum ada di tabel: ${missingGroups.map((g) => g.name).join(", ")}.`
      : "Setiap grup parameter EA sudah muncul di tabel parameter.",
    evidence: {
      sectionId: paramSection.id,
      paramTableBlockIds: paramTableBlocks.map((b) => b.id),
      referencedGroupIds: [...referenced],
      missingGroups,
    },
    navigateSectionKey: "parameters",
  };
}

const DEFAULT_CLAIM_RE = /\b(default|bawaan|nilai default)\b[^.\n]{0,40}?[:=]?\s*["'`]?(-?\d+(?:[.,]\d+)?)/gi;

function checkParamDefaultMatch(vm: ManualViewModel): RuleOutcome {
  const paramSection = sectionByKey(vm, "parameters");
  const params = vm.parameterGroups.flatMap((g) => g.parameters);
  const text = sectionText(paramSection).toLowerCase();
  const mismatches: { technicalName: string; stated: string; eaDefault: string | null }[] = [];

  for (const m of text.matchAll(DEFAULT_CLAIM_RE)) {
    const stated = m[2];
    const before = text.slice(Math.max(0, m.index - 90), m.index);
    const param = params.find(
      (p) => before.includes(p.technicalName.toLowerCase()) || before.includes(p.displayName.toLowerCase()),
    );
    if (!param || param.defaultValue == null) continue;
    const norm = (s: string) => s.replace(",", ".").replace(/[^\d.-]/g, "");
    if (norm(stated) !== norm(param.defaultValue)) {
      mismatches.push({ technicalName: param.technicalName, stated, eaDefault: param.defaultValue });
    }
  }

  return {
    state: mismatches.length ? "WARNING" : "PASS",
    reason: mismatches.length
      ? `Nilai default di teks berbeda dari definisi EA: ${mismatches.map((x) => x.technicalName).join(", ")}.`
      : "Tidak ada nilai default di teks yang bertentangan dengan definisi EA.",
    evidence: { sectionId: paramSection?.id ?? null, mismatches },
    navigateSectionKey: "parameters",
  };
}

const UNIT_DEFINITION_RE =
  /_point|1\s*pip\s*=|pip\s*=\s*\d|poin\s*=\s*\d|(\d+)\s*(poin|point)\s*(=|setara|sama dengan)\s*\d+\s*pip|poin bukan pip|dinyatakan dalam (poin|point|pip)|satuan[^.\n]{0,20}(poin|point|pip)|(nilai|harga)[^.\n]{0,20}dalam (poin|point)/i;

function checkUnitsDefined(vm: ManualViewModel): RuleOutcome {
  const defined = UNIT_DEFINITION_RE.test(manualText(vm));
  return {
    state: defined ? "PASS" : "WARNING",
    reason: defined
      ? "Satuan poin/pip sudah didefinisikan di manual."
      : "Manual memakai istilah poin/pip tetapi belum menjelaskan satuannya (mis. mengacu _Point atau 1 pip = ... poin).",
    evidence: { usesUnitTerms: true, hasDefinition: defined },
    navigateSectionKey: "parameters",
  };
}

function checkQuickstartDemo(vm: ManualViewModel): RuleOutcome {
  const section = sectionByKey(vm, "quick-start");
  const low = sectionText(section).toLowerCase();
  if (!sectionHasContent(section)) {
    return { state: "MISSING", reason: "Bab Mulai Cepat belum memiliki isi.", evidence: {}, navigateSectionKey: "quick-start" };
  }
  const demoFirst = /akun demo|gunakan demo|pakai demo|demo (dulu|terlebih dahulu|lebih dulu)|jangan[^.\n]{0,20}(live|riil)|bukan akun (live|riil)/.test(low);
  return {
    state: demoFirst ? "PASS" : "MISSING",
    reason: demoFirst
      ? "Mulai Cepat menegaskan penggunaan akun demo terlebih dahulu."
      : "Mulai Cepat belum menegaskan pemakaian akun demo dulu (bukan akun riil).",
    evidence: { sectionId: section?.id ?? null, demoFirst },
    navigateSectionKey: "quick-start",
  };
}

function checkSafeStop(vm: ManualViewModel): RuleOutcome {
  const qs = sectionByKey(vm, "quick-start");
  const hiw = sectionByKey(vm, "how-it-works");
  const low = `${sectionText(qs)}\n${sectionText(hiw)}`.toLowerCase();
  const safeStop =
    /menghentikan ea|hentikan ea|matikan ea|cara (stop|berhenti)|safe.?stop|jangan (sekadar |langsung )?tutup chart|nonaktifkan (algo|auto)/.test(low) &&
    /posisi (terbuka|aktif)|open position|masih ada posisi/.test(low);
  return {
    state: safeStop ? "PASS" : "MISSING",
    reason: safeStop
      ? "Ada instruksi menghentikan EA dengan aman saat masih ada posisi terbuka."
      : "Belum ada prosedur menghentikan EA dengan aman (jangan menutup chart begitu saja bila ada posisi terbuka).",
    evidence: { quickStartId: qs?.id ?? null, hasSafeStop: safeStop },
    navigateSectionKey: "quick-start",
  };
}

function checkFiturDijelaskan(vm: ManualViewModel): RuleOutcome {
  const features = eaVerifiedFeatures(vm);
  const hiw = sectionByKey(vm, "how-it-works");
  const iface = sectionByKey(vm, "interface");
  const txt = `${sectionText(hiw)}\n${sectionText(iface)}`.toLowerCase();
  const missing = features.filter((f) => !txt.includes(f.toLowerCase()));
  return {
    state: missing.length ? "MISSING" : "PASS",
    reason: missing.length
      ? `Fitur terverifikasi belum dijelaskan di manual: ${missing.join(", ")}.`
      : "Setiap fitur terverifikasi yang dinyatakan EA Version memiliki penjelasan di manual.",
    evidence: { declaredFeatures: features, undocumentedFeatures: missing },
    navigateSectionKey: "how-it-works",
  };
}

function checkInterface(vm: ManualViewModel): RuleOutcome {
  const section = sectionByKey(vm, "interface");
  const txt = sectionText(section);
  const hasImg = hasImageBlock(section);
  const ok = hasImg && txt.length >= 80;
  return {
    state: ok ? "PASS" : "MISSING",
    reason: ok
      ? "Bab Antarmuka EA memuat gambar panel dan daftar kontrol."
      : "EA menyatakan ada GUI: bab Antarmuka EA butuh minimal satu gambar panel beranotasi dan daftar kontrol.",
    evidence: { sectionId: section?.id ?? null, hasImage: hasImg, textLength: txt.length },
    navigateSectionKey: "interface",
  };
}

// ---------------------------------------------------------------------------
// Rules — risk & claims
// ---------------------------------------------------------------------------

const DISCLAIMER_CONCEPTS: [string, RegExp][] = [
  ["alat_bantu", /alat bantu|sistem otomatis|bersifat otomatis|automated (tool|aid|system)|hanya (membantu|alat)|sebagai alat/],
  ["tidak_menjamin_profit", /tidak menjamin (keuntungan|profit|laba)|bukan jaminan (keuntungan|profit)|tanpa jaminan (keuntungan|profit)|does not guarantee profit/],
  ["risiko_pbk_tetap", /tidak menghilangkan (risiko|resiko)|tidak menghapus (risiko|resiko)|risiko[^.\n]{0,40}(tetap ada|tidak hilang|melekat)|risiko (pbk|perdagangan berjangka)|does not (remove|eliminate)[^.\n]{0,20}risk/],
];

function checkDisclaimer(vm: ManualViewModel): RuleOutcome {
  const disc = sectionByKey(vm, "disclaimer");
  const text = sectionText(disc).toLowerCase();
  const matched = DISCLAIMER_CONCEPTS.filter(([, re]) => re.test(text)).map(([k]) => k);
  const missing = DISCLAIMER_CONCEPTS.filter(([, re]) => !re.test(text)).map(([k]) => k);
  const ok = missing.length === 0 && text.length > 0;
  return {
    state: ok ? "PASS" : "MISSING",
    reason: ok
      ? "Kalimat disclaimer Pasal 5(5)d ditemukan (alat bantu, tidak menjamin profit, risiko tetap ada)."
      : `Konsep disclaimer belum lengkap di bab Pernyataan Risiko: ${missing.join(", ")}.`,
    evidence: { sectionId: disc?.id ?? null, matchedConcepts: matched, missingConcepts: missing },
    navigateSectionKey: "disclaimer",
  };
}

function checkRiskGeneral(vm: ManualViewModel): RuleOutcome {
  return conceptOutcome(
    vm,
    ["risk", "disclaimer"],
    [/risiko|resiko|berisiko/, /modal[^.\n]{0,30}(berkurang|hilang|habis|turun)|kerugian|capital can be lost|dapat kehilangan|kehilangan (modal|dana)/],
    {
      navigate: "risk",
      passReason: "Pernyataan risiko umum trading tersedia (forex/CFD berisiko, modal dapat berkurang/hilang).",
      missingReason: () => "Belum ada pernyataan risiko umum: trading forex/CFD berisiko dan modal dapat berkurang atau hilang.",
      emptyReason: "Bab Risiko & Manajemen Dana belum memiliki isi.",
    },
  );
}

function checkPastNotFuture(vm: ManualViewModel): RuleOutcome {
  return conceptOutcome(
    vm,
    ["performance", "disclaimer", "risk"],
    [/masa lalu[^.\n]{0,40}(tidak menjamin|bukan jaminan)|past (results|performance)[^.\n]{0,30}not[^.\n]{0,15}(guarantee|indicativ)|hasil (tester|backtest|lampau)[^.\n]{0,40}(tidak menjamin|bukan jaminan)|tidak menjamin (hasil|kinerja)[^.\n]{0,20}(masa depan|mendatang|di masa)/],
    {
      navigate: "performance",
      min: 1,
      passReason: "Pernyataan “hasil masa lalu bukan jaminan hasil di masa depan” tersedia.",
      missingReason: () => "Belum ada pernyataan bahwa hasil tester / masa lalu tidak menjamin hasil di masa depan.",
      emptyReason: "Belum ada bab (Informasi Backtest / Pernyataan Risiko) yang memuat kaveat hasil masa lalu.",
    },
  );
}

function checkDangerModeWarn(vm: ManualViewModel): RuleOutcome {
  const section = sectionByKey(vm, "risk");
  if (!section) {
    return { state: "MISSING", reason: "Bab Risiko & Manajemen Dana tidak ada.", evidence: { sectionKey: "risk" }, navigateSectionKey: "risk" };
  }
  const first: Block | undefined = section.blocks[0];
  const isTopWarning =
    !!first && first.type === "callout" && String((first.payload as Record<string, unknown>).tone) === "warning";
  return {
    state: isTopWarning ? "PASS" : "MISSING",
    reason: isTopWarning
      ? "Bab Risiko diawali callout peringatan untuk mode berisiko tinggi."
      : "EA memakai mode berisiko tinggi — tambahkan callout peringatan sebagai blok pertama bab Risiko.",
    evidence: {
      sectionId: section.id,
      firstBlockId: first?.id ?? null,
      firstBlockType: first?.type ?? null,
      firstBlockTone: first ? String((first.payload as Record<string, unknown>).tone ?? "") : null,
    },
    navigateSectionKey: "risk",
  };
}

function checkNoProhibitedClaims(vm: ManualViewModel): RuleOutcome {
  const findings = scanClaims(projectManualLines(vm)); // Phase 4 scanner — no duplicate
  if (findings.length === 0) {
    return { state: "PASS", reason: "Tidak ada frasa klaim terlarang yang terdeteksi.", evidence: { findingCount: 0, categories: [] } };
  }
  const byCat = new Map<string, { category: string; categoryLabel: string; count: number; excerpt: string; location: string }>();
  for (const f of findings) {
    const e = byCat.get(f.category);
    if (e) e.count += 1;
    else byCat.set(f.category, { category: f.category, categoryLabel: f.categoryLabel, count: 1, excerpt: f.excerpt.slice(0, 160), location: f.location });
  }
  const categories = [...byCat.values()];
  const publishBlocking = categories.map((c) => c.category).filter((c) => PUBLISH_BLOCKING_CLAIM_CATEGORIES.has(c));
  return {
    state: "WARNING",
    reason: `${findings.length} frasa klaim berisiko terdeteksi (${categories.length} kategori). Tinjau bersama manusia — tidak ada perubahan otomatis.`,
    evidence: { findingCount: findings.length, categories, publishBlockingCategories: publishBlocking },
  };
}

// ---------------------------------------------------------------------------
// Rules — support & transparency
// ---------------------------------------------------------------------------

function checkKontak(vm: ManualViewModel): RuleOutcome {
  const support = (vm.eaVersion.support ?? {}) as Record<string, unknown>;
  const channelKinds = (["email", "phone", "whatsapp"] as const).filter(
    (k) => typeof support[k] === "string" && (support[k] as string).trim() !== "",
  );
  const section = sectionByKey(vm, "support");
  const sectionTxt = sectionText(section).toLowerCase();
  const hoursTxt = String(support.hours ?? "").toLowerCase();
  const H247 = /24\s*[\/x]\s*7|24\s*jam|nonstop|non-stop|sepanjang waktu|setiap saat|round[- ]the[- ]clock/;
  const has247 = H247.test(sectionTxt) || H247.test(hoursTxt);

  let state: RuleOutcome["state"];
  let reason: string;
  if (channelKinds.length === 0) {
    state = "MISSING";
    reason =
      "Data dukungan pada EA Version belum tersedia atau belum lengkap (email/telepon/WhatsApp). " +
      "Perlu dikonfirmasi Admin/perusahaan — bukan diisi oleh penulis manual.";
  } else if (!sectionHasContent(section)) {
    state = "MISSING";
    reason = "Bab Dukungan belum memuat kontak dukungan.";
  } else if (!has247) {
    state = "WARNING";
    reason = "Kontak tersedia, tetapi pernyataan ketersediaan 24/7 belum ditemukan.";
  } else {
    state = "PASS";
    reason = "Kontak dukungan nyata dan pernyataan 24/7 tersedia.";
  }
  return { state, reason, evidence: { sectionId: section?.id ?? null, channelKinds, has247 }, navigateSectionKey: "support" };
}

function checkKontakSplit(vm: ManualViewModel): RuleOutcome {
  const section = sectionByKey(vm, "support");
  const low = sectionText(section).toLowerCase();
  if (!sectionHasContent(section)) {
    return { state: "MISSING", reason: "Bab Dukungan belum memiliki isi.", evidence: {}, navigateSectionKey: "support" };
  }
  const technical = /teknis|technical|instalasi|error|setelan|input/.test(low);
  const transaction = /transaksi|finansial|keuangan|dana|pialang|broker berjangka|margin/.test(low);
  const split = technical && transaction && /(smartin|pengembang|tim teknis)/.test(low) && /pialang|broker/.test(low);
  return {
    state: split ? "PASS" : "MISSING",
    reason: split
      ? "Pembagian tanggung jawab dinyatakan: masalah teknis ke Smartin; masalah transaksi/finansial ke pialang."
      : "Bab Dukungan belum menyatakan pembagian: masalah teknis (Smartin) vs transaksi/finansial (pialang).",
    evidence: { sectionId: section?.id ?? null, mentionsTechnical: technical, mentionsTransaction: transaction },
    navigateSectionKey: "support",
  };
}

function checkTransparansi(vm: ManualViewModel): RuleOutcome {
  const section = sectionByKey(vm, "transparency");
  const txt = sectionText(section);
  const low = txt.toLowerCase();
  if (!sectionHasContent(section) || txt.length < 150) {
    return {
      state: "MISSING",
      reason: "Bab Transparansi Strategi belum memuat uraian algoritma / sistem trading yang cukup.",
      evidence: { sectionId: section?.id ?? null, length: txt.length },
      navigateSectionKey: "transparency",
    };
  }
  const describesStrategy = /strategi|algoritma|sistem trading|indikator|logika|pendekatan|metode/.test(low);
  return {
    state: describesStrategy ? "PASS" : "WARNING",
    reason: describesStrategy
      ? "Bab Transparansi memuat uraian bahasa sederhana tentang algoritma / strategi."
      : "Bab Transparansi ada isinya tetapi belum jelas menguraikan algoritma / strategi.",
    evidence: { sectionId: section?.id ?? null, length: txt.length, describesStrategy },
    navigateSectionKey: "transparency",
  };
}

function checkBahasaAlgo(vm: ManualViewModel): RuleOutcome {
  return conceptOutcome(
    vm,
    ["transparency"],
    [/bahasa (indonesia|inggris)|(instruksi|algoritma|perintah)[^.\n]{0,40}(bahasa indonesia|bahasa inggris|indonesian|english)|written in (indonesian|english)|program[^.\n]{0,30}(bahasa indonesia|bahasa inggris)/],
    {
      navigate: "transparency",
      passReason: "Bab Transparansi menyatakan bahasa algoritma/instruksi (Bahasa Indonesia atau Inggris).",
      missingReason: () => "Belum ada pernyataan bahwa algoritma/instruksi program ditulis dalam Bahasa Indonesia atau Bahasa Inggris (Pasal 5(4)d).",
      emptyReason: "Bab Transparansi Strategi belum memiliki isi.",
    },
  );
}

function checkPeriodeEfektif(vm: ManualViewModel): RuleOutcome {
  return conceptOutcome(
    vm,
    ["transparency", "overview"],
    [/periode efektif|masa (berlaku|efektif)|jangka waktu penggunaan|periode penggunaan (ea|advisory)|effective period|masa aktif (lisensi|penggunaan)/],
    {
      navigate: "transparency",
      passReason: "Periode efektif penggunaan EA dinyatakan (Pasal 5(6) poin 5).",
      missingReason: () => "Belum ada pernyataan periode efektif penggunaan EA.",
      emptyReason: "Bab Transparansi Strategi belum memiliki isi.",
    },
  );
}

// ---------------------------------------------------------------------------
// Rules — performance evidence
// ---------------------------------------------------------------------------

const PERF_CONTEXT_RE =
  /\bbroker\b|\bspread\b|\bmodel\b[^.\n]{0,16}(tick|harga|open)|setiap tick|control points|open prices|rentang tanggal|periode[^.\n]{0,10}\d|dari[^.\n]{0,20}(sampai|hingga|s\/d)[^.\n]{0,20}20\d\d|\bdeposit\b|\bleverage\b|\bakun\b[^.\n]{0,12}(demo|riil|standar|ecn)/gi;

function checkPerformanceKondisi(vm: ManualViewModel): RuleOutcome {
  const section = sectionByKey(vm, "performance");
  const txt = sectionText(section);
  const contextHits = [...txt.matchAll(PERF_CONTEXT_RE)].length;
  const ok = contextHits >= 2;
  return {
    state: ok ? "PASS" : "WARNING",
    reason: ok
      ? "Angka kinerja disertai kondisi uji (broker/spread/model/periode/deposit)."
      : "Angka kinerja ditampilkan tanpa kondisi uji yang cukup (butuh minimal 2: broker, spread, model, rentang tanggal, deposit).",
    evidence: { sectionId: section?.id ?? null, contextHits },
    navigateSectionKey: "performance",
  };
}

// ---------------------------------------------------------------------------
// Rules — Bappebti-scope references
// ---------------------------------------------------------------------------

function checkDisclosureRef(vm: ManualViewModel): RuleOutcome {
  return conceptOutcome(
    vm,
    ["disclaimer", "transparency"],
    [/disclosure statement|pernyataan pengungkapan|dokumen pengungkapan|rekaman video|recorded video|video[^.\n]{0,20}(baca|membaca)|pasal 9/],
    {
      navigate: "disclaimer",
      min: 1,
      passReason: "Manual merujuk proses disclosure statement + rekaman video sebelum EA dijalankan di akun berjangka Indonesia (Pasal 9).",
      missingReason: () => "Belum ada rujukan proses disclosure statement + rekaman video dengan pialang (Pasal 9).",
      emptyReason: "Bab Pernyataan Risiko belum memiliki isi untuk memuat rujukan Pasal 9.",
    },
  );
}

function checkOnboardingMargin(vm: ManualViewModel): RuleOutcome {
  return conceptOutcome(
    vm,
    ["overview", "risk", "transparency", "requirements"],
    [/50[.\s]?000[.\s]?000|rp\s*50\s*juta|50\s*juta|minimum margin|margin minimum|modal minimum[^.\n]{0,20}(rp|50)|kemampuan margin/],
    {
      navigate: "overview",
      min: 1,
      passReason: "Ekspektasi kemampuan margin minimum untuk onboarding disebutkan (mis. paling sedikit Rp50.000.000).",
      missingReason: () => "Belum ada penyebutan ekspektasi kemampuan margin minimum onboarding (paling sedikit Rp50.000.000).",
      emptyReason: "Belum ada bab (Ringkasan / Risiko / Transparansi) yang memuat ekspektasi margin onboarding.",
    },
  );
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export const RULES: Record<string, (vm: ManualViewModel) => RuleOutcome> = {
  "CHK-VERSI-DUA": checkVersiDua,
  "CHK-VERSI-MATCH": checkVersiMatch,
  "CHK-DEV-LEGAL": checkDevLegal,
  "CHK-INSTALASI": checkInstalasi,
  "CHK-INSTALL-AUTOTRADING": checkInstallAutotrading,
  "CHK-DEPENDENCIES-LISTED": checkDependenciesListed,
  "CHK-PACKAGE-FILES": checkPackageFiles,
  "CHK-CARA-KERJA": checkCaraKerja,
  "CHK-SPECIAL-CONDITIONS": checkSpecialConditions,
  "CHK-SETTING": checkSetting,
  "CHK-PARAM-COMPLETE": checkParamComplete,
  "CHK-PARAM-DEFAULT-MATCH": checkParamDefaultMatch,
  "CHK-UNITS-DEFINED": checkUnitsDefined,
  "CHK-QUICKSTART-DEMO": checkQuickstartDemo,
  "CHK-SAFE-STOP": checkSafeStop,
  "CHK-DISCLAIMER-5-5-D": checkDisclaimer,
  "CHK-RISK-GENERAL": checkRiskGeneral,
  "CHK-PAST-NOT-FUTURE": checkPastNotFuture,
  "CHK-DANGER-MODE-WARN": checkDangerModeWarn,
  "CHK-NO-PROHIBITED-CLAIMS": checkNoProhibitedClaims,
  "CHK-KONTAK": checkKontak,
  "CHK-KONTAK-SPLIT": checkKontakSplit,
  "CHK-TRANSPARANSI": checkTransparansi,
  "CHK-BAHASA-ALGO": checkBahasaAlgo,
  "CHK-PERIODE-EFEKTIF": checkPeriodeEfektif,
  "CHK-PERFORMANCE-KONDISI": checkPerformanceKondisi,
  "CHK-CHANGELOG-VERSI": checkChangelogVersi,
  "CHK-DISCLOSURE-REF": checkDisclosureRef,
  "CHK-ONBOARDING-MARGIN": checkOnboardingMargin,
  "CHK-FITUR-DIJELASKAN": checkFiturDijelaskan,
  "CHK-INTERFACE": checkInterface,
};

/** Every registered rule key — the drift guard compares this against the active template. */
export const RULE_KEYS: readonly string[] = Object.keys(RULES);
