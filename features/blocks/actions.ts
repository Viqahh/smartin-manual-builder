"use server";

import { revalidatePath } from "next/cache";
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
  sectionBlocksSchema,
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

type Sb = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Resolve the owning `manuals.id` for a section or block, so a write can revalidate the
 *  dependent `/edit` and `/preview` routes (Phase 8A.5 — Preview consistency). Best-effort. */
async function manualIdFor(
  supabase: Sb,
  orgId: string,
  ref: { sectionId?: string; blockId?: string },
): Promise<string | null> {
  let sectionId = ref.sectionId ?? null;
  if (!sectionId && ref.blockId) {
    const { data } = await supabase
      .from("manual_blocks")
      .select("manual_section_id")
      .eq("organization_id", orgId)
      .eq("id", ref.blockId)
      .maybeSingle();
    sectionId = (data?.manual_section_id as string | undefined) ?? null;
  }
  if (!sectionId) return null;
  const { data: sec } = await supabase
    .from("manual_sections")
    .select("manual_version_id")
    .eq("organization_id", orgId)
    .eq("id", sectionId)
    .maybeSingle();
  const versionId = sec?.manual_version_id as string | undefined;
  if (!versionId) return null;
  const { data: ver } = await supabase
    .from("manual_versions")
    .select("manual_id")
    .eq("organization_id", orgId)
    .eq("id", versionId)
    .maybeSingle();
  return (ver?.manual_id as string | undefined) ?? null;
}

/** Mark the manual's editor + preview routes stale so Preview never needs a hard refresh. */
function revalidateManual(manualId: string | null): void {
  if (!manualId) return;
  revalidatePath(`/manuals/${manualId}/edit`);
  revalidatePath(`/manuals/${manualId}/preview`);
}

/** The one live block backing (section, client_token), or null. */
async function liveBlockByToken(
  supabase: Sb,
  orgId: string,
  sectionId: string,
  clientToken: string,
): Promise<{ id: string; position: number; rowVersion: number } | null> {
  const { data } = await supabase
    .from("manual_blocks")
    .select("id, position, row_version")
    .eq("organization_id", orgId)
    .eq("manual_section_id", sectionId)
    .eq("client_token", clientToken)
    .is("deleted_at", null)
    .maybeSingle();
  return data
    ? { id: data.id as string, position: Number(data.position), rowVersion: Number(data.row_version ?? 1) }
    : null;
}

export async function createBlock(
  input: unknown,
): Promise<ActionResult<{ id: string; position: number; rowVersion: number }>> {
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

    const clientToken = parsed.data.clientToken ?? null;

    // Phase 8A.5 — at-most-once. A retry / coalesced re-save for the same logical draft block
    // reconciles to the row it already created instead of inserting another. The partial unique
    // index (manual_section_id, client_token) WHERE client_token IS NOT NULL AND deleted_at IS
    // NULL is the concurrency backstop; this pre-check is the common (non-racing) fast path.
    const existingByToken = clientToken ? await liveBlockByToken(supabase, orgId, parsed.data.sectionId, clientToken) : null;
    if (existingByToken) {
      revalidateManual(await manualIdFor(supabase, orgId, { sectionId: parsed.data.sectionId }));
      return ok(existingByToken);
    }

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
        client_token: clientToken,
        image_asset_id: payloadCheck.value.type === "image" ? payloadCheck.value.imageAssetId : null,
        parameter_group_ids: groupIdsFor(parsed.data.blockType, payloadCheck.value),
      })
      .select("id, position, row_version")
      .single();
    if (error) {
      // 23505 on the client_token index == a concurrent create for the SAME logical block won
      // the race. Reconcile to that row rather than surfacing a conflict or double-inserting.
      if (error.code === "23505" && clientToken) {
        const raced = await liveBlockByToken(supabase, orgId, parsed.data.sectionId, clientToken);
        if (raced) {
          revalidateManual(await manualIdFor(supabase, orgId, { sectionId: parsed.data.sectionId }));
          return ok(raced);
        }
      }
      return mapPostgrestError(error);
    }

    await writeAudit(orgId, userId, "manual:update", "manual_block", data.id as string, { op: "create" });
    revalidateManual(await manualIdFor(supabase, orgId, { sectionId: parsed.data.sectionId }));
    return ok({
      id: data.id as string,
      position: Number(data.position),
      rowVersion: Number(data.row_version ?? 1),
    });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menambah blok.");
  }
}

/** Read-only: current row_version + payload of one block (conflict classification). */
export async function getBlockState(
  input: unknown,
): Promise<ActionResult<{ exists: boolean; rowVersion: number; payload: unknown }>> {
  try {
    const { orgId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:read");
    const parsed = blockIdSchema.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "blockId", message: "ID blok tidak valid." }]);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("manual_blocks")
      .select("row_version, payload, deleted_at")
      .eq("organization_id", orgId)
      .eq("id", parsed.data.blockId)
      .maybeSingle();
    if (error) return mapPostgrestError(error);
    if (!data || data.deleted_at != null) return ok({ exists: false, rowVersion: 0, payload: null });
    return ok({ exists: true, rowVersion: Number(data.row_version ?? 1), payload: data.payload });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal memuat status blok.");
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
    revalidateManual(await manualIdFor(supabase, orgId, { blockId: parsed.data.blockId }));
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
    revalidateManual(await manualIdFor(supabase, orgId, { blockId: parsed.data.blockId }));
    return ok({ id: parsed.data.blockId });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menghapus blok.");
  }
}

