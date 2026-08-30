import { describe, it, expect } from "vitest";
import {
  REVIEW_QUEUE_STATUS,
  REVIEW_QUEUE_ASSIGNMENT_COL,
} from "@/features/reviews/queue-contract";

/**
 * Pins the stage-specific queue contract (AC-P6-3, "FINAL QUEUE SEMANTICS CORRECTION"):
 * each queue type maps to EXACTLY ONE manual_versions.status — never a union of both review
 * states. If someone later broadens `listReviewQueue` back to `status IN (...)`, this fails.
 */
describe("review queue contract — queue type → required status", () => {
  it("technical → TECHNICAL_REVIEW only; compliance → COMPLIANCE_REVIEW only", () => {
    expect(REVIEW_QUEUE_STATUS.technical).toBe("TECHNICAL_REVIEW");
    expect(REVIEW_QUEUE_STATUS.compliance).toBe("COMPLIANCE_REVIEW");
  });

  it("has exactly the two queue types and no others", () => {
    expect(Object.keys(REVIEW_QUEUE_STATUS).sort()).toEqual(["compliance", "technical"]);
  });

  it("every mapped value is a single status string, not an array/union", () => {
    for (const v of Object.values(REVIEW_QUEUE_STATUS)) {
      expect(typeof v).toBe("string");
      expect(Array.isArray(v)).toBe(false);
      expect(v).not.toContain(",");
    }
  });

  it("the two queues never share a status", () => {
    expect(REVIEW_QUEUE_STATUS.technical).not.toBe(REVIEW_QUEUE_STATUS.compliance);
  });

  it("assignment column matches the queue type", () => {
    expect(REVIEW_QUEUE_ASSIGNMENT_COL.technical).toBe("technical_reviewer_id");
    expect(REVIEW_QUEUE_ASSIGNMENT_COL.compliance).toBe("compliance_reviewer_id");
  });
});
