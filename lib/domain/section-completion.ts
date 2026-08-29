/**
 * Editor-level chapter-completion checks (AC-P3-9, AC-P3-11).
 *
 * Pure function shared by the client (disable "Selesai" + show why) and the server
 * (`saveSection` refuses `completionState = "complete"` while a blocker holds). This is NOT
 * the Phase 5 compliance/checklist engine — it is a small set of authoring guards.
 */

import type { BlockType } from "@/lib/domain/blocks";

export type CompletionBlock = {
  type: BlockType;
  payload: Record<string, unknown>;
  imageAssetId: string | null;
};

export type CompletionInput = {
  sectionKey: string;
  blocks: CompletionBlock[];
  /** alt text keyed by image_assets id (from the view model / a DB join). */
  imageAltText: Record<string, string | null | undefined>;
  /** true when the linked EA Version declares a high-risk / danger operating mode. */
  eaDangerMode?: boolean;
};

/** Returns a list of human-readable reasons the chapter cannot be marked "complete". Empty = OK. */
export function sectionCompletionBlockers(input: CompletionInput): string[] {
  const reasons: string[] = [];

  // AC-P3-9 — every image block needs non-empty alt text on its asset.
  const imageMissingAlt = input.blocks.some((b) => {
    if (b.type !== "image") return false;
    const id = b.imageAssetId ?? (b.payload.imageAssetId as string | undefined) ?? "";
    if (!id) return true;
    const alt = input.imageAltText[id];
    return !alt || alt.trim() === "";
  });
  if (imageMissingAlt) {
    reasons.push("Ada gambar tanpa teks alternatif (ALT). Lengkapi ALT sebelum menandai bab selesai.");
  }

  // AC-P3-11 — risk chapter of a danger-mode EA needs a top warning callout.
  if (input.sectionKey === "risk" && input.eaDangerMode) {
    const hasWarning = input.blocks.some((b) => b.type === "callout" && String(b.payload.tone) === "warning");
    if (!hasWarning) {
      reasons.push("EA ini memiliki mode berisiko tinggi — tambahkan callout peringatan di awal bab.");
    }
  }

  return reasons;
}

/** Read the danger-mode flag from an EA Version `requirements` object (forward-compatible). */
export function eaDeclaresDangerMode(requirements: Record<string, unknown> | null | undefined): boolean {
  if (!requirements) return false;
  return (
    requirements.dangerMode === true ||
    requirements.highRisk === true ||
    requirements.riskMode === "danger"
  );
}
