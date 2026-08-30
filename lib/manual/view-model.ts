/**
 * Shared, typed Manual View Model (spec §18, PRD-OUT-001).
 *
 * ONE assembler feeds the builder preview now, and the public web manual + PDF later.
 * It is pure over an injected `ManualDataSource` so it is unit-testable without a database
 * and cannot leak another manual's data (AC-P2-12).
 */

import type { BlockType } from "@/lib/domain/blocks";
import type {
  EaParamMutabilityDb,
  EaParamTypeDb,
  MtTimeframeDb,
  ManualStatusDb,
  SectionCompletionStateDb,
} from "@/lib/supabase/database.types";

export type ManualViewModel = {
  manual: { id: string; locale: string };
  manualVersion: {
    id: string;
    version: string;
    status: ManualStatusDb;
    rowVersion: number;
    updatedAt: string;
  };
  eaProduct: { id: string; name: string; slug: string; description: string };
  eaVersion: {
    id: string;
    version: string;
    platform: "MT4" | "MT5";
    releaseDate: string | null;
    requirements: Record<string, unknown>;
    support: Record<string, unknown>;
  };
  organization: { id: string; name: string };
  developer: { name: string } | null;
  /** explicit supported configurations — never inferred (GI-10) */
  supportedSetups: {
    id: string;
    symbol: string;
    timeframe: MtTimeframeDb;
    presetRef: string | null;
    testedMinimumLot: number | null;
    notes: string | null;
    isSupported: boolean;
    position: number;
  }[];
  sections: {
    id: string;
    key: string;
    title: string;
    required: boolean;
    isCustom: boolean;
    position: number;
    completionState: SectionCompletionStateDb;
    rowVersion: number;
    blocks: {
      id: string;
      type: BlockType;
      payload: Record<string, unknown>;
      position: number;
      imageAssetId: string | null;
      parameterGroupIds: string[];
      rowVersion: number;
    }[];
  }[];
  /** parameter definitions belong to the linked EA version (GI-11) */
  parameterGroups: {
    id: string;
    name: string;
    position: number;
    parameters: {
      id: string;
      displayName: string;
      technicalName: string;
      paramType: EaParamTypeDb;
      defaultValue: string | null;
      unit: string | null;
      safeRange: string | null;
      description: string | null;
      orderEffect: string | null;
      mutability: EaParamMutabilityDb;
      required: boolean;
      position: number;
    }[];
  }[];
  images: Record<string, { id: string; altText: string | null; caption: string | null; signedUrl: string | null }>;
  /**
   * Structured changelog entries for this manual version (Phase 6 slice 4). Part of the reviewed
   * content — included in the review fingerprint and read by the Phase 5 `CHK-CHANGELOG-VERSI`
   * rule. Ordered by `position`.
   */
  changelog?: ChangelogEntryVm[];
};

export type ChangelogEntryVm = {
  id: string;
  position: number;
  entryType: "ADDED" | "CHANGED" | "FIXED" | "BREAKING";
  body: string;
  sourceEaVersionId: string | null;
  isFeatureChange: boolean;
  openPositionImpact: string | null;
};

export interface ManualDataSource {
  loadManualVersionByManualId(manualId: string): Promise<ManualViewModel | null>;
}

export async function assembleManualViewModel(
  source: ManualDataSource,
  manualId: string,
): Promise<ManualViewModel | null> {
  if (!manualId) return null;
  const vm = await source.loadManualVersionByManualId(manualId);
  if (!vm) return null;
  // Defensive: the assembler never mixes ids. Sort deterministically for stable rendering.
  vm.sections.sort((a, b) => a.position - b.position);
  vm.sections.forEach((s) => s.blocks.sort((a, b) => a.position - b.position));
  vm.supportedSetups.sort((a, b) => a.position - b.position);
  vm.parameterGroups.sort((a, b) => a.position - b.position);
  vm.parameterGroups.forEach((g) => g.parameters.sort((a, b) => a.position - b.position));
  if (vm.changelog) vm.changelog.sort((a, b) => a.position - b.position);
  return vm;
}

/** Cover / metadata projection used by the builder header, inspector, preview, and cover. */
export function manualIdentity(vm: ManualViewModel) {
  return {
    eaName: vm.eaProduct.name,
    platform: vm.eaVersion.platform,
    eaVersion: vm.eaVersion.version,
    manualVersion: vm.manualVersion.version,
    releaseDate: vm.eaVersion.releaseDate,
    organization: vm.organization.name,
    developer: vm.developer?.name ?? null,
    status: vm.manualVersion.status,
  };
}
