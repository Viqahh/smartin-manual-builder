/**
 * Controlled MetaTrader chart timeframes (docs/DATA_MODEL.md, UI_SPEC §2.3).
 * The Supported Configuration editor MUST use this exact set — free text is rejected (AC-P2-9b).
 */

export const MT_TIMEFRAMES = [
  "M1",
  "M5",
  "M15",
  "M30",
  "H1",
  "H4",
  "D1",
  "W1",
  "MN1",
] as const;

export type MtTimeframe = (typeof MT_TIMEFRAMES)[number];

export function isMtTimeframe(value: string): value is MtTimeframe {
  return (MT_TIMEFRAMES as readonly string[]).includes(value);
}

export const MT_TIMEFRAME_LABELS: Record<MtTimeframe, string> = {
  M1: "M1 · 1 menit",
  M5: "M5 · 5 menit",
  M15: "M15 · 15 menit",
  M30: "M30 · 30 menit",
  H1: "H1 · 1 jam",
  H4: "H4 · 4 jam",
  D1: "D1 · harian",
  W1: "W1 · mingguan",
  MN1: "MN1 · bulanan",
};
