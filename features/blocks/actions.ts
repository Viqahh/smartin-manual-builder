"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapPostgrestError } from "@/lib/supabase/errors";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
import { nextPosition, validateReorder } from "@/lib/domain/positions";
import { parseBlockPayload } from "@/lib/domain/blocks";
import { writeAudit } from "@/features/audit/write";
import {
  blockIdSchema,
  createBlockSchema,
  reorderBlocksSchema,
  updateBlockSchema,
} from "./schema";

/**
 * Backend block CRUD (AC-P2-15/16/17). Data + validation only — NOT the Phase 3 visual editor.
 * Every payload passes `blockPayloadSchema` at the write boundary; org ownership is enforced by
 * `manual:update` + RLS; positions stay non-negative and unique among live blocks; multi-block
 * reorder is transactional via `public.reorder_manual_blocks`.
 */

function authFail(e: unknown): ActionResult<never> | null {
  if (e instanceof AuthError) return fail(e.code, e.message);
  if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
  return null;
}

function groupIdsFor(blockType: string, payload: unknown): string[] {
  const g = (payload as { groupIds?: unknown }).groupIds;
  return blockType === "parameterTable" && Array.isArray(g) ? (g as string[]) : [];
}

async function sectionOrgOrNull(sectionId: string, orgId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("manual_sections")
    .select("id, organization_id")
    .eq("id", sectionId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return data ? supabase : null;
}

export async function createBlock(input: unknown): Promise<ActionResult<{ id: string; position: number }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");

    const parsed = createBlockSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const payloadCheck = parseBlockPayload(parsed.data.payload);
    if (!payloadCheck.ok) {
      return validationFail(payloadCheck.issues.map((i) => ({ path: `payload.${i.path}`, message: i.message })));
    }
    if (payloadCheck.value.type !== parsed.data.blockType) {
      return validationFail([{ path: "blockType", message: "Tipe blok tidak cocok dengan payload." }]);
    }

    const supabase = await sectionOrgOrNull(parsed.data.sectionId, orgId);
    if (!supabase) return fail("NOT_FOUND", "Bab tidak ditemukan.");

    const { data: live } = await supabase
      .from("manual_blocks")
      .select("position")
      .eq("manual_section_id", parsed.data.sectionId)
      .is("deleted_at", null);
    const position =
      parsed.data.position ?? nextPosition((live ?? []).map((r) => Number(r.position)));

    const { data, error } = await supabase
      .from("manual_blocks")
      .insert({
        organization_id: orgId,
        manual_section_id: parsed.data.sectionId,
        block_type: parsed.data.blockType,
        payload: payloadCheck.value,
        position,
        image_asset_id: payloadCheck.value.type === "image" ? payloadCheck.value.imageAssetId : null,
        parameter_group_ids: groupIdsFor(parsed.data.blockType, payloadCheck.value),
      })
      .select("id, position")
      .single();
    if (error) return mapPostgrestError(error);

    await writeAudit(orgId, userId, "manual:update", "manual_block", data.id as string, { op: "create" });
    return ok({ id: data.id as string, position: Number(data.position) });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menambah blok.");
  }
}

