import { z } from "zod";
import { parameterInput, parameterGroupInput } from "@/lib/domain/parameters";

export const createGroupSchema = parameterGroupInput.extend({ eaVersionId: z.uuid() });
export const updateGroupSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  position: z.number().int().min(0).optional(),
});
export const createParameterSchema = parameterInput.extend({ parameterGroupId: z.uuid() });
export const updateParameterSchema = parameterInput.partial().extend({ id: z.uuid() });

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type CreateParameterInput = z.infer<typeof createParameterSchema>;
