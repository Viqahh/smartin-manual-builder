import { z } from "zod";

export const CHANGELOG_TYPES = ["ADDED", "CHANGED", "FIXED", "BREAKING"] as const;
export type ChangelogType = (typeof CHANGELOG_TYPES)[number];

export const CHANGELOG_TYPE_LABEL: Record<ChangelogType, string> = {
  ADDED: "Ditambahkan",
  CHANGED: "Diubah",
  FIXED: "Diperbaiki",
  BREAKING: "Perubahan besar",
};

/**
 * A structured changelog entry, validated the same way the DB (`20260901001600`) enforces:
 * body 1..4000 chars, and a BREAKING entry must describe the open-position impact.
 */
export const changelogEntrySchema = z
  .object({
    entryType: z.enum(CHANGELOG_TYPES),
    body: z.string().trim().min(1, "Uraikan perubahannya.").max(4000),
    // PRD-VER-006: every structured entry records the EA version the change came from (mandatory
    // since 20260901001700). The DB also enforces same-org + same-product-lineage.
    sourceEaVersionId: z.uuid({ error: "Pilih versi EA sumber." }),
    isFeatureChange: z.boolean().default(false),
    openPositionImpact: z
      .string()
      .trim()
      .max(4000)
      .transform((v) => (v.length === 0 ? null : v))
      .nullable()
      .default(null),
  })
  .refine((v) => v.entryType !== "BREAKING" || (v.openPositionImpact?.length ?? 0) > 0, {
    path: ["openPositionImpact"],
    message: "Entri BREAKING wajib menjelaskan dampak bagi pengguna dengan posisi terbuka.",
  });

export type ChangelogEntryInput = z.infer<typeof changelogEntrySchema>;
