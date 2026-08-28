/**
 * EA parameter definitions — OWNED BY EA VERSION (docs/DATA_MODEL.md, PRD-CNT-010, GI-11).
 * Never copied into a manual version. `parameterTable` blocks reference these groups.
 */

import { z } from "zod";

export const EA_PARAM_TYPES = ["bool", "int", "double", "string", "enum", "color"] as const;
export type EaParamType = (typeof EA_PARAM_TYPES)[number];

export const EA_PARAM_MUTABILITY = ["before_start", "may_change_live", "needs_reattach"] as const;
export type EaParamMutability = (typeof EA_PARAM_MUTABILITY)[number];

export const parameterGroupInput = z.object({
  name: z.string().trim().min(1, "Nama grup wajib diisi.").max(120),
  position: z.number().int().min(0),
});
export type ParameterGroupInput = z.infer<typeof parameterGroupInput>;

export const parameterInput = z.object({
  displayName: z.string().trim().min(1, "Nama terminal wajib diisi.").max(160),
  technicalName: z
    .string()
    .trim()
    .min(1, "Nama teknis wajib diisi.")
    .max(160)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Nama teknis harus berupa identifier yang valid."),
  paramType: z.enum(EA_PARAM_TYPES),
  defaultValue: z.string().max(200).nullable().default(null),
  unit: z.string().max(60).nullable().default(null),
  minValue: z.string().max(120).nullable().default(null),
  maxValue: z.string().max(120).nullable().default(null),
  enumOptions: z.array(z.string().max(120)).max(64).default([]),
  safeRange: z.string().max(240).nullable().default(null),
  description: z.string().max(2000).nullable().default(null),
  orderEffect: z.string().max(2000).nullable().default(null),
  mutability: z.enum(EA_PARAM_MUTABILITY).default("before_start"),
  notes: z.string().max(1000).nullable().default(null),
  required: z.boolean().default(false),
  position: z.number().int().min(0),
});
export type ParameterInput = z.infer<typeof parameterInput>;

export function parseParameterInput(input: unknown) {
  return parameterInput.safeParse(input);
}
