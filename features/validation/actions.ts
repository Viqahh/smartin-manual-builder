"use server";

/**
 * Phase 5 — documentation-readiness server actions (PRD-VAL-002, AC-P5-2/6/8/11).
 *
 * The server is the security boundary. `checklist_results` has NO client write policy — every
 * write here goes through the service-role client AFTER this action has enforced role + org +
 * (for an override) a recorded reason. The browser can never forge a state, a score, an
 * evaluator, or a developer N/A. The evaluator (`lib/validation/evaluate.ts`) is deterministic
 * and re-reads the DB, so results always reflect persisted server state (§28).
 */

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireActiveOrg, AuthError } from "@/lib/auth/context";
import { canAny, AuthorizationError, type OrgRole } from "@/lib/permissions/actions";
import { ok, fail, validationFail, type ActionResult } from "@/lib/errors";
import { writeAudit } from "@/features/audit/write";
import { logServerError } from "@/lib/observability/request-id";
import { SupabaseManualDataSource } from "@/features/manuals/data-source";
import { assembleManualViewModel } from "@/lib/manual/view-model";
import { evaluateManual, computeScore, computeEligibility, computeCounts } from "@/lib/validation/evaluate";
import { CHECKLIST_V1 } from "@/lib/validation/rules";
import type { ChecklistItemDef, ChecklistState, ItemResult, ValidationView } from "@/lib/validation/types";

const manualRef = z.object({ manualId: z.uuid() });
const overrideInput = z.object({
  manualId: z.uuid(),
  checkKey: z.string().min(3).max(64),
  reason: z.string().trim().min(5, "Berikan alasan minimal 5 karakter.").max(500),
});

function authFail(e: unknown): ActionResult<never> | null {
  if (e instanceof AuthError) return fail(e.code, e.message);
  if (e instanceof AuthorizationError) return fail("FORBIDDEN", e.message);
  return null;
}

/** Any review capability (TECHNICAL_REVIEWER / COMPLIANCE_REVIEWER / ADMIN). Developer: no. */
function canReview(roles: readonly OrgRole[]): boolean {
  return canAny(roles, "review:technical") || canAny(roles, "review:compliance");
}

// ---------------------------------------------------------------------------
// Load the active checklist template + its items (system template — RLS SELECT ok).
// Falls back to the built-in v1 metadata if the row is somehow absent.
// ---------------------------------------------------------------------------
/**
 * Load the checklist template + items. With no argument → the current ACTIVE template (the normal
 * Phase 5 path). With `pinnedVersion` (Phase 6 slice 5) → that exact `smartin-documentation-checklist`
 * version, so a clone is evaluated against the SAME checklist-template version its source Manual
 * Version was bound to — even after the active template has since been upgraded. A pinned version
 * that no longer exists falls back to the active template (documented).
 */
async function loadTemplate(
  pinnedVersion?: number,
): Promise<{ templateId: string; version: number; items: ChecklistItemDef[] }> {
  const supabase = await createSupabaseServerClient();
  let q = supabase.from("checklist_templates").select("id, version").eq("key", "smartin-documentation-checklist");
  q = pinnedVersion != null ? q.eq("version", pinnedVersion) : q.eq("is_active", true);
  const { data: tpl } = await q.order("version", { ascending: false }).limit(1).maybeSingle();

  if (!tpl) {
    if (pinnedVersion != null) return loadTemplate(); // pinned version gone -> active fallback
    return { templateId: "c5000000-0000-4000-8000-000000000001", version: 1, items: CHECKLIST_V1 };
  }
  const { data: rows } = await supabase
    .from("checklist_items")
    .select("check_key, label, category, description, required, rule_key, bappebti_only, publish_blocking, position")
    .eq("checklist_template_id", tpl.id)
    .order("position");

  const items: ChecklistItemDef[] = (rows ?? []).map((r) => ({
    checkKey: r.check_key as string,
    label: r.label as string,
    category: r.category as string,
    description: (r.description as string) ?? "",
    required: Boolean(r.required),
    ruleKey: r.rule_key as string,
    bappebtiOnly: Boolean(r.bappebti_only),
    publishBlocking: Boolean(r.publish_blocking),
    position: Number(r.position ?? 0),
  }));
  return { templateId: tpl.id as string, version: Number(tpl.version), items: items.length ? items : CHECKLIST_V1 };
}

type ExistingRow = {
  check_key: string;
  state: ChecklistState;
  evidence: Record<string, unknown>;
  evaluator: "system" | "reviewer";
  evaluated_at: string;
  override_actor_id: string | null;
  override_reason: string | null;
  override_at: string | null;
};

async function loadExistingResults(manualVersionId: string): Promise<ExistingRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("checklist_results")
    .select("check_key, state, evidence, evaluator, evaluated_at, override_actor_id, override_reason, override_at")
    .eq("manual_version_id", manualVersionId);
  return (data ?? []) as ExistingRow[];
}

async function resolveActorNames(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", uniq);
  return new Map((data ?? []).map((p) => [p.id as string, (p.display_name as string) ?? ""]));
}