export async function updateBlock(input: unknown): Promise<ActionResult<{ rowVersion: number }>> {
  try {
    const { orgId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");

    const parsed = updateBlockSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const payloadCheck = parseBlockPayload(parsed.data.payload);
    if (!payloadCheck.ok) {
      return validationFail(payloadCheck.issues.map((i) => ({ path: `payload.${i.path}`, message: i.message })));
    }
    const blockType = parsed.data.blockType ?? payloadCheck.value.type;
    if (payloadCheck.value.type !== blockType) {
      return validationFail([{ path: "blockType", message: "Tipe blok tidak cocok dengan payload." }]);
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("manual_blocks")
      .update({
        block_type: blockType,
        payload: payloadCheck.value,
        image_asset_id: payloadCheck.value.type === "image" ? payloadCheck.value.imageAssetId : null,
        parameter_group_ids: groupIdsFor(blockType, payloadCheck.value),
      })
      .eq("organization_id", orgId)
      .eq("id", parsed.data.blockId)
      .eq("row_version", parsed.data.expectedRowVersion)
      .is("deleted_at", null)
      .select("row_version")
      .maybeSingle();
    if (error) return mapPostgrestError(error);
    if (!data) {
      const { data: current } = await supabase
        .from("manual_blocks")
        .select("row_version")
        .eq("organization_id", orgId)
        .eq("id", parsed.data.blockId)
        .maybeSingle();
      return current
        ? fail("CONFLICT", "Konflik perubahan — muat ulang blok.")
        : fail("NOT_FOUND", "Blok tidak ditemukan.");
    }
    return ok({ rowVersion: Number(data.row_version) });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menyimpan blok.");
  }
}

export async function softDeleteBlock(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");
    const parsed = blockIdSchema.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "blockId", message: "ID blok tidak valid." }]);

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("manual_blocks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("id", parsed.data.blockId)
      .is("deleted_at", null);
    if (error) return mapPostgrestError(error);
    await writeAudit(orgId, userId, "manual:update", "manual_block", parsed.data.blockId, { op: "soft_delete" });
    return ok({ id: parsed.data.blockId });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menghapus blok.");
  }
}

export async function restoreBlock(input: unknown): Promise<ActionResult<{ id: string; position: number }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");
    const parsed = blockIdSchema.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "blockId", message: "ID blok tidak valid." }]);

    const supabase = await createSupabaseServerClient();
    const { data: block } = await supabase
      .from("manual_blocks")
      .select("id, manual_section_id, deleted_at")
      .eq("organization_id", orgId)
      .eq("id", parsed.data.blockId)
      .maybeSingle();
    if (!block) return fail("NOT_FOUND", "Blok tidak ditemukan.");
    if (block.deleted_at == null) return ok({ id: parsed.data.blockId, position: -1 });

    const { data: live } = await supabase
      .from("manual_blocks")
      .select("position")
      .eq("manual_section_id", block.manual_section_id)
      .is("deleted_at", null);
    const position = nextPosition((live ?? []).map((r) => Number(r.position)));

    const { error } = await supabase
      .from("manual_blocks")
      .update({ deleted_at: null, position })
      .eq("organization_id", orgId)
      .eq("id", parsed.data.blockId);
    if (error) return mapPostgrestError(error);
    await writeAudit(orgId, userId, "manual:update", "manual_block", parsed.data.blockId, { op: "restore" });
    return ok({ id: parsed.data.blockId, position });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal memulihkan blok.");
  }
}

export async function reorderBlocks(input: unknown): Promise<ActionResult<{ count: number }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");
    const parsed = reorderBlocksSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }

    const supabase = await createSupabaseServerClient();
    const { data: live } = await supabase
      .from("manual_blocks")
      .select("id")
      .eq("organization_id", orgId)
      .eq("manual_section_id", parsed.data.sectionId)
      .is("deleted_at", null);
    const currentIds = (live ?? []).map((r) => r.id as string);
    const check = validateReorder(currentIds, parsed.data.orderedBlockIds);
    if (!check.ok) {
      return validationFail([{ path: "orderedBlockIds", message: "Daftar urutan tidak cocok dengan blok yang ada." }]);
    }

    const { error } = await supabase.rpc("reorder_manual_blocks", {
      p_section_id: parsed.data.sectionId,
      p_ordered_ids: parsed.data.orderedBlockIds,
    });
    if (error) return mapPostgrestError(error);
    await writeAudit(orgId, userId, "manual:update", "manual_section", parsed.data.sectionId, { op: "reorder_blocks" });
    return ok({ count: parsed.data.orderedBlockIds.length });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal mengatur ulang blok.");
  }
}
