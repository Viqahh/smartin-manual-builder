/**
 * Phase 5 — documentation-readiness domain types (PRD-VAL-002, PRD-COMP-006, AC-P5-2).
 *
 * These describe a computed *documentation-readiness* signal. They are NEVER an approval:
 * the only states are PASS / WARNING / MISSING / NOT_APPLICABLE and nothing here renders as
 * "Approved" / "Compliant" / "Bappebti" (COMPLIANCE_REQUIREMENTS.md §0).
 *
 * Import-safe on the client (no server-only, no DB access).
 */

export const CHECKLIST_STATES = ["PASS", "WARNING", "MISSING", "NOT_APPLICABLE"] as const;
export type ChecklistState = (typeof CHECKLIST_STATES)[number];

export type PbkScope = "IN_SCOPE" | "OUT_OF_SCOPE";

/** Category slug -> Indonesian label for the grouped inspector panel (v1 checklist). */
export const CATEGORY_LABELS: Record<string, string> = {
  identity: "Identitas & Versi",
  installation: "Instalasi & Paket",
  "how-it-works": "Cara Kerja & Setelan",
  risk: "Risiko & Klaim",
  support: "Dukungan & Transparansi",
  performance: "Bukti Kinerja",
  bappebti: "Rujukan Lingkup Bappebti",
};

/** Stable category order for rendering. */
export const CATEGORY_ORDER = [
  "identity", "installation", "how-it-works", "risk", "support", "performance", "bappebti",
] as const;

/**
 * UAT-29 / UAT-12D — who typically resolves each checklist item. PRESENTATION ONLY: it groups the
 * "needs attention" list by resolution owner so the author is not told to invent wording for a
 * fact they cannot supply. It NEVER changes a rule's state, applicability, or the publish gate.
 * App-level map (no `checklist_items` column, no migration).
 */
export type ChecklistOwner = "author" | "source-of-truth" | "organisation" | "compliance";

const CHECKLIST_OWNER: Record<string, ChecklistOwner> = {
  "CHK-VERSI-DUA": "author",
  "CHK-VERSI-MATCH": "author",
  "CHK-INSTALASI": "author",
  "CHK-INSTALL-AUTOTRADING": "author",
  "CHK-PACKAGE-FILES": "author",
  "CHK-QUICKSTART-DEMO": "author",
  "CHK-SAFE-STOP": "author",
  "CHK-KONTAK-SPLIT": "author",
  "CHK-CHANGELOG-VERSI": "author",
  "CHK-INTERFACE": "author",
  "CHK-CARA-KERJA": "source-of-truth",
  "CHK-SPECIAL-CONDITIONS": "source-of-truth",
  "CHK-SETTING": "source-of-truth",
  "CHK-PARAM-COMPLETE": "source-of-truth",
  "CHK-PARAM-DEFAULT-MATCH": "source-of-truth",
  "CHK-UNITS-DEFINED": "source-of-truth",
  "CHK-FITUR-DIJELASKAN": "source-of-truth",
  "CHK-DEPENDENCIES-LISTED": "source-of-truth",
  "CHK-DANGER-MODE-WARN": "source-of-truth",
  "CHK-PERFORMANCE-KONDISI": "source-of-truth",
  "CHK-DEV-LEGAL": "organisation",
  "CHK-KONTAK": "organisation",
  "CHK-ONBOARDING-MARGIN": "organisation",
  "CHK-DISCLAIMER-5-5-D": "compliance",
  "CHK-RISK-GENERAL": "compliance",
  "CHK-PAST-NOT-FUTURE": "compliance",
  "CHK-NO-PROHIBITED-CLAIMS": "compliance",
  "CHK-TRANSPARANSI": "compliance",
  "CHK-BAHASA-ALGO": "compliance",
  "CHK-PERIODE-EFEKTIF": "compliance",
  "CHK-DISCLOSURE-REF": "compliance",
};

export function checklistOwner(checkKey: string): ChecklistOwner {
  return CHECKLIST_OWNER[checkKey] ?? "author";
}

export const CHECKLIST_OWNER_LABEL: Record<ChecklistOwner, string> = {
  author: "Bisa kamu perbaiki",
  "source-of-truth": "Butuh data teknis / source-of-truth",
  organisation: "Butuh Admin / perusahaan",
  compliance: "Butuh Compliance",
};

/** display order for the "needs attention" owner groups */
export const CHECKLIST_OWNER_ORDER: ChecklistOwner[] = [
  "author",
  "source-of-truth",
  "organisation",
  "compliance",
];

