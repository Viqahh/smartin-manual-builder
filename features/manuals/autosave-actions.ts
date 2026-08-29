"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, type ActionResult } from "@/lib/errors";
import {
  sectionCompletionBlockers,
  eaDeclaresDangerMode,
  type CompletionBlock,
} from "@/lib/domain/section-completion";
import type { BlockType } from "@/lib/domain/blocks";
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
    const { orgId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");

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

    // AC-P3-9 / AC-P3-11 — refuse "complete" while a chapter-completion blocker holds.
    if (parsed.data.patch.completionState === "complete") {
      const { data: sec } = await supabase
        .from("manual_sections")
        .select("section_key, manual_version_id, manual_blocks(block_type, payload, image_asset_id, deleted_at)")
        .eq("organization_id", orgId)
        .eq("id", parsed.data.sectionId)
        .maybeSingle();
      if (sec) {
        const rawBlocks = ((sec.manual_blocks as Record<string, unknown>[]) ?? []).filter((b) => b.deleted_at == null);
        const blocks: CompletionBlock[] = rawBlocks.map((b) => ({
          type: b.block_type as BlockType,
          payload: (b.payload as Record<string, unknown>) ?? {},
          imageAssetId: (b.image_asset_id as string | null) ?? null,
        }));
        const assetIds = blocks.map((b) => b.imageAssetId).filter((x): x is string => Boolean(x));
        const imageAltText: Record<string, string | null> = {};
        if (assetIds.length) {
          const { data: assets } = await supabase
            .from("image_assets")
            .select("id, alt_text")
            .eq("organization_id", orgId)
            .in("id", assetIds);
          for (const a of assets ?? []) imageAltText[a.id as string] = (a.alt_text as string | null) ?? null;
        }
        const { data: mv } = await supabase
          .from("manual_versions")
          .select("ea_versions(requirements)")
          .eq("organization_id", orgId)
          .eq("id", sec.manual_version_id as string)
          .maybeSingle();
        const requirements =
          ((mv?.ea_versions as { requirements?: Record<string, unknown> } | null)?.requirements) ?? null;

        const blockers = sectionCompletionBlockers({
          sectionKey: sec.section_key as string,
          blocks,
          imageAltText,
          eaDangerMode: eaDeclaresDangerMode(requirements),
        });
        if (blockers.length) {
          return fail(
            "VALIDATION",
            blockers[0],
            blockers.map((b) => ({ path: "completionState", message: b })),
          );
        }
      }
    }

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
