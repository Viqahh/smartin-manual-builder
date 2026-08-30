import type { ManualStatusDb } from "@/lib/supabase/database.types";

export type ReviewQueueType = "technical" | "compliance";

/**
 * Stage-specific queue contract (AC-P6-3). Each queue shows EXACTLY ONE workflow status — never a
 * union of both review states. `ADMIN` bypasses the assignment filter but NOT this status filter.
 * Single source of truth; `tests/unit/review-queue-contract.test.ts` pins it so it cannot drift.
 */
export const REVIEW_QUEUE_STATUS: Record<ReviewQueueType, ManualStatusDb> = {
  technical: "TECHNICAL_REVIEW",
  compliance: "COMPLIANCE_REVIEW",
};

export const REVIEW_QUEUE_ASSIGNMENT_COL: Record<
  ReviewQueueType,
  "technical_reviewer_id" | "compliance_reviewer_id"
> = {
  technical: "technical_reviewer_id",
  compliance: "compliance_reviewer_id",
};