// ---------------------------------------------------------------------------
// Evaluate + persist. Server-owned (service client). Preserves reviewer N/A overrides.
// ---------------------------------------------------------------------------
async function evaluateAndPersist(
  orgId: string,
  manualId: string,
  pinnedChecklistVersion?: number,
): Promise<ValidationView> {
  const vm = await assembleManualViewModel(new SupabaseManualDataSource(orgId), manualId);
  if (!vm) throw new NotFound();
  const { templateId, version, items } = await loadTemplate(pinnedChecklistVersion);

  const existing = await loadExistingResults(vm.manualVersion.id);
  const nameMap = await resolveActorNames(existing.map((r) => r.override_actor_id ?? "").filter(Boolean));
  const overrides: Record<string, { actorId: string | null; actorName: string | null; reason: string; at: string }> = {};
  for (const r of existing) {
    if (r.override_actor_id) {
      overrides[r.check_key] = {
        actorId: r.override_actor_id,
        actorName: nameMap.get(r.override_actor_id) ?? null,
        reason: r.override_reason ?? "",
        at: r.override_at ?? r.evaluated_at,
      };
    }
  }

  const evaluatedAt = new Date().toISOString();
  const view = evaluateManual(vm, items, { templateId, templateVersion: version, overrides, evaluatedAt });

  const service = createSupabaseServiceClient();
  const rows = view.items.map((it) => ({
    organization_id: orgId,
    manual_version_id: vm.manualVersion.id,
    checklist_template_id: templateId,
    checklist_template_version: version,
    check_key: it.checkKey,
    category: it.category,
    required: it.required,
    state: it.state,
    // bounded, id/key-based evidence + the human summary + reevaluation hint (§22, §26)
    evidence: {
      ...it.evidence,
      _reason: it.reason.slice(0, 400),
      _navigateSectionKey: it.navigateSectionKey,
      _systemState: it.systemState,
    },
    evaluator: it.evaluator,
    evaluated_at: evaluatedAt,
    override_actor_id: it.override?.actorId ?? null,
    override_reason: it.override ? it.override.reason.slice(0, 500) : null,
    override_at: it.override?.at ?? null,
  }));
  const { error } = await service.from("checklist_results").upsert(rows, { onConflict: "manual_version_id,check_key" });
  if (error) {
    await logServerError("validation", "checklist_results upsert failed", { code: error.code });
    throw new Error("persist failed");
  }
  return view;
}

class NotFound extends Error {}

// ---------------------------------------------------------------------------
// Shape persisted rows -> ValidationView (no rule re-run).
// ---------------------------------------------------------------------------
function shapeFromRows(
  rows: ExistingRow[],
  items: ChecklistItemDef[],
  templateId: string,
  templateVersion: number,
  pbkScope: "IN_SCOPE" | "OUT_OF_SCOPE",
  nameMap: Map<string, string>,
): ValidationView {
  const byKey = new Map(rows.map((r) => [r.check_key, r]));
  const results: ItemResult[] = [...items]
    .sort((a, b) => a.position - b.position)
    .map((item) => {
      const r = byKey.get(item.checkKey);
      const ev = (r?.evidence ?? {}) as Record<string, unknown>;
      const override =
        r?.override_actor_id != null
          ? {
              actorId: r.override_actor_id,
              actorName: nameMap.get(r.override_actor_id) ?? null,
              reason: r.override_reason ?? "",
              at: r.override_at ?? r.evaluated_at,
            }
          : null;
      return {
        checkKey: item.checkKey,
        label: item.label,
        category: item.category,
        required: item.required,
        publishBlocking: item.publishBlocking,
        state: (r?.state ?? "MISSING") as ChecklistState,
        systemState: (ev._systemState as ChecklistState) ?? ((r?.state ?? "MISSING") as ChecklistState),
        evaluator: (r?.evaluator ?? "system") as "system" | "reviewer",
        reason: (ev._reason as string) ?? "",
        evidence: ev,
        navigateSectionKey: (ev._navigateSectionKey as string | null) ?? null,
        override,
      };
    });
  return {
    templateId,
    templateVersion,
    pbkScope,
    items: results,
    score: computeScore(results),
    eligibility: computeEligibility(results),
    counts: computeCounts(results),
    evaluatedAt: rows[0]?.evaluated_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public actions
// ---------------------------------------------------------------------------

export async function getValidation(input: unknown): Promise<ActionResult<ValidationView>> {
  try {
    const { orgId, roles } = await requireActiveOrg();
    if (!canAny(roles, "manual:read")) return fail("FORBIDDEN", "Tidak diizinkan membaca manual.");
    const parsed = manualRef.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "manualId", message: "ID manual tidak valid." }]);

    const vm = await assembleManualViewModel(new SupabaseManualDataSource(orgId), parsed.data.manualId);
    if (!vm) return fail("NOT_FOUND", "Manual tidak ditemukan.");

    const existing = await loadExistingResults(vm.manualVersion.id);
    if (existing.length === 0) {
      return ok(await evaluateAndPersist(orgId, parsed.data.manualId));
    }
    const { templateId, version, items } = await loadTemplate();
    const nameMap = await resolveActorNames(existing.map((r) => r.override_actor_id ?? "").filter(Boolean));
    const scope = (vm.eaVersion.requirements?.pbkScope === "OUT_OF_SCOPE" ? "OUT_OF_SCOPE" : "IN_SCOPE") as
      | "IN_SCOPE"
      | "OUT_OF_SCOPE";
    return ok(shapeFromRows(existing, items, templateId, version, scope, nameMap));
  } catch (e) {
    if (e instanceof NotFound) return fail("NOT_FOUND", "Manual tidak ditemukan.");
    return authFail(e) ?? fail("INTERNAL", "Gagal memuat kesiapan dokumentasi.");
  }
}

