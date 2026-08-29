"use server";

/**
 * Grounded AI assistant — server actions (Phase 4, PRD-AI-001..007).
 *
 * The server is the security boundary. Every action: authenticates, requires `manual:update`
 * (aggregated across the caller's roles, so `developer@` who is also TECHNICAL_REVIEWER keeps
 * the capability — reviewers alone cannot), re-derives EVERY fact from the DB (never trusts
 * client-supplied facts), sends the provider ONLY a 4-key `GroundedRequest`, validates the
 * response (schema + grounding + fact references), and records an `ai_revisions` audit row
 * with no credential.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { assertCan, AuthorizationError } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
import { writeAudit } from "@/features/audit/write";
import { getRequestId, logServerError } from "@/lib/observability/request-id";
import { SupabaseManualDataSource } from "@/features/manuals/data-source";
import { assembleManualViewModel } from "@/lib/manual/view-model";

import { buildFactBundle, type BlockContext } from "@/lib/ai/fact-bundle";
import { buildGroundedRequest } from "@/lib/ai/grounded-request";
import { hashAiRequest } from "@/lib/ai/hash";
import { validateGrounding } from "@/lib/ai/grounding";
import { validateFactReferences } from "@/lib/ai/fact-references";
import { projectManualLines } from "@/lib/ai/manual-projection";
import { scanClaims } from "@/lib/ai/claim-scanner";
import { getAIProvider, currentProviderMode } from "@/lib/ai/providers";
import { AiProviderError, type AiResult, type GroundingResult } from "@/lib/ai/types";

import {
  requestAiRevisionSchema,
  resolveAiRevisionSchema,
  scanManualClaimsSchema,
} from "./schema";


function factsUsed(
  factBundle: { facts: { id: string; label: string }[] },
  refs: string[],
): { id: string; label: string }[] {
  const byId = new Map(factBundle.facts.map((f) => [f.id, f.label]));
  return refs.filter((r) => byId.has(r)).map((r) => ({ id: r, label: byId.get(r)! }));
}

function authFail(e: unknown): ActionResult<never> | null {
  if (e instanceof AuthError) return fail(e.code, e.message);
  if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
  return null;
}

export type ProviderInfo = { mode: "mock" | "configured" | "config-error"; label: string };

export type AiRevisionResult = {
  revisionId: string | null;
  result: AiResult;
  grounding: GroundingResult;
  provider: ProviderInfo;
  /** the facts the proposal referenced, with labels for the "fakta yang dipakai" chips */
  factsUsed: { id: string; label: string }[];
  /** true when this exact request already had a PENDING proposal (no new provider call). */
  deduped: boolean;
};

