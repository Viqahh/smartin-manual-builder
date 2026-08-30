"use server";

/**
 * Phase 6 slice 6 — ADMIN-only publication + archive commands (AC-P6-2/9/10/13, PRD-OQ-007).
 *
 * TRUST BOUNDARY (spec §12): the privileged transaction is a SERVICE-ROLE-ONLY RPC
 * (`publish_manual_version` / `archive_manual_version`, `20260901002100_phase6_publish.sql`).
 * The browser can never invoke it. This server action is the ONLY caller: it authenticates the
 * session, resolves an ADMIN actor, loads the AUTHORITATIVE persisted content, and computes the
 * review fingerprint + the snapshot + the snapshot hash entirely server-side. The RPC then
 * re-verifies ADMIN + status + round + both current-round approval hashes + the PERSISTED Phase 5
 * publish gate + checklist result-set coherence and executes status → PUBLISHED, one immutable
 * `published_snapshots` row, and one audit row in ONE transaction (all-or-nothing).
 *
 * No client-supplied hash / snapshot path exists: the render_json and hashes come only from this
 * trusted code, and the actor id is `requireActiveOrg().userId`, never a request parameter.
 */

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
import { logServerError } from "@/lib/observability/request-id";
import { SupabaseManualDataSource } from "@/features/manuals/data-source";
import { assembleManualViewModel } from "@/lib/manual/view-model";
import { manualReviewFingerprint } from "@/lib/reviews/fingerprint";
import { refreshValidation } from "@/features/validation/actions";
import { buildPublishedSnapshot, computeSnapshotHash, scanSnapshotForLeaks } from "@/lib/publication/snapshot";
import type { PostgrestError } from "@supabase/supabase-js";

const manualRef = z.object({ manualId: z.uuid() });

export type PublishResult = {
  status: "PUBLISHED";
  snapshotId: string;
  contentHash: string;
  publicSlug: string;
  publicVersion: string;
};

export type ArchiveResult = { status: "ARCHIVED" };

function authFail(e: unknown): ActionResult<never> | null {
  if (e instanceof AuthError) return fail(e.code, e.message);
  if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
  return null;
}

function mapRpcError(error: PostgrestError | null, fallback: string): ActionResult<never> {
  const msg = (error?.message ?? "").toLowerCase();
  if (msg.includes("only an admin")) {
    return fail("FORBIDDEN", "Hanya ADMIN yang dapat menerbitkan atau mengarsipkan manual.");
  }
  if (msg.includes("stale content")) {
    return fail("STALE", "Konten manual berubah setelah disetujui. Perlu review ulang sebelum diterbitkan.");
  }
  if (msg.includes("publication is blocked by unresolved checklist items")) {
    const keys = (error?.details ?? "").split(",").filter(Boolean);
    return fail(
      "VALIDATION",
      "Publikasi belum dapat dilakukan — masih ada item checklist yang harus diselesaikan.",
      keys.map((k) => ({ path: "checklist", message: k })),
    );
  }
  if (msg.startsWith("validation:") || msg.includes("validation:")) {
    return fail("VALIDATION", cleanMsg(error?.message) ?? "Hasil checklist belum lengkap atau tidak konsisten.");
  }
  if (msg.startsWith("conflict:") || msg.includes("already published") || error?.code === "23505") {
    return fail("CONFLICT", "Manual version ini sudah diterbitkan.");
  }
  if (msg.includes("not found")) return fail("NOT_FOUND", "Manual tidak ditemukan.");
  if (msg.startsWith("workflow:") || msg.includes("workflow:")) {
    return fail("WORKFLOW", cleanMsg(error?.message) ?? "Aksi tidak diizinkan pada status ini.");
  }
  void logServerError("publication", "unmapped publish rpc error", { code: error?.code });
  return fail("INTERNAL", fallback);
}