export async function restoreBlock(
  input: unknown,
): Promise<ActionResult<{ id: string; position: number; rowVersion: number }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");
    const parsed = blockIdSchema.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "blockId", message: "ID blok tidak valid." }]);

    const supabase = await createSupabaseServerClient();
    const { data: block } = await supabase
      .from("manual_blocks")
      .select("id, manual_section_id, deleted_at, row_version")
      .eq("organization_id", orgId)
      .eq("id", parsed.data.blockId)
      .maybeSingle();
    if (!block) return fail("NOT_FOUND", "Blok tidak ditemukan.");
    if (block.deleted_at == null) {
      return ok({ id: parsed.data.blockId, position: -1, rowVersion: Number(block.row_version ?? 1) });
    }

    const { data: live } = await supabase
      .from("manual_blocks")
      .select("position")
      .eq("manual_section_id", block.manual_section_id)
      .is("deleted_at", null);
    const position = nextPosition((live ?? []).map((r) => Number(r.position)));

    const { data: updated, error } = await supabase
      .from("manual_blocks")
      .update({ deleted_at: null, position })
      .eq("organization_id", orgId)
      .eq("id", parsed.data.blockId)
      .select("row_version")
      .single();
    if (error) return mapPostgrestError(error);
    await writeAudit(orgId, userId, "manual:update", "manual_block", parsed.data.blockId, { op: "restore" });
    return ok({ id: parsed.data.blockId, position, rowVersion: Number(updated.row_version ?? 1) });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal memulihkan blok.");
  }
}

/** Read-only: current row_version + position of every live block in a section (undo/redo resync). */
export async function getBlockRowVersions(
  input: unknown,
): Promise<ActionResult<{ blocks: { id: string; rowVersion: number; position: number }[] }>> {
  try {
    const { orgId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:read");
    const parsed = sectionBlocksSchema.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "sectionId", message: "ID bab tidak valid." }]);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("manual_blocks")
      .select("id, row_version, position")
      .eq("organization_id", orgId)
      .eq("manual_section_id", parsed.data.sectionId)
      .is("deleted_at", null)
      .order("position");
    if (error) return mapPostgrestError(error);
    return ok({
      blocks: (data ?? []).map((r) => ({
        id: r.id as string,
        rowVersion: Number(r.row_version ?? 1),
        position: Number(r.position ?? 0),
      })),
    });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal memuat versi blok.");
  }
}

export async function duplicateBlock(
  input: unknown,
): Promise<ActionResult<{ id: string; position: number }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");
    const parsed = blockIdSchema.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "blockId", message: "ID blok tidak valid." }]);

    const supabase = await createSupabaseServerClient();
    const { data: src } = await supabase
      .from("manual_blocks")
      .select("id, manual_section_id, block_type, payload, position, image_asset_id, parameter_group_ids")
      .eq("organization_id", orgId)
      .eq("id", parsed.data.blockId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!src) return fail("NOT_FOUND", "Blok tidak ditemukan.");

    // Re-validate the copied payload at the write boundary — a duplicate is still a write.
    const payloadCheck = parseBlockPayload(src.payload);
    if (!payloadCheck.ok) return fail("VALIDATION", "Blok sumber tidak valid untuk digandakan.");

    const { data: live } = await supabase
      .from("manual_blocks")
      .select("id, position")
      .eq("manual_section_id", src.manual_section_id as string)
      .is("deleted_at", null)
      .order("position");
    const liveIds = (live ?? []).map((r) => r.id as string);
    const insertPos = nextPosition((live ?? []).map((r) => Number(r.position)));

    const { data: copy, error } = await supabase
      .from("manual_blocks")
      .insert({
        organization_id: orgId,
        manual_section_id: src.manual_section_id,
        block_type: src.block_type,
        payload: payloadCheck.value, // deep copy of ALLOWED payload only
        position: insertPos,
        image_asset_id: src.image_asset_id, // same asset — no binary duplicated
        parameter_group_ids: src.parameter_group_ids ?? [], // same EA-Version group refs
      })
      .select("id")
      .single();
    if (error) return mapPostgrestError(error);

    // Place the copy immediately after the source; keep positions contiguous.
    const srcIdx = liveIds.indexOf(parsed.data.blockId);
    const ordered = liveIds.slice();
    ordered.splice(srcIdx + 1, 0, copy.id as string);
    const { error: reErr } = await supabase.rpc("reorder_manual_blocks", {
      p_section_id: src.manual_section_id,
      p_ordered_ids: ordered,
    });
    if (reErr) return mapPostgrestError(reErr);

    await writeAudit(orgId, userId, "manual:update", "manual_block", copy.id as string, {
      op: "duplicate",
      from: parsed.data.blockId,
    });
    return ok({ id: copy.id as string, position: srcIdx + 1 });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menggandakan blok.");
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
