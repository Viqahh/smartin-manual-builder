import { z } from "zod";

export const eaProductCreateSchema = z.object({
  name: z.string().trim().min(2, "Masukkan nama produk (min. 2 karakter).").max(160),
  description: z.string().trim().max(2000).default(""),
});
export type EaProductCreateInput = z.infer<typeof eaProductCreateSchema>;

export const eaProductUpdateSchema = eaProductCreateSchema.partial().extend({
  id: z.uuid(),
});
export type EaProductUpdateInput = z.infer<typeof eaProductUpdateSchema>;
