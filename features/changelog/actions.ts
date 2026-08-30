"use server";

/**
 * Phase 6 slice 4 — structured changelog write path (PRD-VER-006/007, PRD-OQ-010).
 *
 * Four explicit server actions, each backed by an atomic SECURITY DEFINER RPC
 * (`20260901001600_phase6_changelog.sql`). No generic table CRUD is exposed. Every action
 * authenticates, checks `manual:update`, resolves the org from the target, and lets the RPC
 * re-check DRAFT status / entry type / body / BREAKING-impact / source-EA-version lineage under
 * one transaction. A changelog write records the actor as a Manual Version contributor (DB
 * trigger) and writes NO `audit_events` row.
 */

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
import { logServerError } from "@/lib/observability/request-id";
import { changelogEntrySchema } from "./schema";
import type { PostgrestError } from "@supabase/supabase-js";

const withManualVersion = z.object({ manualVersionId: z.uuid() });
const createSchema = withManualVersion.extend({ entry: changelogEntrySchema });
const updateSchema = z.object({ entryId: z.uuid(), entry: changelogEntrySchema });
const deleteSchema = z.object({ entryId: z.uuid() });
const reorderSchema = withManualVersion.extend({ orderedIds: z.array(z.uuid()).min(1) });

function authFail(e: unknown): ActionResult<never> | null {
  if (e instanceof AuthError) return fail(e.code, e.message);
  if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
  return null;
}

/** Map a raised changelog RPC error to a typed ActionResult (no SQL leak). */
function mapRpcError(error: PostgrestError | null, fallback: string): ActionResult<never> {
  const msg = (error?.message ?? "").toLowerCase();
  if (msg.includes("invalid source")) {
    return fail("VALIDATION", "Versi EA sumber harus milik organisasi ini dan produk EA yang sama.");
  }
  if (msg.includes("breaking entry must describe")) {
    return fail("VALIDATION", "Entri BREAKING wajib menjelaskan dampak bagi pengguna dengan posisi terbuka.");
  }
  if (msg.includes("must be 1..4000")) {
    return fail("VALIDATION", "Uraian perubahan harus 1–4000 karakter.");
  }
  if (msg.includes("editable only in draft") || msg.includes("editable only while the manual version is draft")) {
    return fail("WORKFLOW", "Changelog hanya dapat diubah saat manual berstatus DRAFT.");
  }
  if (msg.includes("not found")) return fail("NOT_FOUND", "Entri changelog tidak ditemukan.");
  if (msg.startsWith("forbidden:") || msg.includes("forbidden:")) return fail("FORBIDDEN", "Akses ditolak.");
  if (msg.includes("reorder list") || msg.includes("is not an entry of this manual version")) {
    return fail("VALIDATION", "Urutan changelog tidak valid.");
  }
  void logServerError("changelog", "unmapped rpc error", { code: error?.code });
  return fail("INTERNAL", fallback);
}

async function resolveOrg(): Promise<{ orgId: string; supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> }> {
  const { orgId } = await requireActiveOrg();
  const supabase = await createSupabaseServerClient();
  return { orgId, supabase };
}

export async function createChangelogEntry(
  input: unknown,
): Promise<ActionResult<{ id: string; position: number }>> {
  try {
    const { roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const { supabase } = await resolveOrg();
    const e = parsed.data.entry;
    const { data, error } = await supabase.rpc("create_changelog_entry", {
      p_manual_version_id: parsed.data.manualVersionId,
      p_entry_type: e.entryType,
      p_body: e.body,
      p_source_ea_version_id: e.sourceEaVersionId,
      p_is_feature_change: e.isFeatureChange,
      p_open_position_impact: e.openPositionImpact,
    });
    if (error) return mapRpcError(error, "Gagal menambah entri changelog.");
    const row = (data as { id?: string; position?: number } | null) ?? {};
    return ok({ id: row.id ?? "", position: row.position ?? 0 });
  } catch (err) {
    return authFail(err) ?? fail("INTERNAL", "Gagal menambah entri changelog.");
  }
}

export async function updateChangelogEntry(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const { supabase } = await resolveOrg();
    const e = parsed.data.entry;
    const { error } = await supabase.rpc("update_changelog_entry", {
      p_id: parsed.data.entryId,
      p_entry_type: e.entryType,
      p_body: e.body,
      p_source_ea_version_id: e.sourceEaVersionId,
      p_is_feature_change: e.isFeatureChange,
      p_open_position_impact: e.openPositionImpact,
    });
    if (error) return mapRpcError(error, "Gagal menyimpan entri changelog.");
    return ok({ id: parsed.data.entryId });
  } catch (err) {
    return authFail(err) ?? fail("INTERNAL", "Gagal menyimpan entri changelog.");
  }
}

export async function deleteChangelogEntry(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "entryId", message: "ID entri tidak valid." }]);
    const { supabase } = await resolveOrg();
    const { error } = await supabase.rpc("delete_changelog_entry", { p_id: parsed.data.entryId });
    if (error) return mapRpcError(error, "Gagal menghapus entri changelog.");
    return ok({ id: parsed.data.entryId });
  } catch (err) {
    return authFail(err) ?? fail("INTERNAL", "Gagal menghapus entri changelog.");
  }
}

export async function reorderChangelogEntries(input: unknown): Promise<ActionResult<{ count: number }>> {
  try {
    const { roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");
    const parsed = reorderSchema.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "orderedIds", message: "Urutan tidak valid." }]);
    const { supabase } = await resolveOrg();
    const { error } = await supabase.rpc("reorder_changelog_entries", {
      p_manual_version_id: parsed.data.manualVersionId,
      p_ordered_ids: parsed.data.orderedIds,
    });
    if (error) return mapRpcError(error, "Gagal mengubah urutan changelog.");
    return ok({ count: parsed.data.orderedIds.length });
  } catch (err) {
    return authFail(err) ?? fail("INTERNAL", "Gagal mengubah urutan changelog.");
  }
}
