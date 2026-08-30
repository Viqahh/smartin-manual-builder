"use server";

/**
 * Phase 6 slice 2 — server-owned review workflow commands (PRD-REV-001…008, AC-P6-2/3/5/6/7/8).
 *
 * There is NO generic `setStatus(newStatus)`. Each command: authenticates the actor, resolves the
 * organisation from the target, loads the persisted `ManualViewModel`, computes the deterministic
 * content fingerprint, and calls the matching atomic SECURITY DEFINER RPC
 * (`20260901001400_phase6_workflow.sql`). The RPC re-checks status / round / assignment / hash /
 * self-approval under a row lock and writes EXACTLY ONE `audit_events` row inside the transaction —
 * this action never writes audit itself (no RPC + action double-logging).
 *
 * The Phase 5 validation gate (no required in-scope MISSING) is enforced here, before submit, by
 * re-evaluating the checklist against persisted content — the rules are not duplicated in SQL.
 */

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, canAny, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
import { logServerError } from "@/lib/observability/request-id";
import { SupabaseManualDataSource } from "@/features/manuals/data-source";
import { assembleManualViewModel } from "@/lib/manual/view-model";
import { manualReviewFingerprint } from "@/lib/reviews/fingerprint";
import { refreshValidation } from "@/features/validation/actions";
import type { PostgrestError } from "@supabase/supabase-js";

const manualRef = z.object({ manualId: z.uuid() });
const decisionInput = z.object({
  manualId: z.uuid(),
  decision: z.enum(["APPROVE", "REQUEST_CHANGES"]),
  summary: z.string().trim().max(4000).default(""),
});
const assignInput = z.object({
  manualId: z.uuid(),
  technicalReviewerId: z.uuid(),
  complianceReviewerId: z.uuid(),
});

function authFail(e: unknown): ActionResult<never> | null {
  if (e instanceof AuthError) return fail(e.code, e.message);
  if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
  return null;
}

/** Map a raised RPC error to a typed ActionResult (no SQL / internals leak). */
function mapRpcError(error: PostgrestError | null, fallback: string): ActionResult<never> {
  const msg = (error?.message ?? "").toLowerCase();
  if (msg.includes("self approval forbidden")) {
    return fail("SELF_APPROVAL", "Reviewer yang menulis atau menyunting manual ini tidak dapat menyetujuinya.");
  }
  if (msg.includes("stale content") || msg.includes("stale review round") || msg.includes("already left") || msg.includes("already exists for this review round")) {
    return fail("STALE", "Konten atau ronde review sudah berubah. Muat ulang lalu coba lagi.");
  }
  if (msg.includes("invalid anchor")) {
    return fail("VALIDATION", cleanRpcMessage(error?.message) ?? "Target komentar tidak valid.");
  }
  if (msg.includes("comment body must be")) {
    return fail("VALIDATION", "Komentar harus 1–5000 karakter.");
  }
  if (msg.includes("not found")) return fail("NOT_FOUND", "Data tidak ditemukan.");
  if (msg.startsWith("forbidden:") || msg.includes("forbidden:")) {
    return fail("FORBIDDEN", cleanRpcMessage(error?.message) ?? "Akses ditolak.");
  }
  if (msg.startsWith("workflow:") || msg.includes("workflow:") || msg.includes("read-only") || msg.includes("must be an active")) {
    return fail("WORKFLOW", cleanRpcMessage(error?.message) ?? "Aksi tidak diizinkan pada status ini.");
  }
  void logServerError("reviews", "unmapped workflow rpc error", { code: error?.code });
  return fail("INTERNAL", fallback);
}

function cleanRpcMessage(raw: string | undefined): string | null {
  if (!raw) return null;
  const first = raw
    .split("\n")[0]
    ?.replace(/^(workflow|forbidden|stale content|self approval forbidden|invalid anchor)\s*:?\s*/i, "")
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
    .select("id, status, review_round")
    .eq("id", vm.manualVersion.id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!data) return null;
  return { supabase, vm, versionId: data.id as string, status: data.status as string, round: Number(data.review_round) };
}

