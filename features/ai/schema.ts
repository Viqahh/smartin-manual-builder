import { z } from "zod";
import { REVISION_OPERATIONS } from "@/lib/ai/types";

/** A revision request from the builder. The server re-derives EVERY fact from the DB. */
export const requestAiRevisionSchema = z.object({
  manualId: z.uuid(),
  sectionId: z.uuid(),
  /** null for a not-yet-persisted block */
  blockId: z.uuid().nullable(),
  blockType: z.enum(["text", "steps", "image", "callout", "faq"]),
  targetField: z.enum(["content", "answer", "question", "caption", "steps"]),
  operation: z.enum(REVISION_OPERATIONS),
  /** The developer's selected/current text for the target field. */
  selectedText: z.string().max(20000),
  locale: z.string().min(2).max(10).default("id"),
});
export type RequestAiRevisionInput = z.infer<typeof requestAiRevisionSchema>;

export const resolveAiRevisionSchema = z.object({
  revisionId: z.uuid(),
  decision: z.enum(["ACCEPTED", "REJECTED"]),
  /** hash of the block payload the developer applied the proposal against (stale-target guard) */
  appliedAgainstHash: z.string().min(8).max(128).optional(),
  appliedRowVersion: z.number().int().nonnegative().optional(),
});
export type ResolveAiRevisionInput = z.infer<typeof resolveAiRevisionSchema>;

export const scanManualClaimsSchema = z.object({
  manualId: z.uuid(),
});
export type ScanManualClaimsInput = z.infer<typeof scanManualClaimsSchema>;