function cleanMsg(raw: string | undefined): string | null {
  if (!raw) return null;
  const first = raw
    .split("\n")[0]
    ?.replace(/^(workflow|validation|forbidden|conflict|stale content)\s*:?\s*/i, "")
    .trim();
  if (!first || first.length > 200) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

async function resolveVersion(orgId: string, manualId: string) {
  const supabase = await createSupabaseServerClient();
  const vm = await assembleManualViewModel(new SupabaseManualDataSource(orgId), manualId);
  if (!vm) return null;
  const { data } = await supabase
    .from("manual_versions")
    .select("id, status, review_round, template_id, template_version")
    .eq("id", vm.manualVersion.id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!data) return null;
  return {
    supabase,
    vm,
    versionId: data.id as string,
    status: data.status as string,
    round: Number(data.review_round),
    templateId: data.template_id as string,
    templateVersion: Number(data.template_version),
  };
}

// ---------------------------------------------------------------------------
// publishManualVersion (ADMIN; APPROVED -> PUBLISHED)
// ---------------------------------------------------------------------------
export async function publishManualVersion(input: unknown): Promise<ActionResult<PublishResult>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:publish");
    const parsed = manualRef.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "manualId", message: "ID manual tidak valid." }]);

    // Ensure the persisted Phase 5 result set reflects current content BEFORE the transaction.
    // The RPC still independently inspects the PERSISTED blockers (spec §16) — this only makes
    // the friendly pre-check accurate.
    const val = await refreshValidation({ manualId: parsed.data.manualId });
    if (!val.ok) return fail("INTERNAL", "Gagal mengevaluasi kesiapan dokumentasi.");

    const ctx = await resolveVersion(orgId, parsed.data.manualId);
    if (!ctx) return fail("NOT_FOUND", "Manual tidak ditemukan.");

    const expectedHash = manualReviewFingerprint(ctx.vm);
    const publicSlug = ctx.vm.eaProduct.slug;
    const publicVersion = ctx.vm.manualVersion.version;
    if (!publicSlug) return fail("VALIDATION", "Produk EA belum memiliki slug publik.");

    // stable storage keys for referenced images (never a signed URL)
    const assetIds = Object.keys(ctx.vm.images);
    const imageStorageKeys: Record<string, string | null> = {};
    if (assetIds.length) {
      const { data: assets } = await ctx.supabase
        .from("image_assets")
        .select("id, storage_key")
        .in("id", assetIds);
      for (const a of assets ?? []) imageStorageKeys[a.id as string] = (a.storage_key as string | null) ?? null;
    }

    const snapshot = buildPublishedSnapshot(ctx.vm, {
      templateId: ctx.templateId,
      templateVersion: ctx.templateVersion,
      publicSlug,
      publicVersion,
      imageStorageKeys,
    });
    const leaks = scanSnapshotForLeaks(snapshot);
    if (leaks.length) {
      await logServerError("publication", "snapshot leak scan tripped", { keys: leaks.slice(0, 5) });
      return fail("INTERNAL", "Snapshot gagal validasi keamanan.");
    }
    const snapshotHash = computeSnapshotHash(snapshot);

    // SERVICE-ROLE-ONLY RPC. Browser cannot reach this; actor id is the authenticated session.
    const service = createSupabaseServiceClient();
    const { data, error } = await service.rpc("publish_manual_version", {
      p_manual_version_id: ctx.versionId,
      p_actor_id: userId,
      p_expected_content_hash: expectedHash,
      p_render_json: snapshot,
      p_snapshot_hash: snapshotHash,
      p_public_slug: publicSlug,
      p_public_version: publicVersion,
    });
    if (error) return mapRpcError(error, "Gagal menerbitkan manual.");

    const row = (data as Partial<PublishResult> | null) ?? {};
    return ok({
      status: "PUBLISHED",
      snapshotId: row.snapshotId ?? "",
      contentHash: row.contentHash ?? snapshotHash,
      publicSlug,
      publicVersion,
    });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menerbitkan manual.");
  }
}

// ---------------------------------------------------------------------------
// archiveManualVersion (ADMIN; PUBLISHED -> ARCHIVED)
// ---------------------------------------------------------------------------
export async function archiveManualVersion(input: unknown): Promise<ActionResult<ArchiveResult>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:publish");
    const parsed = manualRef.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "manualId", message: "ID manual tidak valid." }]);

    const ctx = await resolveVersion(orgId, parsed.data.manualId);
    if (!ctx) return fail("NOT_FOUND", "Manual tidak ditemukan.");

    const service = createSupabaseServiceClient();
    const { error } = await service.rpc("archive_manual_version", {
      p_manual_version_id: ctx.versionId,
      p_actor_id: userId,
    });
    if (error) return mapRpcError(error, "Gagal mengarsipkan manual.");
    return ok({ status: "ARCHIVED" });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal mengarsipkan manual.");
  }
}
