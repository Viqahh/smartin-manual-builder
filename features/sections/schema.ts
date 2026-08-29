import { z } from "zod";

export const addCustomSectionSchema = z.object({
  manualVersionId: z.uuid(),
  title: z.string().trim().min(2, "Judul bab minimal 2 karakter.").max(120),
});
export type AddCustomSectionInput = z.infer<typeof addCustomSectionSchema>;

export const renameSectionSchema = z.object({
  sectionId: z.uuid(),
  title: z.string().trim().min(2, "Judul bab minimal 2 karakter.").max(120),
});

export const sectionIdSchema = z.object({ sectionId: z.uuid() });

export const reorderSectionsSchema = z.object({
  manualVersionId: z.uuid(),
  orderedSectionIds: z.array(z.uuid()).min(1),
});
export type ReorderSectionsInput = z.infer<typeof reorderSectionsSchema>;
