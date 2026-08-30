/**
 * Phase 6 — the manual-version workflow state machine (PRD-REV-001/002, AC-P6-2).
 *
 * Pure. The ONE place the legal transition graph lives. Slice-2/6 server commands each call
 * `assertTransition(from, to)` before touching the DB; the DB has its own status guards too.
 * The client never submits a target status for the server to accept blindly.
 */

export const MANUAL_STATES = [
  "DRAFT",
  "TECHNICAL_REVIEW",
  "COMPLIANCE_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "PUBLISHED",
  "ARCHIVED",
] as const;

export type ManualState = (typeof MANUAL_STATES)[number];

/** Exactly the Phase 6 graph — every edge not listed is invalid. */
export const TRANSITIONS: Record<ManualState, readonly ManualState[]> = {
  DRAFT: ["TECHNICAL_REVIEW"],
  TECHNICAL_REVIEW: ["COMPLIANCE_REVIEW", "CHANGES_REQUESTED"],
  COMPLIANCE_REVIEW: ["APPROVED", "CHANGES_REQUESTED"],
  CHANGES_REQUESTED: ["DRAFT"],
  APPROVED: ["PUBLISHED"],
  PUBLISHED: ["ARCHIVED"],
  ARCHIVED: [],
};

/** Content authoring is allowed only in DRAFT (spec §12). */
export const EDITABLE_STATES: readonly ManualState[] = ["DRAFT"];

export function isManualState(v: unknown): v is ManualState {
  return typeof v === "string" && (MANUAL_STATES as readonly string[]).includes(v);
}

export function canTransition(from: ManualState, to: ManualState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isContentEditable(state: ManualState): boolean {
  return EDITABLE_STATES.includes(state);
}

export class WorkflowError extends Error {
  readonly code = "WORKFLOW" as const;
  readonly from: ManualState | string;
  readonly to: ManualState | string;
  constructor(from: ManualState | string, to: ManualState | string, message?: string) {
    super(message ?? `Transisi tidak valid: ${from} → ${to}.`);
    this.name = "WorkflowError";
    this.from = from;
    this.to = to;
  }
}

/** Throws {@link WorkflowError} unless `from → to` is a legal edge. */
export function assertTransition(from: ManualState | string, to: ManualState | string): void {
  if (!isManualState(from)) throw new WorkflowError(from, to, `Status awal tidak dikenal: ${from}.`);
  if (!isManualState(to)) throw new WorkflowError(from, to, `Status tujuan tidak dikenal: ${to}.`);
  if (!canTransition(from, to)) throw new WorkflowError(from, to);
}

/** All legal (from, to) pairs — used by tests and by docs generation. */
export function legalEdges(): [ManualState, ManualState][] {
  return MANUAL_STATES.flatMap((from) => TRANSITIONS[from].map((to) => [from, to] as [ManualState, ManualState]));
}