// ---------------------------------------------------------------------------
// assignReviewers (ADMIN)
// ---------------------------------------------------------------------------
export async function assignReviewers(input: unknown): Promise<ActionResult<{ technicalReviewerId: string; complianceReviewerId: string }>> {
  try {
    const { orgId, roles } = await requireActiveOrg();
    assertCan(roles, "review:assign");
    const parsed = assignInput.safeParse(input);
    if (!parsed.success) return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));

    const ctx = await resolveVersion(orgId, parsed.data.manualId);
    if (!ctx) return fail("NOT_FOUND", "Manual tidak ditemukan.");

    const { error } = await ctx.supabase.rpc("assign_reviewers", {
      p_manual_version_id: ctx.versionId,
      p_technical_reviewer_id: parsed.data.technicalReviewerId,
      p_compliance_reviewer_id: parsed.data.complianceReviewerId,
    });
    if (error) {
      const m = error.message.toLowerCase();
      if (m.includes("must be an active technical")) return fail("VALIDATION", "Reviewer teknis harus anggota aktif dengan peran TECHNICAL_REVIEWER di organisasi ini.");
      if (m.includes("must be an active compliance")) return fail("VALIDATION", "Reviewer kepatuhan harus anggota aktif dengan peran COMPLIANCE_REVIEWER di organisasi ini.");
      return mapRpcError(error, "Gagal menetapkan reviewer.");
    }
    return ok({ technicalReviewerId: parsed.data.technicalReviewerId, complianceReviewerId: parsed.data.complianceReviewerId });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menetapkan reviewer.");
  }
}

// ---------------------------------------------------------------------------
// submitForTechnicalReview (author; DRAFT -> TECHNICAL_REVIEW)
// ---------------------------------------------------------------------------
export async function submitForTechnicalReview(input: unknown): Promise<ActionResult<{ status: string; round: number }>> {
  try {
    const { orgId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:submit_review");
    const parsed = manualRef.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "manualId", message: "ID manual tidak valid." }]);

    // Phase 5 gate — re-evaluate against persisted content; a required in-scope MISSING blocks.
    const val = await refreshValidation({ manualId: parsed.data.manualId });
    if (!val.ok) return fail("INTERNAL", "Gagal mengevaluasi kesiapan dokumentasi.");
    if (!val.data.eligibility.ready) {
      return fail("NOT_READY", "Lengkapi item wajib terlebih dahulu.", val.data.eligibility.blockingReasons.map((r) => ({ path: "checklist", message: r })));
    }

    const ctx = await resolveVersion(orgId, parsed.data.manualId);
    if (!ctx) return fail("NOT_FOUND", "Manual tidak ditemukan.");
    const hash = manualReviewFingerprint(ctx.vm);

    const { error } = await ctx.supabase.rpc("submit_for_technical_review", {
      p_manual_version_id: ctx.versionId,
      p_expected_round: ctx.round,
      p_content_hash: hash,
    });
    if (error) return mapRpcError(error, "Gagal mengirim manual untuk review.");
    return ok({ status: "TECHNICAL_REVIEW", round: ctx.round + 1 });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal mengirim manual untuk review.");
  }
}

// ---------------------------------------------------------------------------
// technicalDecision / complianceDecision
// ---------------------------------------------------------------------------
async function decision(
  input: unknown,
  kind: "technical" | "compliance",
): Promise<ActionResult<{ status: string; decision: string }>> {
  try {
    const { orgId, roles } = await requireActiveOrg();
    assertCan(roles, kind === "technical" ? "review:technical" : "review:compliance");
    const parsed = decisionInput.safeParse(input);
    if (!parsed.success) return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    if (parsed.data.decision === "REQUEST_CHANGES" && parsed.data.summary.trim().length === 0) {
      return validationFail([{ path: "summary", message: "Ringkasan wajib diisi untuk permintaan perubahan." }]);
    }

    const ctx = await resolveVersion(orgId, parsed.data.manualId);
    if (!ctx) return fail("NOT_FOUND", "Manual tidak ditemukan.");
    const currentHash = manualReviewFingerprint(ctx.vm);

    const { data, error } = await ctx.supabase.rpc(
      kind === "technical" ? "record_technical_decision" : "record_compliance_decision",
      {
        p_manual_version_id: ctx.versionId,
        p_expected_round: ctx.round,
        p_decision: parsed.data.decision,
        p_summary: parsed.data.summary,
        p_current_hash: currentHash,
      },
    );
    if (error) return mapRpcError(error, "Gagal menyimpan keputusan review.");
    const next = (data as { status?: string } | null)?.status ?? "";
    return ok({ status: next, decision: parsed.data.decision });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menyimpan keputusan review.");
  }
}

