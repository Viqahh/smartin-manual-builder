"use server";

/**
 * Phase 6 slice 5 — "Buat manual untuk versi baru" (AC-P6-11, PRD-MAN-013, PRD-CNT-010, GI-11).
 *
 * `cloneManualVersion` runs ONE atomic SECURITY DEFINER RPC (`clone_manual_version`,
 * `20260901001800`) that copies the source manual version into a fresh DRAFT linked to a chosen
 * TARGET EA Version, remapping every parameterTable block's parameter groups by name. Any failure
 * rolls the whole transaction back. On success this action then runs the existing Phase 5
 * evaluator against the NEW version's content + the TARGET EA facts (application-side — NOT in the
 * clone transaction); if that refresh fails the DRAFT still exists and the caller is told to retry.
 */

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
import { logServerError } from "@/lib/observability/request-id";
import { refreshValidation } from "@/features/validation/actions";
import type { PostgrestError } from "@supabase/supabase-js";

const cloneInput = z.object({
  sourceManualVersionId: z.uuid(),
  targetEaVersionId: z.uuid(),
  newVersion: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+$/, "Gunakan format X.Y.Z, mis. 2.0.0."),
});

export type CloneResult = {
  manualId: string;
  newManualVersionId: string;
  newVersion: string;
  /** the checklist-template version the source was bound to — the fresh eval used this one */
  checklistTemplateVersion: number | null;
  validationRefreshed: boolean;
};

function authFail(e: unknown): ActionResult<never> | null {
  if (e instanceof AuthError) return fail(e.code, e.message);
  if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
  return null;
}

/** Map a raised clone RPC error to a typed ActionResult (no SQL leak). */
function mapRpcError(error: PostgrestError | null): ActionResult<never> {
  const msg = (error?.message ?? "").toLowerCase();
  if (error?.code === "23505" || msg.includes("duplicate key")) {
    return fail("CONFLICT", "Versi manual itu sudah ada pada lineage manual ini.");
  }
  const groupMatch = error?.message?.match(/parameter group "([^"]+)" is not available/i);
  if (groupMatch) {
    return fail("VALIDATION", `Grup parameter '${groupMatch[1]}' tidak tersedia pada EA Version tujuan.`);
  }
  if (msg.includes("no longer the latest version")) {
    return fail("STALE", "Manual sumber bukan lagi versi terbaru pada lineage ini. Muat ulang lalu ulangi dari versi terbaru.");
  }
  if (msg.includes("mixed checklist template versions")) {
    return fail("VALIDATION", "Hasil checklist manual sumber memakai versi templat yang bercampur — perbaiki dulu sebelum menyalin.");
  }
  if (msg.includes("no longer exists")) {
    return fail("VALIDATION", "Salah satu grup parameter pada manual sumber sudah tidak ada. Perbaiki blok parameter terlebih dahulu.");
  }
  if (msg.includes("different ea product") || msg.includes("not found in this organisation")) {
    return fail("VALIDATION", "EA Version tujuan harus milik organisasi ini dan produk EA yang sama.");
  }
  if (msg.includes("must be x.y.z")) return fail("VALIDATION", "Gunakan format X.Y.Z untuk versi manual baru.");
  if (msg.includes("not found")) return fail("NOT_FOUND", "Manual sumber tidak ditemukan.");
  if (msg.startsWith("forbidden:") || msg.includes("forbidden:")) return fail("FORBIDDEN", "Akses ditolak.");
  void logServerError("clone", "unmapped clone rpc error", { code: error?.code });
  return fail("INTERNAL", "Gagal membuat manual untuk versi baru.");
}

export async function cloneManualVersion(input: unknown): Promise<ActionResult<CloneResult>> {
  try {
    const { roles } = await requireActiveOrg();
    assertCan(roles, "manual:create");
    const parsed = cloneInput.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("clone_manual_version", {
      p_source_manual_version_id: parsed.data.sourceManualVersionId,
      p_target_ea_version_id: parsed.data.targetEaVersionId,
      p_new_version: parsed.data.newVersion,
    });
    if (error) return mapRpcError(error);

    const row = data as {
      manualId?: string;
      newManualVersionId?: string;
      newVersion?: string;
      sourceChecklistTemplateVersion?: number | null;
    } | null;
    if (!row?.manualId || !row.newManualVersionId) {
      return fail("INTERNAL", "Gagal membuat manual untuk versi baru.");
    }

    // Fresh Phase 5 evaluation of the NEW version — application-side, AFTER the atomic clone.
    // Pinned to the SAME checklist-template version the source result set was bound to (the clone
    // RPC resolved it); states are freshly evaluated against the TARGET EA facts, evidence/
    // overrides are NOT copied. If this fails, the DRAFT still exists and the UI can retry.
    const checklistTemplateVersion = row.sourceChecklistTemplateVersion ?? null;
    let validationRefreshed = true;
    try {
      const v = await refreshValidation({
        manualId: row.manualId,
        checklistTemplateVersion: checklistTemplateVersion ?? undefined,
      });
      validationRefreshed = v.ok;
    } catch {
      validationRefreshed = false;
    }

    return ok({
      manualId: row.manualId,
      newManualVersionId: row.newManualVersionId,
      newVersion: row.newVersion ?? parsed.data.newVersion,
      checklistTemplateVersion,
      validationRefreshed,
    });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal membuat manual untuk versi baru.");
  }
}
