import { z } from "zod";
import { SEMVER_PATTERN } from "@/lib/domain/semver";
import { eaVersionCreateSchema } from "@/features/ea-versions/schema";
import { eaProductCreateSchema } from "@/features/ea-products/schema";

/** Wizard — existing-EA path (PRD-MAN-004, AC-P2-10). */
export const createManualExistingSchema = z.object({
  mode: z.literal("existing"),
  eaProductId: z.uuid(),
  eaVersionId: z.uuid(),
  manualVersion: z.string().trim().regex(SEMVER_PATTERN, "Gunakan format semver, contoh 1.0.0."),
  locale: z.string().trim().default("id"),
});

/** Wizard — new-EA path (PRD-MAN-004 / PRD-EA-001, AC-P2-11). Atomic. */
export const createManualNewSchema = z.object({
  mode: z.literal("new"),
  product: eaProductCreateSchema,
  version: eaVersionCreateSchema.omit({ eaProductId: true }),
  manualVersion: z.string().trim().regex(SEMVER_PATTERN, "Gunakan format semver, contoh 1.0.0."),
  locale: z.string().trim().default("id"),
});

export const createManualSchema = z.discriminatedUnion("mode", [
  createManualExistingSchema,
  createManualNewSchema,
]);
export type CreateManualInput = z.infer<typeof createManualSchema>;
