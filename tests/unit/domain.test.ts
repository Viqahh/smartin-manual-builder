import { describe, it, expect } from "vitest";
import { isSemver, parseSemver, compareSemver } from "@/lib/domain/semver";
import { MT_TIMEFRAMES, isMtTimeframe } from "@/lib/domain/timeframes";
import { isValidSymbol, normalizeSymbol, setupDedupeKey } from "@/lib/domain/symbol";
import { parseSetupList, isConfigurationSupported } from "@/lib/domain/setups";
import { parseBlockPayload } from "@/lib/domain/blocks";
import { parseParameterInput } from "@/lib/domain/parameters";
import { CANONICAL_SECTIONS, CANONICAL_SECTION_KEYS } from "@/lib/domain/canonical-sections";
import { resolveWrite } from "@/lib/domain/autosave";

describe("semver (PRD-EA-003, AC-P2-7)", () => {
  it("accepts MAJOR.MINOR.PATCH only", () => {
    expect(isSemver("1.0.0")).toBe(true);
    expect(isSemver("2.1.0")).toBe(true);
    expect(isSemver("1.0")).toBe(false);
    expect(isSemver("v1.0.0")).toBe(false);
    expect(isSemver("1.0.0-beta")).toBe(false);
  });
  it("parses and orders", () => {
    expect(parseSemver("2.1.0")).toEqual({ major: 2, minor: 1, patch: 0 });
    expect(compareSemver("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareSemver("1.2.0", "1.1.9")).toBeGreaterThan(0);
  });
});

describe("MetaTrader timeframe control (AC-P2-9b)", () => {
  it("is exactly the documented set", () => {
    expect([...MT_TIMEFRAMES]).toEqual(["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN1"]);
  });
  it("rejects free text", () => {
    expect(isMtTimeframe("M15")).toBe(true);
    expect(isMtTimeframe("m15")).toBe(false);
    expect(isMtTimeframe("H3")).toBe(false);
    expect(isMtTimeframe("15m")).toBe(false);
  });
});

describe("broker symbol suffixes (AC-P2-9b)", () => {
  it("accepts plain and suffixed symbols", () => {
    expect(isValidSymbol("XAUUSD")).toBe(true);
    expect(isValidSymbol("XAUUSD.m")).toBe(true);
    expect(isValidSymbol("EURUSD.pro")).toBe(true);
    expect(isValidSymbol("US30_raw")).toBe(true);
  });
  it("rejects malformed symbols", () => {
    expect(isValidSymbol("X")).toBe(false);
    expect(isValidSymbol("XAU USD")).toBe(false);
    expect(isValidSymbol("XAUUSD..m")).toBe(false);
  });
  it("upper-cases the base, keeps the suffix as typed", () => {
    expect(normalizeSymbol("xauusd")).toBe("XAUUSD");
    expect(normalizeSymbol("xauusd.m")).toBe("XAUUSD.m");
    expect(normalizeSymbol("eurusd.Pro")).toBe("EURUSD.Pro");
  });
});

describe("Supported Configuration list — explicit only, no inference (GI-10, AC-P2-9/9a)", () => {
  const rows = [
    { symbol: "XAUUSD", timeframe: "M15", position: 0 },
    { symbol: "XAUUSD", timeframe: "H1", position: 1 },
    { symbol: "EURUSD", timeframe: "H1", position: 2 },
  ];

  it("persists the three documented rows as distinct entries", () => {
    const parsed = parseSetupList(rows);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toHaveLength(3);
      expect(parsed.data.map((r) => setupDedupeKey(r.symbol, r.timeframe))).toEqual([
        "XAUUSD::M15",
        "XAUUSD::H1",
        "EURUSD::H1",
      ]);
    }
  });

  it("does NOT imply EURUSD / M15 from EURUSD + M15 appearing separately", () => {
    const stored = [
      { symbol: "XAUUSD", timeframe: "M15", isSupported: true },
      { symbol: "XAUUSD", timeframe: "H1", isSupported: true },
      { symbol: "EURUSD", timeframe: "H1", isSupported: true },
    ];
    expect(isConfigurationSupported(stored, "EURUSD", "H1")).toBe(true);
    expect(isConfigurationSupported(stored, "EURUSD", "M15")).toBe(false);
    expect(isConfigurationSupported(stored, "XAUUSD", "H1")).toBe(true);
  });

  it("rejects a duplicate (symbol, timeframe) inline (AC-P2-9b)", () => {
    const parsed = parseSetupList([
      { symbol: "XAUUSD", timeframe: "M15", position: 0 },
      { symbol: "xauusd", timeframe: "M15", position: 1 },
    ]);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes("sudah ada"))).toBe(true);
    }
  });

  it("rejects an unknown timeframe and an empty list", () => {
    expect(parseSetupList([{ symbol: "XAUUSD", timeframe: "H3", position: 0 }]).success).toBe(false);
    expect(parseSetupList([]).success).toBe(false);
  });

  it("keeps tested_minimum_lot optional and non-negative (GI-12)", () => {
    const ok = parseSetupList([{ symbol: "XAUUSD", timeframe: "M15", position: 0, testedMinimumLot: 0.01 }]);
    expect(ok.success).toBe(true);
    const bad = parseSetupList([{ symbol: "XAUUSD", timeframe: "M15", position: 0, testedMinimumLot: -1 }]);
    expect(bad.success).toBe(false);
  });
});

