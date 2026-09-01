/**
 * Phase 5 — the one central deterministic evaluator (PRD-VAL-002, AC-P5-3/6).
 *
 * `evaluateManual(vm, items)` loads NOTHING — it is pure over the already-assembled
 * `ManualViewModel` and the checklist item metadata. The server action does the DB I/O
 * (assemble VM, load template, persist results). React and SQL contain no rule logic.
 */

import type { ManualViewModel } from "@/lib/manual/view-model";
import {
  CHECKLIST_STATES,
  type ChecklistItemDef,
  type ChecklistState,
  type Eligibility,
  type ItemResult,
  type PbkScope,
  type ReadinessScore,
  type ValidationView,
} from "./types";
import { RULES, ruleApplies, notApplicableReason, eaPbkScope } from "./rules";
import { isHumanEvidenceEligible } from "./types";

/**
 * AC-P5-3: required, in-scope PASS ÷ required, in-scope. NA excluded both sides.
 *
 * UAT-35 §7: an eligible check whose automated state is WARNING and which has a current
 * ACCEPTED human-evidence resolution counts toward the numerator (the WARNING is "resolved by
 * human review"). `state` is unchanged — this only affects the readiness fraction. A MISSING
 * result can never be counted this way.
 */
type ScoreItem = Pick<ItemResult, "required" | "state"> &
  Partial<Pick<ItemResult, "systemState" | "humanEvidence">>;

function resolvedByHuman(i: ScoreItem): boolean {
  return i.systemState === "WARNING" && i.humanEvidence?.effectiveResolution === "RESOLVED_BY_HUMAN_REVIEW";
}

export function computeScore(items: ScoreItem[]): ReadinessScore {
  const inScope = items.filter((i) => i.required && i.state !== "NOT_APPLICABLE");
  const numerator = inScope.filter((i) => i.state === "PASS" || resolvedByHuman(i)).length;
  const denominator = inScope.length;
  return {
    numerator,
    denominator,
    percent: denominator === 0 ? null : Math.round((numerator * 100) / denominator),
  };
}

/** AC-P5-6: any required, in-scope MISSING blocks; WARNING never does. */
export function computeEligibility(
  items: Pick<ItemResult, "required" | "state" | "label">[],
): Eligibility {
  const blocking = items.filter((i) => i.required && i.state === "MISSING");
  return { ready: blocking.length === 0, blockingReasons: blocking.map((i) => i.label) };
}

export function computeCounts(items: Pick<ItemResult, "state">[]): Record<ChecklistState, number> {
  const counts = Object.fromEntries(CHECKLIST_STATES.map((s) => [s, 0])) as Record<ChecklistState, number>;
  for (const i of items) counts[i.state] += 1;
  return counts;
}

type EvaluateOptions = {
  /** the manual_version being evaluated — stamped onto the result so a stale payload is detectable */
  manualVersionId?: string;
  templateId: string;
  templateVersion: number;
  /**
   * Existing per-checkKey reviewer N/A overrides to preserve (§26). When present, the item's
   * state stays NOT_APPLICABLE + the override provenance; `systemState` still records what the
   * rule would compute now.
   */
  overrides?: Record<
    string,
    { actorId: string | null; actorName: string | null; reason: string; at: string }
  >;
  evaluatedAt?: string;
};

export function evaluateManual(
  vm: ManualViewModel,
  items: ChecklistItemDef[],
  opts: EvaluateOptions,
): ValidationView {
  const scope: PbkScope = eaPbkScope(vm.eaVersion.requirements);
  const overrides = opts.overrides ?? {};

  const results: ItemResult[] = [...items]
    .sort((a, b) => a.position - b.position)
    .map((item) => {
      // 1. deterministic automated evaluation
      let systemState: ChecklistState;
      let reason: string;
      let evidence: Record<string, unknown>;
      let navigateSectionKey: string | null = null;

      if (item.bappebtiOnly && scope === "OUT_OF_SCOPE") {
        systemState = "NOT_APPLICABLE";
        reason = "Tidak berlaku: EA berada di luar lingkup PBK Indonesia.";
        evidence = { scope };
      } else if (!ruleApplies(item.checkKey, vm)) {
        systemState = "NOT_APPLICABLE";
        reason = notApplicableReason(item.checkKey);
        evidence = { applies: false };
      } else {
        const rule = RULES[item.ruleKey];
        if (!rule) {
          systemState = "MISSING";
          reason = `Aturan tidak dikenal: ${item.ruleKey}.`;
          evidence = {};
        } else {
          const out = rule(vm);
          systemState = out.state;
          reason = out.reason;
          evidence = out.evidence;
          navigateSectionKey = out.navigateSectionKey ?? null;
        }
      }

      const humanEvidenceEligible = isHumanEvidenceEligible(item.checkKey);

      // 2. a live reviewer N/A override wins (kept across re-evaluation — §26)
      const override = overrides[item.checkKey] ?? null;
      if (override) {
        return {
          checkKey: item.checkKey,
          label: item.label,
          category: item.category,
          required: item.required,
          publishBlocking: item.publishBlocking,
          state: "NOT_APPLICABLE" as ChecklistState,
          systemState,
          evaluator: "reviewer" as const,
          reason: `Ditandai tidak berlaku oleh reviewer: ${override.reason}`,
          evidence: { ...evidence, systemStateIfReevaluated: systemState },
          navigateSectionKey,
          override,
          humanEvidenceEligible,
          humanEvidence: null,
        };
      }

      return {
        checkKey: item.checkKey,
        label: item.label,
        category: item.category,
        required: item.required,
        publishBlocking: item.publishBlocking,
        state: systemState,
        systemState,
        evaluator: "system" as const,
        reason,
        evidence,
        navigateSectionKey,
        override: null,
        humanEvidenceEligible,
        humanEvidence: null,
      };
    });

  return {
    manualVersionId: opts.manualVersionId ?? vm.manualVersion.id,
    templateId: opts.templateId,
    templateVersion: opts.templateVersion,
    pbkScope: scope,
    items: results,
    score: computeScore(results),
    eligibility: computeEligibility(results),
    counts: computeCounts(results),
    evaluatedAt: opts.evaluatedAt ?? new Date().toISOString(),
  };
}