const refreshInput = z.object({
  manualId: z.uuid(),
  /** Phase 6 slice 5 — pin the fresh evaluation to a specific checklist-template version (the one
   *  the clone's source Manual Version was bound to). Omitted ⇒ current active template. */
  checklistTemplateVersion: z.number().int().positive().optional(),
});

export async function refreshValidation(input: unknown): Promise<ActionResult<ValidationView>> {
  try {
    const { orgId, roles } = await requireActiveOrg();
    if (!canAny(roles, "manual:read")) return fail("FORBIDDEN", "Tidak diizinkan membaca manual.");
    const parsed = refreshInput.safeParse(input);
    if (!parsed.success) return validationFail([{ path: "manualId", message: "ID manual tidak valid." }]);
    return ok(await evaluateAndPersist(orgId, parsed.data.manualId, parsed.data.checklistTemplateVersion));
  } catch (e) {
    if (e instanceof NotFound) return fail("NOT_FOUND", "Manual tidak ditemukan.");
    return authFail(e) ?? fail("INTERNAL", "Gagal mengevaluasi kesiapan dokumentasi.");
  }
}

export async function overrideChecklistItem(input: unknown): Promise<ActionResult<ValidationView>> {
  try {
    const { orgId, userId, roles } = await requireActiveOrg();
    if (!canReview(roles)) {
      return fail("FORBIDDEN", "Hanya reviewer yang dapat menandai item sebagai tidak berlaku.");
    }
    const parsed = overrideInput.safeParse(input);
    if (!parsed.success) {
      return validationFail(parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const { manualId, checkKey, reason } = parsed.data;

    const vm = await assembleManualViewModel(new SupabaseManualDataSource(orgId), manualId);
    if (!vm) return fail("NOT_FOUND", "Manual tidak ditemukan.");
    const { templateId, version, items } = await loadTemplate();
    const item = items.find((i) => i.checkKey === checkKey);
    if (!item) return fail("NOT_FOUND", "Item checklist tidak dikenal.");

    // ensure a baseline result set exists (so provenance / previous state is real)
    let existing = await loadExistingResults(vm.manualVersion.id);
    if (existing.length === 0) {
      await evaluateAndPersist(orgId, manualId);
      existing = await loadExistingResults(vm.manualVersion.id);
    }
    const prev = existing.find((r) => r.check_key === checkKey);
    const previousState = prev?.state ?? "MISSING";
    const nowIso = new Date().toISOString();

    const service = createSupabaseServiceClient();
    const { error } = await service.from("checklist_results").upsert(
      {
        organization_id: orgId,
        manual_version_id: vm.manualVersion.id,
        checklist_template_id: templateId,
        checklist_template_version: version,
        check_key: checkKey,
        category: item.category,
        required: item.required,
        state: "NOT_APPLICABLE",
        evidence: {
          ...(prev?.evidence ?? {}),
          _reason: `Ditandai tidak berlaku oleh reviewer: ${reason.slice(0, 300)}`,
          _systemState: (prev?.evidence?._systemState as string) ?? previousState,
          _stateBeforeOverride: previousState,
        },
        evaluator: "reviewer",
        evaluated_at: nowIso,
        override_actor_id: userId,
        override_reason: reason,
        override_at: nowIso,
      },
      { onConflict: "manual_version_id,check_key" },
    );
    if (error) {
      await logServerError("validation", "checklist override upsert failed", { code: error.code });
      return fail("INTERNAL", "Gagal menyimpan penandaan tidak berlaku.");
    }

    await writeAudit(orgId, userId, "checklist:override_na", "checklist_result", null, {
      checkKey,
      manualVersionId: vm.manualVersion.id,
      previousState,
      newState: "NOT_APPLICABLE",
      reason: reason.slice(0, 200),
    });

    // return the refreshed view (rules re-run; the override now persists — §26)
    return ok(await evaluateAndPersist(orgId, manualId));
  } catch (e) {
    if (e instanceof NotFound) return fail("NOT_FOUND", "Manual tidak ditemukan.");
    return authFail(e) ?? fail("INTERNAL", "Gagal memproses penandaan tidak berlaku.");
  }
}
