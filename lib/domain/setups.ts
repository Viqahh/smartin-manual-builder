/**
 * Supported Configuration (`ea_version_setups`) — OWNED BY EA VERSION.
 * Explicit `symbol × timeframe` rows only. The system never infers a combination
 * from independently listed values (GI-10). Uniqueness: (ea_version_id, symbol, timeframe).
 */

import { z } from "zod";
import { MT_TIMEFRAMES } from "./timeframes";
import { SYMBOL_PATTERN, normalizeSymbol, setupDedupeKey } from "./symbol";

export const BROKER_MIN_LOT_NOTE_ID =
  "Minimum lot aktual ditentukan oleh spesifikasi simbol pada broker.";

export const setupRowInput = z.object({
  symbol: z
    .string()
    .trim()
    .min(2, "Masukkan simbol.")
    .max(40)
    .regex(SYMBOL_PATTERN, "Simbol tidak valid (contoh: XAUUSD, XAUUSD.m, EURUSD.pro).")
    .transform(normalizeSymbol),
  timeframe: z.enum(MT_TIMEFRAMES),
  presetRef: z.string().trim().max(160).nullable().default(null),
  // Developer test data — NOT a broker minimum (GI-12). Nullable, independent of broker rules.
  testedMinimumLot: z
    .number()
    .min(0, "Tidak boleh negatif.")
    .max(1000)
    .nullable()
    .default(null),
  notes: z.string().trim().max(500).nullable().default(null),
  isSupported: z.boolean().default(true),
  position: z.number().int().min(0),
});
export type SetupRowInput = z.infer<typeof setupRowInput>;

export const setupListInput = z
  .array(setupRowInput)
  .min(1, "Tambahkan minimal satu konfigurasi yang didukung.")
  .superRefine((rows, ctx) => {
    const seen = new Map<string, number>();
    rows.forEach((row, index) => {
      const key = setupDedupeKey(row.symbol, row.timeframe);
      const first = seen.get(key);
      if (first !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [index, "symbol"],
          message: `Konfigurasi ${row.symbol} / ${row.timeframe} sudah ada (baris ${first + 1}).`,
        });
      } else {
        seen.set(key, index);
      }
    });
  });
export type SetupListInput = z.infer<typeof setupListInput>;

export function parseSetupList(input: unknown) {
  return setupListInput.safeParse(input);
}

/**
 * Explicit-only membership check. Given the stored rows, is this exact pair supported?
 * There is deliberately no "derive from distinct symbols/timeframes" path.
 */
export function isConfigurationSupported(
  rows: { symbol: string; timeframe: string; isSupported: boolean }[],
  symbol: string,
  timeframe: string,
): boolean {
  const key = setupDedupeKey(symbol, timeframe);
  return rows.some((r) => r.isSupported && setupDedupeKey(r.symbol, r.timeframe) === key);
}
