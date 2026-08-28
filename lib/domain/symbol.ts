/**
 * MetaTrader symbol handling for supported configurations (docs/DATA_MODEL.md).
 * The raw broker symbol is stored verbatim, including a prefix/suffix such as
 * `XAUUSD`, `XAUUSD.m`, or `EURUSD.pro`. We do NOT strip suffixes and we NEVER
 * infer a symbol/timeframe pair that has no explicit row (GI-10).
 */

// 2+ alphanumerics, optionally followed by one `.` or `_` separated suffix segment.
export const SYMBOL_PATTERN = /^[A-Za-z0-9]{2,}([._][A-Za-z0-9]+)?$/;

export function isValidSymbol(value: string): boolean {
  return SYMBOL_PATTERN.test(value.trim());
}

/** Upper-cases the base while preserving a lower/mixed-case broker suffix as typed. */
export function normalizeSymbol(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^([A-Za-z0-9]{2,})([._][A-Za-z0-9]+)?$/);
  if (!match) return trimmed;
  const [, base, suffix] = match;
  return suffix ? `${base.toUpperCase()}${suffix}` : base.toUpperCase();
}

/** Deterministic key for the `(symbol, timeframe)` uniqueness rule. */
export function setupDedupeKey(symbol: string, timeframe: string): string {
  return `${normalizeSymbol(symbol)}::${timeframe}`;
}