/**
 * WARNING-capable checklist rules — those whose deterministic evaluator in `lib/validation/rules.ts`
 * can return WARNING (a "soft" finding), not only PASS/MISSING (/NOT_APPLICABLE). Audited against
 * every rule function; `human-evidence-eligibility.test.ts` re-derives each rule's real output and
 * fails if this set drifts. It is NOT used to decide human-evidence eligibility (that is the
 * explicit `HUMAN_EVIDENCE_ELIGIBLE` set below) — it only backs the "no rule emits an un-audited
 * WARNING" soundness test.
 *
 *  author owner            : CHK-VERSI-DUA, CHK-INSTALL-AUTOTRADING, CHK-PACKAGE-FILES
 *  source-of-truth owner   : CHK-CARA-KERJA, CHK-SPECIAL-CONDITIONS, CHK-PARAM-DEFAULT-MATCH,
 *                            CHK-UNITS-DEFINED, CHK-PERFORMANCE-KONDISI
 *  organisation owner      : CHK-DEV-LEGAL, CHK-KONTAK
 *  compliance owner        : CHK-NO-PROHIBITED-CLAIMS, CHK-TRANSPARANSI
 * Every other rule is binary PASS/MISSING (or PASS only) and can never be WARNING.
 */
export const WARNING_CAPABLE: ReadonlySet<string> = new Set([
  "CHK-VERSI-DUA",
  "CHK-INSTALL-AUTOTRADING",
  "CHK-PACKAGE-FILES",
  "CHK-CARA-KERJA",
  "CHK-SPECIAL-CONDITIONS",
  "CHK-PARAM-DEFAULT-MATCH",
  "CHK-UNITS-DEFINED",
  "CHK-PERFORMANCE-KONDISI",
  "CHK-DEV-LEGAL",
  "CHK-KONTAK",
  "CHK-NO-PROHIBITED-CLAIMS",
  "CHK-TRANSPARANSI",
]);

/**
 * UAT-35 — the EXPLICIT, individually-audited set of checks a "Sudah ada di manual" human-evidence
 * submission may target. NOT inferred from ownership: a rule is listed here only if EVERY criterion
 * holds:
 *   (a) the author directly controls the relevant *manual prose* (a chapter/block they write);
 *   (b) the WARNING can plausibly be a genuine prose-detection false negative — the manual really
 *       does say the thing, in wording the keyword detector missed;
 *   (c) a reviewer can confirm the claim by opening the referenced chapter/block and reading it;
 *   (d) acceptance does NOT override any structured / system / source-of-truth fact;
 *   (e) acceptance does NOT "repair" malformed or invalid data.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  ELIGIBLE — with the exact false-negative each is meant to cover:
 *
 *  CHK-INSTALL-AUTOTRADING  (author · installation prose)
 *    WARNING = "enabling Algo Trading is described, but how to VERIFY it is active is not detected".
 *    False negative it covers: the manual DOES describe the verification step — e.g. "pastikan robot
 *    muncul di tab Experts", "ikon wajah tersenyum di pojok kanan atas", "cek baris 'EA loaded' di
 *    Journal" — phrased outside the detector's keyword set. Reviewer opens the Installation chapter
 *    and reads whether the check is genuinely there. No structured data involved.
 *
 *  CHK-PACKAGE-FILES  (author · package / installation prose, non-blocking)
 *    WARNING = "extra files ship, but neither the Package chapter nor the Installation prose lists
 *    them" (fires only when the Package chapter is empty AND the install text has no path tokens
 *    like `.ex5` / `Experts\`).
 *    False negative it covers: the manual DOES enumerate the package contents and where they go —
 *    e.g. "unduhan berisi file EA dan dua file indikator; letakkan di folder Experts dan Indicators"
 *    — using folder names as words rather than path tokens. Reviewer opens the Package/Installation
 *    chapter and reads the list. The check is about DOCUMENTING the package, not inventing the
 *    file list, so no source-of-truth fact is overridden.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  INELIGIBLE — author-owned + WARNING-capable but fails an eligibility criterion:
 *
 *  CHK-VERSI-DUA
 *    WARNING = "EA version and/or Manual version string is not valid SemVer MAJOR.MINOR.PATCH".
 *    This is a DATA-QUALITY defect in a metadata field, not a prose-detection miss: there is no
 *    chapter/block a reviewer could read to make `"1.0"` become a valid version. Fails (b), (c),
 *    (e). The fix is to correct the version field. → INELIGIBLE.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  Every other check is INELIGIBLE because:
 *   • it is only ever PASS/MISSING (no WARNING) — 7 author-owned rules; MISSING is a truly absent
 *     fact and can never be attested into existence; or
 *   • it is owned by organisation / compliance / source-of-truth — support data, PBK / regulatory
 *     statements, EA-Version structured data, and strategy / source-of-truth content are not the
 *     author's to attest through manual prose, regardless of state.
 *
 * The DB mirrors this exact set in `checklist_items.human_evidence_eligible` (migration 31) and the
 * `submit_checklist_evidence` RPC re-checks it; a test asserts DB == code. Acceptance still needs a
 * reviewer, never mutates `systemState`, only yields RESOLVED_BY_HUMAN_REVIEW on an eligible
 * WARNING, and goes STALE when the referenced content changes.
 */