describe("block payload validation (AC-P2-15, PRD-SEC-010)", () => {
  it("accepts each of the six documented block types", () => {
    const uuid = "00000000-0000-4000-8000-000000000000";
    const doc = { schemaVersion: 1, format: "plain-paragraphs", paragraphs: ["hi"] };
    expect(parseBlockPayload({ type: "text", schemaVersion: 1, content: doc }).ok).toBe(true);
    expect(
      parseBlockPayload({ type: "steps", schemaVersion: 1, steps: [{ title: "a", instruction: "b" }] }).ok,
    ).toBe(true);
    expect(parseBlockPayload({ type: "image", schemaVersion: 1, imageAssetId: uuid }).ok).toBe(true);
    expect(parseBlockPayload({ type: "callout", schemaVersion: 1, tone: "warning", content: doc }).ok).toBe(true);
    expect(parseBlockPayload({ type: "parameterTable", schemaVersion: 1, groupIds: [uuid] }).ok).toBe(true);
    expect(parseBlockPayload({ type: "faq", schemaVersion: 1, question: "q?", answer: doc }).ok).toBe(true);
  });

  it("rejects an unknown block type and a raw-HTML smuggling attempt", () => {
    expect(parseBlockPayload({ type: "script", schemaVersion: 1, html: "<script>x</script>" }).ok).toBe(false);
    const r = parseBlockPayload({ type: "callout", schemaVersion: 1, tone: "danger", content: {} });
    expect(r.ok).toBe(false);
  });
});

describe("EA parameter input (PRD-CNT-006)", () => {
  it("requires a valid technical identifier and known type", () => {
    const good = parseParameterInput({
      displayName: "Fixed Lot",
      technicalName: "FixedLot",
      paramType: "double",
      position: 0,
    });
    expect(good.success).toBe(true);
    expect(parseParameterInput({ displayName: "x", technicalName: "1bad", paramType: "double", position: 0 }).success).toBe(false);
    expect(parseParameterInput({ displayName: "x", technicalName: "ok", paramType: "float", position: 0 }).success).toBe(false);
  });
});

describe("canonical manual structure (PRD-MAN-006, AC-P2-10)", () => {
  it("has 18 ordered sections with unique keys", () => {
    expect(CANONICAL_SECTIONS).toHaveLength(18);
    expect(new Set(CANONICAL_SECTION_KEYS).size).toBe(18);
    expect(CANONICAL_SECTIONS.map((s) => s.order)).toEqual([...Array(18).keys()]);
    expect(CANONICAL_SECTIONS[0].key).toBe("cover");
    expect(CANONICAL_SECTIONS[17].key).toBe("transparency");
  });
  it("marks the unconditionally-required chapters required", () => {
    const req = CANONICAL_SECTIONS.filter((s) => s.required).map((s) => s.key);
    expect(req).toContain("installation");
    expect(req).toContain("parameters");
    expect(req).toContain("changelog");
    // conditional chapters default to not-required (PRD-OQ-005)
    expect(req).not.toContain("interface");
    expect(req).not.toContain("disclaimer");
  });
});

describe("autosave conflict resolution (PRD-MAN-012, AC-P2-20)", () => {
  it("proceeds only when the client's version matches the server's", () => {
    expect(resolveWrite({ expectedVersion: 5, serverVersion: 5 })).toEqual({ proceed: true, reason: "match" });
  });
  it("blocks a stale write instead of overwriting a newer one", () => {
    expect(resolveWrite({ expectedVersion: 4, serverVersion: 7 })).toEqual({ proceed: false, reason: "stale" });
  });
  it("blocks a write against a missing row", () => {
    expect(resolveWrite({ expectedVersion: 1, serverVersion: null })).toEqual({ proceed: false, reason: "missing" });
  });
});
