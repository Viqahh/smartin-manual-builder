/**
 * Deterministic post-response grounding guard (PRD-AI-005, AC-P4-7, §13).
 *
 * Prompting is not enough. After a provider responds we check that the proposed output does
 * not INTRODUCE factual tokens that are absent from either the selected text or the supplied
 * facts:
 *   - numeric literals
 *   - MetaTrader timeframe tokens (M1..MN1)         — compared CASE-INSENSITIVELY
 *   - trading symbols (currency-pair / metal / index shaped, with broker suffix) — CASE-INSENSITIVE
 *   - explicit supported symbol/timeframe COMBINATIONS — these must remain exact stored rows;
 *     a pair is never constructed from separately-available values.
 *
 * Normalisation for comparison uppercases internally (so `eurusd`, `EURUSD`, `EurUsd` are one
 * token) but a broker suffix stays significant: `XAUUSD.m` never equals `XAUUSD`, and a stored
 * `XAUUSD.m / M15` never implies `XAUUSD / M15`, `XAUUSD.m / H1`, or `EURUSD.m / M15`.
 *
 * A violation means Accept is disabled and a grounding error is shown; nothing reaches a block.
 */

import type { Fact, GroundingResult, ProposalOutput } from "./types";

const NUMBER_RE = /\d[\d.,]*\d|\d/g;

// MetaTrader chart timeframes. Longest-first so `\bM1\b` never pre-empts `M15`.
const TIMEFRAME_RE = /\b(?:M15|M30|M1|M5|H1|H4|D1|W1|MN1|MN)\b/gi;

// ISO-4217 currency codes + metals that appear in MT forex / metal symbols.
const CCY =
  "USD|EUR|GBP|JPY|CHF|AUD|NZD|CAD|XAU|XAG|XPT|XPD|CNH|CNY|HKD|SGD|SEK|NOK|DKK|PLN|ZAR|TRY|MXN|CZK|HUF|THB|ILS|RUB|INR|KRW|BRL|SAR|AED|NGN";
// A forex/metal pair, optionally broker-suffixed: EURUSD, XAUUSD.m, GBPJPY.pro, USDJPY_raw.
const FX_PAIR_RE = new RegExp(`\\b(?:${CCY})(?:${CCY})(?:[._][A-Za-z0-9]{1,10})?\\b`, "gi");
// Common CFD index / crypto tickers, optionally broker-suffixed.
const INDEX_RE =
  /\b(?:US30|US500|US2000|USTEC|UST100|NAS100|NDX100|SPX500|SPX|GER30|GER40|DE30|DE40|UK100|FTSE100|JP225|JPN225|AUS200|HK50|CHINA50|FRA40|CAC40|EU50|EUSTX50|STOXX50|WS30|BTCUSD|ETHUSD|XRPUSD|LTCUSD|BCHUSD)(?:[._][A-Za-z0-9]{1,10})?\b/gi;

function collectTextFromFacts(facts: Fact[]): string {
  return facts.map((f) => `${f.label} ${stringifyValue(f.value)}`).join(" \n ");
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(stringifyValue).join(" ");
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).map(stringifyValue).join(" ");
  return "";
}

function normNum(s: string): string {
  // unify separators, drop grouping, keep a single decimal point
  const cleaned = s.replace(/[^\d.,]/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let out = cleaned;
  if (lastComma > lastDot) out = cleaned.replace(/\./g, "").replace(",", ".");
  else out = cleaned.replace(/,/g, "");
  const n = Number(out);
  return Number.isFinite(n) ? String(n) : out;
}

function numberSet(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(NUMBER_RE)) out.add(normNum(m[0]));
  return out;
}

/** Case-insensitive token set; every token is upper-cased for comparison. */
function tokenSet(s: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(re)) out.add(m[0].toUpperCase());
  return out;
}

