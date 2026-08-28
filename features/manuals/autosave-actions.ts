"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, type ActionResult } from "@/lib/errors";
import { z } from "zod";

const saveSectionSchema = z.object({
  sectionId: z.uuid(),
  expectedRowVersion: z.number().int().min(1),
  patch: z
    .object({
      title: z.string().trim().min(1).max(300).optional(),
      completionState: z.enum(["incomplete", "in_progress", "complete", "issue"]).optional(),
    })
    .refine((p) => Object.keys(p).length > 0, "Tidak ada perubahan."),
});

export type AutosaveResult = ActionResult<{ rowVersion: number; updatedAt: string }>;

/**
 * Optimistic-concurrency section save (PRD-MAN-012, AC-P2-20). The UPDATE is guarded by
 * `row_version = expectedRowVersion`; 0 rows affected => a newer write already landed =>
 * CONFLICT, never a silent overwrite.
 */
export async function saveSection(input: unknown): Promise<AutosaveResult> {
  try {
    const { orgId, role } = await requireActiveOrg();
    assertCan(role, "manual:update");

    const parsed = saveSectionSchema.safeParse(input);
    if (!parsed.success) {
      return fail(
        "VALIDATION",
        "Perubahan tidak valid.",
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }

    const supabase = await createSupabaseServerClient();
    const patch: Record<string, unknown> = {};
    if (parsed.data.patch.title !== undefined) patch.title = parsed.data.patch.title;
    if (parsed.data.patch.completionState !== undefined) patch.completion_state = parsed.data.patch.completionState;

    const { data, error } = await supabase
      .from("manual_sections")
      .update(patch)
      .eq("organization_id", orgId)
      .eq("id", parsed.data.sectionId)
      .eq("row_version", parsed.data.expectedRowVersion)
      .select("row_version, updated_at")
      .maybeSingle();

    if (error) return fail("INTERNAL", "Gagal menyimpan.");
    if (!data) {
      // Either the row moved on or it does not exist — surface the current version if we can.
      const { data: current } = await supabase
        .from("manual_sections")
        .select("row_version")
        .eq("organization_id", orgId)
        .eq("id", parsed.data.sectionId)
        .maybeSingle();
      return current
        ? fail("CONFLICT", "Konflik perubahan — muat ulang untuk melihat versi terbaru.")
        : fail("NOT_FOUND", "Bab tidak ditemukan.");
    }

    return ok({ rowVersion: Number(data.row_version), updatedAt: data.updated_at as string });
  } catch (e) {
    if (e instanceof AuthError) return fail(e.code, e.message);
    if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
    return fail("INTERNAL", "Gagal menyimpan.");
  }
}
