import { z } from "zod";
import { SEMVER_PATTERN } from "@/lib/domain/semver";
import { setupRowInput } from "@/lib/domain/setups";

export const eaVersionRequirementsSchema = z.object({
  accountType: z.string().trim().max(160).default(""),
  testingDeposit: z.string().trim().max(160).default(""),
  brokerRequirements: z.string().trim().max(2000).default(""),
  vps: z.enum(["Ya", "Tidak", "Disarankan"]).default("Disarankan"),
  dll: z.boolean().default(false),
  webRequest: z.boolean().default(false),
  customIndicators: z.array(z.string().max(200)).max(40).default([]),
  volumeConstraints: z.string().trim().max(1000).default(""),
  /**
   * Explicit legal-scope flag (Phase 5, PRD-OQ-011). Never derived from locale / broker /
   * currency / EA name — an organisation records it deliberately. Default IN_SCOPE so
   * Bappebti checks apply unless someone opts a purely offshore EA out.
   */
  pbkScope: z.enum(["IN_SCOPE", "OUT_OF_SCOPE"]).default("IN_SCOPE"),
  /** EA declares a high-risk operating mode (martingale / unbounded grid / recovery). */
  dangerMode: z.boolean().default(false),
  /** EA declares an on-chart GUI / panel — drives CHK-INTERFACE applicability (Phase 5). */
  gui: z.boolean().default(false),
  /**
   * Verified feature names the manual must explain (Pasal 4(3) / CHK-FITUR-DIJELASKAN). Empty =
   * the check is NOT_APPLICABLE. Never inferred — an organisation records it deliberately.
   */
  verifiedFeatures: z.array(z.string().trim().max(200)).max(40).default([]),
});
export type EaVersionRequirements = z.infer<typeof eaVersionRequirementsSchema>;

export const eaVersionSupportSchema = z.object({
  email: z.string().trim().max(200).default(""),
  phone: z.string().trim().max(60).default(""),
  whatsapp: z.string().trim().max(60).default(""),
  hours: z.string().trim().max(200).default(""),
});
export type EaVersionSupport = z.infer<typeof eaVersionSupportSchema>;

export const eaVersionCreateSchema = z.object({
  eaProductId: z.uuid(),
  version: z.string().trim().regex(SEMVER_PATTERN, "Gunakan format semver, contoh 1.0.0."),
  platform: z.enum(["MT4", "MT5"]),
  releaseDate: z.string().trim().min(1, "Pilih tanggal rilis."),
  requirements: eaVersionRequirementsSchema,
  support: eaVersionSupportSchema,
  // Supported Configuration rows are Phase 2 and mandatory (min 1).
  setups: z.array(setupRowInput).min(1, "Tambahkan minimal satu konfigurasi yang didukung."),
  // optional EA-version -> EA-version parameter definition copy (AC-P2-18c)
  copyParametersFromVersionId: z.uuid().nullable().default(null),
});
export type EaVersionCreateInput = z.infer<typeof eaVersionCreateSchema>;