/**
 * Trading-symbol tokens, matched CASE-INSENSITIVELY. A "symbol" is specifically a forex/metal
 * pair (two ISO currency codes) or a known CFD index/crypto ticker, optionally with a broker
 * suffix — never an arbitrary word. Each match is upper-cased; the broker suffix is preserved,
 * so `XAUUSD.m` and `XAUUSD` remain distinct tokens.
 */
function symbolTokenSet(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(FX_PAIR_RE)) out.add(m[0].toUpperCase());
  for (const m of s.matchAll(INDEX_RE)) out.add(m[0].toUpperCase());
  return out;
}

/** Explicit stored setup pairs as "SYMBOL/TIMEFRAME", upper-cased (suffix preserved). */
function allowedSetupPairs(facts: Fact[]): Set<string> {
  const out = new Set<string>();
  for (const f of facts) {
    if (f.kind !== "setup") continue;
    const v = f.value as { symbol?: unknown; timeframe?: unknown };
    if (typeof v.symbol === "string" && typeof v.timeframe === "string") {
      out.add(`${v.symbol.toUpperCase()}/${v.timeframe.toUpperCase()}`);
    }
  }
  return out;
}

function outputText(output: ProposalOutput): string {
  if (output.kind === "text") return output.text;
  if (output.kind === "caption") return output.caption;
  return output.steps.map((s) => [s.title, s.instruction, s.menuPath].filter(Boolean).join(" ")).join("\n");
}

export function validateGrounding(args: {
  selectedText: string;
  facts: Fact[];
  output: ProposalOutput;
}): GroundingResult {
  const sourceText = `${args.selectedText}\n${collectTextFromFacts(args.facts)}`;
  const allowedNumbers = numberSet(sourceText);
  const allowedTimeframes = tokenSet(sourceText, TIMEFRAME_RE);
  const allowedSymbols = symbolTokenSet(sourceText);
  const allowedPairs = allowedSetupPairs(args.facts);

  // symbols the manual actually recognises: those from setup facts, plus any present in source
  const knownSymbols = new Set<string>(allowedSymbols);
  for (const f of args.facts) {
    if (f.kind !== "setup") continue;
    const v = f.value as { symbol?: unknown };
    if (typeof v.symbol === "string") knownSymbols.add(v.symbol.toUpperCase());
  }
  const sourceUpper = sourceText.toUpperCase();

  const text = outputText(args.output);
  const violations: string[] = [];

  for (const n of numberSet(text)) {
    if (!allowedNumbers.has(n)) violations.push(`angka baru yang tidak didukung fakta: "${n}"`);
  }
  for (const tf of tokenSet(text, TIMEFRAME_RE)) {
    if (!allowedTimeframes.has(tf)) violations.push(`timeframe baru yang tidak didukung fakta: "${tf}"`);
  }
  for (const sym of symbolTokenSet(text)) {
    if (!allowedSymbols.has(sym)) violations.push(`simbol baru yang tidak didukung fakta: "${sym}"`);
  }

  // Per line: a KNOWN symbol co-occurring with a timeframe must be an EXACT stored setup row
  // (or appear verbatim in the source). This blocks a fabricated pairing of otherwise-valid
  // values (e.g. XAUUSD + H1 when only XAUUSD/M15 is stored) without flagging ordinary prose.
  for (const line of text.split(/[\n.;]+/)) {
    const syms = [...symbolTokenSet(line)].filter((s) => knownSymbols.has(s));
    const tfs = [...tokenSet(line, TIMEFRAME_RE)];
    for (const s of syms) {
      for (const t of tfs) {
        const pair = `${s}/${t}`;
        if (allowedPairs.has(pair)) continue;
        // present verbatim in the source (escape regex metachars in the symbol, e.g. ".")
        const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`${esc}\\s*/?\\s*${t}\\b`).test(sourceUpper)) continue;
        violations.push(`kombinasi simbol/timeframe tidak ada di Supported Configuration: "${pair}"`);
      }
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations: [...new Set(violations)] };
}