export async function technicalDecision(input: unknown) {
  return decision(input, "technical");
}
export async function complianceDecision(input: unknown) {
  return decision(input, "compliance");
}

// ---------------------------------------------------------------------------
// beginRevision (author; CHANGES_REQUESTED -> DRAFT)
// ---------------------------------------------------------------------------
export async function beginRevision(input: unknown): Promise<ActionResult<{ status: string; round: number }>> {
  try {
    const { orgId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");
    const parsed = manualRef.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "manualId", message: "ID manual tidak valid." }]);

    const ctx = await resolveVersion(orgId, parsed.data.manualId);
    if (!ctx) return fail("NOT_FOUND", "Manual tidak ditemukan.");

    const { error } = await ctx.supabase.rpc("begin_revision", {
      p_manual_version_id: ctx.versionId,
      p_expected_round: ctx.round,
    });
    if (error) return mapRpcError(error, "Gagal memulai revisi.");
    return ok({ status: "DRAFT", round: ctx.round });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal memulai revisi.");
  }
}

// ---------------------------------------------------------------------------
// Review comments (slice 3) — createReviewComment / setReviewCommentResolved
// ---------------------------------------------------------------------------
const commentInput = z.object({
  manualId: z.uuid(),
  reviewType: z.enum(["TECHNICAL", "COMPLIANCE"]),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("manual") }),
    z.object({ kind: z.literal("section"), sectionId: z.uuid() }),
    z.object({ kind: z.literal("block"), blockId: z.uuid() }),
  ]),
  body: z.string().max(5000),
});

export async function createReviewComment(
  input: unknown,
): Promise<ActionResult<{ id: string; round: number; reviewType: string }>> {
  try {
    const { orgId, roles } = await requireActiveOrg();
    const parsed = commentInput.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    assertCan(roles, parsed.data.reviewType === "TECHNICAL" ? "review:technical" : "review:compliance");

    const body = parsed.data.body.trim();
    if (body.length === 0) {
      return validationFail([{ path: "body", message: "Komentar tidak boleh kosong." }]);
    }

    const ctx = await resolveVersion(orgId, parsed.data.manualId);
    if (!ctx) return fail("NOT_FOUND", "Manual tidak ditemukan.");

    const t = parsed.data.target;
    const { data, error } = await ctx.supabase.rpc("create_review_comment", {
      p_manual_version_id: ctx.versionId,
      p_review_type: parsed.data.reviewType,
      p_round: ctx.round,
      p_section_id: t.kind === "section" ? t.sectionId : null,
      p_block_id: t.kind === "block" ? t.blockId : null,
      p_body: body,
    });
    if (error) return mapRpcError(error, "Gagal menyimpan komentar.");
    const row = (data as { id?: string; round?: number; reviewType?: string } | null) ?? {};
    return ok({ id: row.id ?? "", round: row.round ?? ctx.round, reviewType: row.reviewType ?? parsed.data.reviewType });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal menyimpan komentar.");
  }
}

const resolveInput = z.object({ commentId: z.uuid(), resolved: z.boolean() });

export async function setReviewCommentResolved(
  input: unknown,
): Promise<ActionResult<{ id: string; resolved: boolean }>> {
  try {
    const { roles } = await requireActiveOrg();
    if (!canAny(roles, "review:technical") && !canAny(roles, "review:compliance")) {
      return fail("FORBIDDEN", "Hanya reviewer yang ditugaskan dapat mengubah status komentar.");
    }
    const parsed = resolveInput.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "commentId", message: "Permintaan tidak valid." }]);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("set_review_comment_resolved", {
      p_comment_id: parsed.data.commentId,
      p_resolved: parsed.data.resolved,
    });
    if (error) return mapRpcError(error, "Gagal memperbarui status komentar.");
    const row = (data as { id?: string; resolved?: boolean } | null) ?? {};
    return ok({ id: row.id ?? parsed.data.commentId, resolved: row.resolved ?? parsed.data.resolved });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal memperbarui status komentar.");
  }
}