// ---------------------------------------------------------------------------
// requestAiRevision — produce (or re-serve) a grounded proposal
// ---------------------------------------------------------------------------
export async function requestAiRevision(input: unknown): Promise<ActionResult<AiRevisionResult>> {
  const startedAt = Date.now();
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");

    const parsed = requestAiRevisionSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const { manualId, sectionId, blockId, blockType, targetField, operation, selectedText, locale } = parsed.data;

    // --- re-derive the manual + facts server-side (never trust the client) ---
    const vm = await assembleManualViewModel(new SupabaseManualDataSource(orgId), manualId);
    if (!vm) return fail("NOT_FOUND", "Manual tidak ditemukan.");
    const section = vm.sections.find((s) => s.id === sectionId);
    if (!section) return fail("NOT_FOUND", "Bab tidak ditemukan.");

    const blockCtx: BlockContext = { blockId, blockType, targetField };
    const factBundle = buildFactBundle(vm, section, blockCtx);
    const grounded = buildGroundedRequest({ selectedText, factBundle, locale, operation });
    const inputHash = hashAiRequest(grounded, {
      manualVersionId: vm.manualVersion.id,
      sectionId,
      blockId,
      targetField,
    });

    const supabase = await createSupabaseServerClient();
    const providerInfo: ProviderInfo = { mode: currentProviderMode(), label: "" };

    // --- idempotency: an identical PENDING proposal is re-served, no new provider call ---
    const { data: existing } = await supabase
      .from("ai_revisions")
      .select("*")
      .eq("manual_version_id", vm.manualVersion.id)
      .eq("input_hash", inputHash)
      .eq("decision", "PENDING")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      providerInfo.label = String(existing.provider ?? "");
      return ok({
        revisionId: existing.id as string,
        result: rowToResult(existing),
        grounding: existing.grounding_ok
          ? { ok: true }
          : { ok: false, violations: (existing.grounding_violations as string[]) ?? [] },
        provider: providerInfo,
        factsUsed: factsUsed(factBundle, (existing.fact_reference_ids as string[]) ?? []),
        deduped: true,
      });
    }

    // --- call the provider (ONLY the 4-key GroundedRequest crosses this boundary) ---
    let provider;
    try {
      provider = getAIProvider();
    } catch (e) {
      if (e instanceof AiProviderError && e.code === "CONFIG") {
        return fail("NOT_CONFIGURED", e.message);
      }
      throw e;
    }
    providerInfo.label = provider.label;

    let result: AiResult;
    try {
      result = await provider[operation](grounded);
    } catch (e) {
      if (e instanceof AiProviderError) {
        await logServerError("ai", "provider error", { operation, code: e.code });
        const msg =
          e.code === "TIMEOUT"
            ? "Asisten AI tidak merespons tepat waktu. Coba lagi."
            : e.code === "MALFORMED_RESPONSE"
              ? "Respons AI tidak dapat dibaca. Coba lagi."
              : "Asisten AI sedang tidak tersedia. Coba lagi.";
        return fail("INTERNAL", msg);
      }
      throw e;
    }

    // --- validate provider output ---
    let grounding: GroundingResult = { ok: true };
    if (result.status === "PROPOSAL") {
      const refs = validateFactReferences(result, factBundle.facts);
      if (!refs.ok) {
        await logServerError("ai", "unknown fact references from provider", { unknown: refs.unknownRefs.length });
        return fail("INTERNAL", "AI mengembalikan referensi fakta yang tidak dikenal. Hasil ditolak.");
      }
      grounding = validateGrounding({ selectedText, facts: factBundle.facts, output: result.output });
    }

    // --- record the audit row (no credential; provider_metadata is safe only) ---
    const requestId = await getRequestId();
    const providerModel =
      "model" in provider && typeof (provider as { model?: unknown }).model === "string"
        ? (provider as { model: string }).model
        : null;

    const insertRow = {
      organization_id: orgId,
      manual_version_id: vm.manualVersion.id,
      section_id: sectionId,
      block_id: blockId,
      target_field: targetField,
      actor_id: userId,
      operation,
      input_hash: inputHash,
      locale,
      fact_reference_ids: result.status === "PROPOSAL" ? result.factReferences : [],
      status: result.status,
      proposed_output:
        result.status === "PROPOSAL" ? result.output : { missingFacts: result.missingFacts },
      grounding_ok: grounding.ok,
      grounding_violations: grounding.ok ? [] : grounding.violations,
      provider: provider.mode === "mock" ? "mock" : provider.label,
      provider_model: providerModel,
      provider_metadata: { requestId, durationMs: Date.now() - startedAt },
      decision: result.status === "PROPOSAL" ? "PENDING" : "N/A",
    };

    const { data: inserted, error: insErr } = await supabase
      .from("ai_revisions")
      .insert(insertRow)
      .select("id")
      .single();

    if (insErr) {
      // concurrent identical request won the dedup index — re-serve the winner
      const { data: raced } = await supabase
        .from("ai_revisions")
        .select("*")
        .eq("manual_version_id", vm.manualVersion.id)
        .eq("input_hash", inputHash)
        .eq("decision", "PENDING")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (raced) {
        return ok({
          revisionId: raced.id as string,
          result: rowToResult(raced),
          grounding: raced.grounding_ok
            ? { ok: true }
            : { ok: false, violations: (raced.grounding_violations as string[]) ?? [] },
          provider: providerInfo,
          factsUsed: factsUsed(factBundle, (raced.fact_reference_ids as string[]) ?? []),
          deduped: true,
        });
      }
      await logServerError("ai", "ai_revisions insert failed", { code: insErr.code });
      return fail("INTERNAL", "Gagal menyimpan proposal AI.");
    }

    await writeAudit(orgId, userId, "ai:request", "ai_revision", inserted.id as string, {
      operation,
      status: result.status,
      groundingOk: grounding.ok,
    });

    return ok({
      revisionId: inserted.id as string,
      result,
      grounding,
      provider: providerInfo,
      factsUsed:
        result.status === "PROPOSAL" ? factsUsed(factBundle, result.factReferences) : [],
      deduped: false,
    });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal memproses permintaan AI.");
  }
}

