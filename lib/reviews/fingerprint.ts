/**
 * Phase 6 — deterministic review-content fingerprint (PRD-REV, AC-P6-10 groundwork).
 *
 * A review round is bound to the EXACT resolved documentation being reviewed. Before a
 * technical / compliance approval and before publish, the server recomputes this hash from
 * persisted content; a mismatch rejects the privileged action (a moving target, forged edits,
 * or external EA-Version fact drift during review).
 *
 * It is a deterministic projection of the SAME `ManualViewModel` the builder / preview / (later)
 * public renderer use — no second content model. Serialisation reuses the repository's
 * key-sorted `stableStringify` (the Phase 3 jsonb-key-order fix), so object key insertion order
 * never changes the digest. Section / block ORDER is significant and IS part of the hash.
 *
 * Excluded (volatile / non-content): signed URLs, `updatedAt` / query timestamps, `rowVersion`,
 * DB row ids for setups & parameters (content identity is symbol/timeframe & technicalName),
 * auth/session, secrets, provider metadata, request metadata, and the workflow `status`
 * (status changes during the workflow; the reviewed content does not).
 */

import { createHash } from "node:crypto";
import { stableStringify } from "@/lib/editor/autosave-queue";
import type { ManualViewModel } from "@/lib/manual/view-model";

/** Optional structured changelog rows (loaded by slice 4; omit / [] before then). */
export type FingerprintChangelogEntry = {
  position: number;
  entryType: string;
  body: string;
  sourceEaVersionId: string | null;
  isFeatureChange: boolean;
  openPositionImpact: string | null;
};

export type FingerprintInput = {
  vm: ManualViewModel;
  changelog?: FingerprintChangelogEntry[];
};

/** The canonical, hashable projection. Pure — safe to snapshot / diff / log (no secrets). */
export function projectReviewContent(input: FingerprintInput): Record<string, unknown> {
  const { vm } = input;
  // Slice 4: the authoritative fingerprint always includes the structured changelog. An explicit
  // `input.changelog` still wins (tests); otherwise it comes from the loaded ManualViewModel.
  const rawChangelog: FingerprintChangelogEntry[] =
    input.changelog ??
    (vm.changelog ?? []).map((c) => ({
      position: c.position,
      entryType: c.entryType,
      body: c.body,
      sourceEaVersionId: c.sourceEaVersionId,
      isFeatureChange: c.isFeatureChange,
      openPositionImpact: c.openPositionImpact,
    }));
  const changelog = [...rawChangelog]
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      position: c.position,
      entryType: c.entryType,
      body: c.body,
      sourceEaVersionId: c.sourceEaVersionId,
      isFeatureChange: c.isFeatureChange,
      openPositionImpact: c.openPositionImpact,
    }));

  return {
    v: 1,
    manual: { id: vm.manual.id, locale: vm.manual.locale },
    manualVersion: { id: vm.manualVersion.id, version: vm.manualVersion.version },
    eaProduct: { id: vm.eaProduct.id, name: vm.eaProduct.name, slug: vm.eaProduct.slug, description: vm.eaProduct.description },
    eaVersion: {
      id: vm.eaVersion.id,
      version: vm.eaVersion.version,
      platform: vm.eaVersion.platform,
      releaseDate: vm.eaVersion.releaseDate,
      requirements: vm.eaVersion.requirements,
      support: vm.eaVersion.support,
    },
    organization: { id: vm.organization.id, name: vm.organization.name },
    developer: vm.developer?.name ?? null,
    supportedSetups: [...vm.supportedSetups]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        symbol: s.symbol,
        timeframe: s.timeframe,
        presetRef: s.presetRef,
        testedMinimumLot: s.testedMinimumLot,
        notes: s.notes,
        isSupported: s.isSupported,
        position: s.position,
      })),
    parameterGroups: [...vm.parameterGroups]
      .sort((a, b) => a.position - b.position)
      .map((g) => ({
        name: g.name,
        position: g.position,
        parameters: [...g.parameters]
          .sort((a, b) => a.position - b.position)
          .map((p) => ({
            technicalName: p.technicalName,
            displayName: p.displayName,
            paramType: p.paramType,
            defaultValue: p.defaultValue,
            unit: p.unit,
            safeRange: p.safeRange,
            description: p.description,
            orderEffect: p.orderEffect,
            mutability: p.mutability,
            required: p.required,
            position: p.position,
          })),
      })),
    sections: [...vm.sections]
      .sort((a, b) => a.position - b.position)
      .map((sec) => ({
        key: sec.key,
        title: sec.title,
        required: sec.required,
        isCustom: sec.isCustom,
        position: sec.position,
        blocks: [...sec.blocks]
          .sort((a, b) => a.position - b.position)
          .map((b) => ({
            type: b.type,
            position: b.position,
            payload: b.payload,
            parameterGroupIds: [...b.parameterGroupIds].sort(),
            imageAssetId: b.imageAssetId,
          })),
      })),
    // image metadata only — NEVER the signed URL
    images: Object.fromEntries(
      Object.keys(vm.images)
        .sort()
        .map((k) => [k, { altText: vm.images[k].altText, caption: vm.images[k].caption }]),
    ),
    changelog,
  };
}

/** sha256 hex of the canonical projection (key-order-insensitive, order-of-content-sensitive). */
export function computeContentFingerprint(input: FingerprintInput): string {
  return createHash("sha256").update(stableStringify(projectReviewContent(input)), "utf8").digest("hex");
}

/**
 * THE authoritative review fingerprint (Phase 6 slice 4 §10). It is the hash of the whole
 * reviewed content: the resolved `ManualViewModel` **and** its ordered structured changelog
 * (carried on `vm.changelog`, loaded by `SupabaseManualDataSource`). Every workflow gate —
 * DRAFT→TECHNICAL_REVIEW submit, technical APPROVE stale-check, compliance APPROVE stale-check,
 * and the slice-6 publish hash — MUST use this, never `computeContentFingerprint({ vm })` with a
 * hand-omitted changelog.
 */
export function manualReviewFingerprint(vm: ManualViewModel): string {
  return computeContentFingerprint({ vm });
}
