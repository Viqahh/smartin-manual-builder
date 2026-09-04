import { z } from "zod";
import { blockPayloadSchema, BLOCK_TYPES } from "@/lib/domain/blocks";

export const createBlockSchema = z.object({
  sectionId: z.uuid(),
  blockType: z.enum(BLOCK_TYPES),
  payload: z.unknown(),
  position: z.number().int().min(0).optional(),
  /**
   * Phase 8A.5 — stable client identity of one logical draft block. Generated once when the
   * draft is created and resent on every create retry, so a duplicate create for the same
   * logical block reconciles to the same row instead of inserting another. Never derived from
   * content. Optional: server-side inserts (clone/duplicate/tests) may omit it.
   */
  clientToken: z.uuid().optional(),
});
export type CreateBlockInput = z.infer<typeof createBlockSchema>;

export const updateBlockSchema = z.object({
  blockId: z.uuid(),
  expectedRowVersion: z.number().int().min(1),
  blockType: z.enum(BLOCK_TYPES).optional(),
  payload: z.unknown(),
});
export type UpdateBlockInput = z.infer<typeof updateBlockSchema>;

export const blockIdSchema = z.object({ blockId: z.uuid() });

export const sectionBlocksSchema = z.object({ sectionId: z.uuid() });

export const reorderBlocksSchema = z.object({
  sectionId: z.uuid(),
  orderedBlockIds: z.array(z.uuid()).min(1),
});
export type ReorderBlocksInput = z.infer<typeof reorderBlocksSchema>;

/** Re-export so actions validate the discriminated payload at the write boundary (AC-P2-15). */
export { blockPayloadSchema };
