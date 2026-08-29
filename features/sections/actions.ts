"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapPostgrestError } from "@/lib/supabase/errors";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
import { nextPosition, validateReorder } from "@/lib/domain/positions";
import { writeAudit } from "@/features/audit/write";
import {
  addCustomSectionSchema,
  renameSectionSchema,
  reorderSectionsSchema,
  sectionIdSchema,
} from "./schema";

/**
 * Chapter (manual_sections) management for the Phase 3 editor (AC-P3-6 / AC-P3-5).
 * Authoring is gated on `manual:update` + role-aware RLS; the DB additionally enforces:
 *   - a required non-custom section cannot be deleted (app.guard_required_section_delete)
 *   - a non-custom section cannot be renamed (app.guard_section_title_immutable)
 *   - reorder is transactional (public.reorder_manual_sections)
 */

function authFail(e: unknown): ActionResult<never> | null {
  if (e instanceof AuthError) return fail(e.code, e.message);
  if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
  return null;
}

async function sectionRow(sectionId: string, orgId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("manual_sections")
    .select("id, organization_id, manual_version_id, is_custom, required")
    .eq("id", sectionId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return { supabase, data };
}

export async function addCustomSection(
  input: unknown,
): Promise<ActionResult<{ id: string; sectionKey: string; position: number }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");
    const parsed = addCustomSectionSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }

    const supabase = await createSupabaseServerClient();
    const { data: version } = await supabase
      .from("manual_versions")
      .select("id")
      .eq("id", parsed.data.manualVersionId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!version) return fail("NOT_FOUND", "Versi manual tidak ditemukan.");

    const { data: existing } = await supabase
      .from("manual_sections")
      .select("position")
      .eq("organization_id", orgId)
      .eq("manual_version_id", parsed.data.manualVersionId);
    const position = nextPosition((existing ?? []).map((r) => Number(r.position)));
    const sectionKey = `custom-${crypto.randomUUID().slice(0, 8)}`;

    const { data, error } = await supabase
      .from("manual_sections")
      .insert({
        organization_id: orgId,
        manual_version_id: parsed.data.manualVersionId,
        section_key: sectionKey,
        title: parsed.data.title,
        required: false,
        is_custom: true,
        position,
      })
      .select("id, position")
      .single();
    if (error) return mapPostgrestError(error);

    await writeAudit(orgId, userId, "manual:update", "manual_section", data.id as string, { op: "add_custom_section" });
    return ok({ id: data.id as string, sectionKey, position: Number(data.position) });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menambah bab.");
  }
}

export async function renameSection(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");
    const parsed = renameSectionSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const { supabase, data: row } = await sectionRow(parsed.data.sectionId, orgId);
    if (!row) return fail("NOT_FOUND", "Bab tidak ditemukan.");
    if (!row.is_custom) return fail("FORBIDDEN", "Judul bab bawaan tidak dapat diubah.");

    const { error } = await supabase
      .from("manual_sections")
      .update({ title: parsed.data.title })
      .eq("organization_id", orgId)
      .eq("id", parsed.data.sectionId);
    if (error) return mapPostgrestError(error);
    await writeAudit(orgId, userId, "manual:update", "manual_section", parsed.data.sectionId, { op: "rename_section" });
    return ok({ id: parsed.data.sectionId });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal mengubah judul bab.");
  }
}

export async function deleteCustomSection(
  input: unknown,
): Promise<ActionResult<{ id: string; sections: { id: string; position: number; rowVersion: number }[] }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");
    const parsed = sectionIdSchema.safeParse(input);
    if (!parsed.success)
      return validationFail([{ path: "sectionId", message: "ID bab tidak valid." }]);
    const { supabase, data: row } = await sectionRow(parsed.data.sectionId, orgId);
    if (!row) return fail("NOT_FOUND", "Bab tidak ditemukan.");
    if (!row.is_custom) return fail("FORBIDDEN", "Bab bawaan tidak dapat dihapus.");

    // Delete + contiguous re-pack in ONE atomic RPC (AC-P3-5). The function re-checks the
    // author gate + custom/required, deletes the section, renumbers survivors to 0..n-1
    // preserving order, and returns the surviving sections.
    const { data: survivors, error } = await supabase.rpc("delete_custom_manual_section", {
      p_section_id: parsed.data.sectionId,
    });
    if (error) return mapPostgrestError(error);

    await writeAudit(orgId, userId, "manual:update", "manual_section", parsed.data.sectionId, {
      op: "delete_custom_section",
    });

    return ok({
      id: parsed.data.sectionId,
      sections: ((survivors ?? []) as { id: string; position: number | string; row_version: number | string }[]).map(
        (r) => ({
          id: r.id,
          position: Number(r.position ?? 0),
          rowVersion: Number(r.row_version ?? 1),
        }),
      ),
    });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menghapus bab.");
  }
}

export async function reorderSections(input: unknown): Promise<ActionResult<{ count: number }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");
    const parsed = reorderSectionsSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }

    const supabase = await createSupabaseServerClient();
    const { data: live } = await supabase
      .from("manual_sections")
      .select("id")
      .eq("organization_id", orgId)
      .eq("manual_version_id", parsed.data.manualVersionId);
    const currentIds = (live ?? []).map((r) => r.id as string);
    if (currentIds.length === 0) return fail("NOT_FOUND", "Versi manual tidak ditemukan.");
    const check = validateReorder(currentIds, parsed.data.orderedSectionIds);
    if (!check.ok) {
      return validationFail([{ path: "orderedSectionIds", message: "Daftar urutan tidak cocok dengan bab yang ada." }]);
    }

    const { error } = await supabase.rpc("reorder_manual_sections", {
      p_manual_version_id: parsed.data.manualVersionId,
      p_ordered_ids: parsed.data.orderedSectionIds,
    });
    if (error) return mapPostgrestError(error);
    await writeAudit(orgId, userId, "manual:update", "manual_version", parsed.data.manualVersionId, { op: "reorder_sections" });
    return ok({ count: parsed.data.orderedSectionIds.length });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal mengatur ulang bab.");
  }
}

/** Read-only: current row_version of every section in a manual version (chapter-op resync). */
export async function getSectionRowVersions(
  input: unknown,
): Promise<ActionResult<{ sections: { id: string; rowVersion: number; position: number }[] }>> {
  try {
    const { orgId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:read");
    const parsed = z.object({ manualVersionId: z.uuid() }).safeParse(input);
    if (!parsed.success) return validationFail([{ path: "manualVersionId", message: "ID versi manual tidak valid." }]);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("manual_sections")
      .select("id, row_version, position")
      .eq("organization_id", orgId)
      .eq("manual_version_id", parsed.data.manualVersionId)
      .order("position");
    if (error) return mapPostgrestError(error);
    return ok({
      sections: (data ?? []).map((r) => ({
        id: r.id as string,
        rowVersion: Number(r.row_version ?? 1),
        position: Number(r.position ?? 0),
      })),
    });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal memuat versi bab.");
  }
}