export const HUMAN_EVIDENCE_ELIGIBLE: ReadonlySet<string> = new Set([
  "CHK-INSTALL-AUTOTRADING",
  "CHK-PACKAGE-FILES",
]);

export function isHumanEvidenceEligible(checkKey: string): boolean {
  return HUMAN_EVIDENCE_ELIGIBLE.has(checkKey);
}

export type EvidenceStatus = "PENDING" | "ACCEPTED" | "RETURNED" | "SUPERSEDED" | "STALE";

/**
 * A human-evidence submission attached to one checklist item (UAT-35). The deterministic
 * `state` / `systemState` are NEVER rewritten by this; it is a parallel human record.
 */
export type HumanEvidence = {
  id: string;
  status: EvidenceStatus;
  /** the automated state captured when the author submitted (always "WARNING"). */
  automatedStateAtSubmit: ChecklistState;
  submittedByName: string | null;
  submittedAt: string;
  sectionId: string | null;
  sectionKey: string | null;
  blockId: string | null;
  note: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReviewType: "TECHNICAL" | "COMPLIANCE" | null;
  returnReason: string | null;
  /** the submitted fingerprint no longer matches current content (or the anchor is gone). */
  isStale: boolean;
  /**
   * Workflow-only derived signal: an eligible check whose automated state is WARNING and which
   * has a current (non-stale) ACCEPTED submission by the correct reviewer. It does NOT change
   * `state`; it lets the score + publish gate treat this specific WARNING as resolved.
   */
  effectiveResolution: "RESOLVED_BY_HUMAN_REVIEW" | null;
};

/** Metadata for one checklist item (from `checklist_items`). */
export type ChecklistItemDef = {
  checkKey: string;
  label: string;
  category: string;
  description: string;
  required: boolean;
  ruleKey: string;
  bappebtiOnly: boolean;
  publishBlocking: boolean;
  position: number;
};

/** Bounded, id/key-based evidence — never manual body, credentials, or URLs (PRD-SEC-009). */
export type ItemEvidence = Record<string, unknown>;

/** The outcome one deterministic rule produces for a manual. */
export type RuleOutcome = {
  state: ChecklistState;
  reason: string;
  evidence: ItemEvidence;
  /** section key a reviewer/developer should open to act on this item, when known. */
  navigateSectionKey?: string;
};

export type ItemResult = {
  checkKey: string;
  label: string;
  category: string;
  required: boolean;
  publishBlocking: boolean;
  state: ChecklistState;
  /** the state the automated rule computed (kept even when a reviewer N/A override wins). */
  systemState: ChecklistState;
  evaluator: "system" | "reviewer";
  reason: string;
  evidence: ItemEvidence;
  navigateSectionKey: string | null;
  /** present only when a reviewer manually set NOT_APPLICABLE. */
  override: { actorId: string | null; actorName: string | null; reason: string; at: string } | null;
  /** UAT-35 — this check accepts a "Sudah ada di manual" human-evidence submission. */
  humanEvidenceEligible: boolean;
  /** UAT-35 — the current live human-evidence submission for this check, when one exists. */
  humanEvidence: HumanEvidence | null;
};

export type ReadinessScore = {
  numerator: number;
  denominator: number;
  /** required in-scope PASS ÷ required in-scope; null when no required item applies. */
  percent: number | null;
};

export type Eligibility = {
  ready: boolean;
  /** labels of required, in-scope items currently MISSING (WARNING never blocks). */
  blockingReasons: string[];
};

export type ValidationView = {
  /** the manual_version this view was computed for — lets the client detect a stale/wrong payload */
  manualVersionId: string;
  templateId: string;
  templateVersion: number;
  pbkScope: PbkScope;
  items: ItemResult[];
  score: ReadinessScore;
  eligibility: Eligibility;
  counts: Record<ChecklistState, number>;
  evaluatedAt: string | null;
};
