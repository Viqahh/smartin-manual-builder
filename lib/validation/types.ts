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
  templateId: string;
  templateVersion: number;
  pbkScope: PbkScope;
  items: ItemResult[];
  score: ReadinessScore;
  eligibility: Eligibility;
  counts: Record<ChecklistState, number>;
  evaluatedAt: string | null;
};
