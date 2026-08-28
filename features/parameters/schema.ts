import { z } from "zod";
import { parameterInput, parameterGroupInput } from "@/lib/domain/parameters";

export const createGroupSchema = parameterGroupInput
  .omit({ position: true })
  .extend({ eaVersionId: z.uuid(), position: z.number().int().min(0).optional() });
export const updateGroupSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120).optional(),
});
export const reorderGroupsSchema = z.object({
  eaVersionId: z.uuid(),
  orderedIds: z.array(z.uuid()).min(1),
});
export const groupIdSchema = z.object({ id: z.uuid() });

export const createParameterSchema = parameterInput
  .omit({ position: true })
  .extend({ parameterGroupId: z.uuid(), position: z.number().int().min(0).optional() });
export const updateParameterSchema = parameterInput.partial().extend({ id: z.uuid() });
export const parameterIdSchema = z.object({ id: z.uuid() });
export const reorderParametersSchema = z.object({
  parameterGroupId: z.uuid(),
  orderedIds: z.array(z.uuid()).min(1),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type CreateParameterInput = z.infer<typeof createParameterSchema>;
