/**
 * Phase 6 slice 4 — Pasal 8 operational reminder (PRD-OQ-010, resolved: RECORD + REMIND only).
 *
 * Smartin Manual Builder does NOT file the Bappebti report, submit anything, obtain regulatory
 * approval, create a client-approval artefact, or track any of it as completed. It only shows an
 * advisory reminder, and only when the change is in Indonesian PBK scope AND the developer has
 * explicitly marked at least one entry as a feature / behaviour change.
 */
export type Pasal8Entry = { isFeatureChange: boolean };
export type PbkScope = "IN_SCOPE" | "OUT_OF_SCOPE";

/** True ⇔ pbkScope === "IN_SCOPE" AND ≥1 entry is flagged `isFeatureChange`. Never inferred from text. */
export function pasal8ReminderApplies(scope: PbkScope, entries: readonly Pasal8Entry[]): boolean {
  return scope === "IN_SCOPE" && entries.some((e) => e.isFeatureChange === true);
}

/** The exact reminder wording (spec §8). Advisory only — no regulatory-completion claim. */
export const PASAL_8_REMINDER_TEXT =
  "Perubahan fitur/perilaku ini memerlukan tindak lanjut operasional sesuai ketentuan yang " +
  "berlaku: persetujuan klien dan pelaporan kepada Kepala Bappebti, apabila berlaku. Smartin " +
  "Manual Builder hanya menampilkan pengingat dan tidak melakukan proses tersebut.";
