import { z } from "zod";
import { blockPayloadSchema, BLOCK_TYPES } from "@/lib/domain/blocks";

export const createBlockSchema = z.object({
  sectionId: z.uuid(),
  blockType: z.enum(BLOCK_TYPES),
  payload: z.unknown(),
  position: z.number().int().min(0).optional(),
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

export const reorderBlocksSchema = z.object({
  sectionId: z.uuid(),
  orderedBlockIds: z.array(z.uuid()).min(1),
});
export type ReorderBlocksInput = z.infer<typeof reorderBlocksSchema>;

/** Re-export so actions validate the discriminated payload at the write boundary (AC-P2-15). */
export { blockPayloadSchema };