// ---------------------------------------------------------------------------
// resolveAiRevision — record Accept / Reject
// ---------------------------------------------------------------------------
export async function resolveAiRevision(
  input: unknown,
): Promise<ActionResult<{ decision: "ACCEPTED" | "REJECTED"; alreadyDecided: boolean }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");

    const parsed = resolveAiRevisionSchema.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const { revisionId, decision, appliedRowVersion, appliedAgainstHash } = parsed.data;

    const supabase = await createSupabaseServerClient();
    const { data: row } = await supabase
      .from("ai_revisions")
      .select("id, decision, status, organization_id")
      .eq("organization_id", orgId)
      .eq("id", revisionId)
      .maybeSingle();
    if (!row) return fail("NOT_FOUND", "Revisi AI tidak ditemukan.");
    if (row.status !== "PROPOSAL") return fail("VALIDATION", "Revisi ini bukan proposal yang dapat diputuskan.");

    if (row.decision !== "PENDING") {
      // idempotent: a repeated resolve with the same decision is a no-op
      return ok({ decision: row.decision as "ACCEPTED" | "REJECTED", alreadyDecided: true });
    }

    const { error: updErr } = await supabase
      .from("ai_revisions")
      .update({
        decision,
        decided_at: new Date().toISOString(),
        applied_row_version: decision === "ACCEPTED" ? (appliedRowVersion ?? null) : null,
        provider_metadata: appliedAgainstHash ? { appliedAgainstHash } : {},
      })
      .eq("organization_id", orgId)
      .eq("id", revisionId)
      .eq("decision", "PENDING");
    if (updErr) return fail("INTERNAL", "Gagal menyimpan keputusan revisi AI.");

    await writeAudit(orgId, userId, "ai:decision", "ai_revision", revisionId, { decision });
    return ok({ decision, alreadyDecided: false });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal memproses keputusan AI.");
  }
}

// ---------------------------------------------------------------------------
// scanManualClaims — advisory whole-manual claim scan (§16, AC-P4-8)
// ---------------------------------------------------------------------------
export async function scanManualClaims(
  input: unknown,
): Promise<ActionResult<{ findings: import("@/lib/ai/types").ClaimFinding[]; provider: ProviderInfo }>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    assertCan(roles, "manual:update");

    const parsed = scanManualClaimsSchema.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "manualId", message: "ID manual tidak valid." }]);

    const vm = await assembleManualViewModel(new SupabaseManualDataSource(orgId), parsed.data.manualId);
    if (!vm) return fail("NOT_FOUND", "Manual tidak ditemukan.");

    const lines = projectManualLines(vm); // current manual only — no other manuals / DB dump
    const findings = scanClaims(lines); // same engine as AIProvider.detectClaims

    const supabase = await createSupabaseServerClient();
    const requestId = await getRequestId();
    const categories = [...new Set(findings.map((f) => f.category))];
    await supabase.from("ai_revisions").insert({
      organization_id: orgId,
      manual_version_id: vm.manualVersion.id,
      actor_id: userId,
      operation: "detectClaims",
      input_hash: `scan:${vm.manualVersion.id}:${vm.manualVersion.rowVersion}`,
      locale: vm.manual.locale || "id",
      status: "SCAN",
      proposed_output: { findingCount: findings.length, categories }, // counts only — no manual text
      provider: "deterministic",
      provider_metadata: { requestId },
      decision: "N/A",
    });

    return ok({
      findings,
      provider: { mode: currentProviderMode(), label: "deterministic" },
    });
  } catch (e) {
    return authFail(e) ?? fail("INTERNAL", "Gagal memindai klaim manual.");
  }
}

// ---------------------------------------------------------------------------
function rowToResult(row: Record<string, unknown>): AiResult {
  if (row.status === "PROPOSAL") {
    return {
      status: "PROPOSAL",
      operation: row.operation as never,
      output: row.proposed_output as never,
      factReferences: (row.fact_reference_ids as string[]) ?? [],
    };
  }
  return {
    status: "ADDITIONAL_INFORMATION_REQUIRED",
    missingFacts: ((row.proposed_output as { missingFacts?: unknown })?.missingFacts as never) ?? [],
  };
}
