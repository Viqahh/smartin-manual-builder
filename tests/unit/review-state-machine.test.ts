/**
 * Phase 6 slice 1 — workflow state machine (AC-P6-2).
 * Every legal edge succeeds; every illegal edge throws a typed WorkflowError.
 */

import { describe, it, expect } from "vitest";
import {
  MANUAL_STATES,
  TRANSITIONS,
  canTransition,
  assertTransition,
  isContentEditable,
  isManualState,
  legalEdges,
  WorkflowError,
  type ManualState,
} from "@/lib/reviews/state-machine";

const LEGAL: [ManualState, ManualState][] = [
  ["DRAFT", "TECHNICAL_REVIEW"],
  ["TECHNICAL_REVIEW", "COMPLIANCE_REVIEW"],
  ["TECHNICAL_REVIEW", "CHANGES_REQUESTED"],
  ["COMPLIANCE_REVIEW", "APPROVED"],
  ["COMPLIANCE_REVIEW", "CHANGES_REQUESTED"],
  ["CHANGES_REQUESTED", "DRAFT"],
  ["APPROVED", "PUBLISHED"],
  ["PUBLISHED", "ARCHIVED"],
];

describe("legal transitions", () => {
  it.each(LEGAL)("%s → %s is allowed", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it("legalEdges() is exactly the 8 documented edges", () => {
    expect(legalEdges().sort()).toEqual([...LEGAL].sort());
  });

  it("ARCHIVED is terminal", () => {
    expect(TRANSITIONS.ARCHIVED).toEqual([]);
  });
});

describe("illegal transitions", () => {
  const ILLEGAL: [string, string][] = [
    ["DRAFT", "COMPLIANCE_REVIEW"],
    ["DRAFT", "APPROVED"],
    ["DRAFT", "PUBLISHED"],
    ["DRAFT", "CHANGES_REQUESTED"],
    ["DRAFT", "ARCHIVED"],
    ["TECHNICAL_REVIEW", "APPROVED"],
    ["TECHNICAL_REVIEW", "PUBLISHED"],
    ["TECHNICAL_REVIEW", "DRAFT"],
    ["COMPLIANCE_REVIEW", "TECHNICAL_REVIEW"],
    ["COMPLIANCE_REVIEW", "PUBLISHED"],
    ["CHANGES_REQUESTED", "TECHNICAL_REVIEW"],
    ["CHANGES_REQUESTED", "COMPLIANCE_REVIEW"],
    ["CHANGES_REQUESTED", "APPROVED"],
    ["APPROVED", "TECHNICAL_REVIEW"],
    ["APPROVED", "COMPLIANCE_REVIEW"],
    ["APPROVED", "CHANGES_REQUESTED"],
    ["APPROVED", "ARCHIVED"],
    ["PUBLISHED", "DRAFT"],
    ["PUBLISHED", "APPROVED"],
    ["ARCHIVED", "PUBLISHED"],
    ["ARCHIVED", "DRAFT"],
  ];

  it.each(ILLEGAL)("%s → %s is rejected", (from, to) => {
    expect(canTransition(from as ManualState, to as ManualState)).toBe(false);
    try {
      assertTransition(from, to);
      throw new Error("expected assertTransition to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowError);
      expect((e as WorkflowError).code).toBe("WORKFLOW");
    }
  });

  it("a no-op (from === to) is rejected for every state", () => {
    for (const s of MANUAL_STATES) {
      expect(() => assertTransition(s, s)).toThrow(WorkflowError);
    }
  });

  it("an unknown status string is rejected", () => {
    expect(() => assertTransition("BOGUS", "DRAFT")).toThrow(WorkflowError);
    expect(() => assertTransition("DRAFT", "SHIPPED")).toThrow(WorkflowError);
    expect(isManualState("BOGUS")).toBe(false);
  });
});

describe("content editability by state (§12)", () => {
  it("only DRAFT is content-editable", () => {
    for (const s of MANUAL_STATES) {
      expect(isContentEditable(s)).toBe(s === "DRAFT");
    }
  });
});
