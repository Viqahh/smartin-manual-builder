/**
 * Phase 4 — grounded AI assistant domain tests (spec §29, §22/§23, AC-P4-1/3/4/5/6/7/10).
 *
 * Pure + deterministic: no network, no credentials, no Supabase. The configured provider is
 * exercised through a fake in-memory transport.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `lib/ai/providers/index.ts` + the anthropic transport are `import "server-only"`.
vi.mock("server-only", () => ({}));

import type { ManualViewModel } from "@/lib/manual/view-model";
import { buildFactBundle } from "@/lib/ai/fact-bundle";
import { buildGroundedRequest, assertGroundedRequestShape, serializeGroundedRequest } from "@/lib/ai/grounded-request";
import { hashAiRequest, hashPayload } from "@/lib/ai/hash";
import { validateGrounding } from "@/lib/ai/grounding";
import { validateFactReferences } from "@/lib/ai/fact-references";
import { MockAIProvider } from "@/lib/ai/providers/mock";
import { ConfiguredAIProvider } from "@/lib/ai/providers/configured";
import { AiProviderError, type Fact, type GroundedRequest, type RevisionProposal } from "@/lib/ai/types";
import type { AiTransport } from "@/lib/ai/transport/types";
import { AiTransportError } from "@/lib/ai/transport/types";
import { resolveProviderMode, getAIProvider, currentProviderMode, __resetAIProviderForTests } from "@/lib/ai/providers";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function richDoc(text: string) {
  return {
    schemaVersion: 2,
    format: "doc",
    doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  };
}

function makeVm(over: Partial<ManualViewModel> = {}): ManualViewModel {
  const vm: ManualViewModel = {
    manual: { id: "11111111-1111-4111-8111-111111111111", locale: "id" },
    manualVersion: {
      id: "22222222-2222-4222-8222-222222222222",
      version: "1.0.0",
      status: "DRAFT",
      rowVersion: 3,
      updatedAt: "2026-01-01T00:00:00Z",
    },
    eaProduct: { id: "p1", name: "Smartin Vmax", slug: "smartin-vmax", description: "" },
    eaVersion: {
      id: "ev1",
      version: "2.1.0",
      platform: "MT5",
      releaseDate: "2026-01-01",
      requirements: { accountType: "Hedging", testingDeposit: "USD 500" },
      support: {},
    },
    organization: { id: "org-a", name: "Org A" },
    developer: { name: "Dev" },
    supportedSetups: [
      {
        id: "setup-xau-m15",
        symbol: "XAUUSD",
        timeframe: "M15",
        presetRef: "vmax-xau.set",
        testedMinimumLot: 0.01,
        notes: null,
        isSupported: true,
        position: 0,
      },
      {
        id: "setup-eur-h1",
        symbol: "EURUSD",
        timeframe: "H1",
        presetRef: null,
        testedMinimumLot: null,
        notes: null,
        isSupported: true,
        position: 1,
      },
    ],
    sections: [
      {
        id: "sec-install",
        key: "installation",
        title: "Instalasi",
        required: true,
        isCustom: false,
        position: 0,
        completionState: "in_progress",
        rowVersion: 1,
        blocks: [
          {
            id: "blk-text",
            type: "text",
            payload: { type: "text", schemaVersion: 1, content: richDoc("pasang file ex5 ke folder Experts lalu restart terminal") },
            position: 0,
            imageAssetId: null,
            parameterGroupIds: [],
            rowVersion: 1,
          },
          {
            id: "blk-img",
            type: "image",
            payload: { type: "image", schemaVersion: 1, imageAssetId: "img-1", caption: "" },
            position: 1,
            imageAssetId: "img-1",
            parameterGroupIds: [],
            rowVersion: 1,
          },
        ],
      },
    ],
    parameterGroups: [
      {
        id: "grp-risk",
        name: "Risiko",
        position: 0,
        parameters: [
          {
            id: "par-lot",
            displayName: "Lot Tetap",
            technicalName: "FixedLot",
            paramType: "double",
            defaultValue: "0.01",
            unit: "lot",
            safeRange: "0.01-0.10",
            description: null,
            orderEffect: null,
            mutability: "before_start",
            required: false,
            position: 0,
          },
        ],
      },
    ],
    images: { "img-1": { id: "img-1", altText: "Jendela Navigator MetaTrader", caption: null, signedUrl: "https://signed.example/secret.png" } },
    ...over,
  };
  return vm;
}

const BLOCK_CTX = { blockId: "blk-text", blockType: "text" as const, targetField: "content" as const };

// ---------------------------------------------------------------------------
// GroundedRequest — exactly four top-level keys (§4, AC-P4-4)
// ---------------------------------------------------------------------------

describe("GroundedRequest contract", () => {
  const vm = makeVm();
  const facts = buildFactBundle(vm, vm.sections[0], BLOCK_CTX);

  it("has exactly { selectedText, factBundle, locale, operation }", () => {
    const req = buildGroundedRequest({ selectedText: "abc", factBundle: facts, locale: "id", operation: "improveText" });
    expect(Object.keys(req).sort()).toEqual(["factBundle", "locale", "operation", "selectedText"]);
    expect(Object.isFrozen(req)).toBe(true);
  });

  it("rejects any extra top-level key", () => {
    const bad = { selectedText: "a", factBundle: facts, locale: "id", operation: "improveText", orgId: "org-a" };
    expect(() => assertGroundedRequestShape(bad)).toThrow(/forbidden extra context/i);
  });

  it("rejects a missing key", () => {
    expect(() => assertGroundedRequestShape({ selectedText: "a", factBundle: facts, locale: "id" })).toThrow(/missing required keys/i);
  });

  it("serialises to JSON containing only the four keys and no signed URL / key", () => {
    const req = buildGroundedRequest({ selectedText: "pasang file", factBundle: facts, locale: "id", operation: "improveText" });
    const json = serializeGroundedRequest(req);
    expect(json).not.toContain("signed.example");
    expect(json).not.toContain("signedUrl");
    expect(JSON.parse(json)).toHaveProperty("factBundle.facts");
  });
});

// ---------------------------------------------------------------------------
// FactBundle allowlist (§5, AC-P4-4)
// ---------------------------------------------------------------------------

describe("FactBundle", () => {
  const vm = makeVm();
  const bundle = buildFactBundle(vm, vm.sections[0], BLOCK_CTX);
  const imgBundle = buildFactBundle(vm, vm.sections[0], { blockId: "blk-img", blockType: "image", targetField: "caption" });
  const ids = bundle.facts.map((f) => f.id);

  it("keeps each supported configuration as ONE paired setup fact (GI-10)", () => {
    const setups = bundle.facts.filter((f) => f.kind === "setup");
    expect(setups).toHaveLength(2);
    for (const s of setups) {
      expect(s.value).toHaveProperty("symbol");
      expect(s.value).toHaveProperty("timeframe");
    }
    // no fact flattens symbols or timeframes into a standalone list
    expect(ids).not.toContain("symbols");
    expect(ids).not.toContain("timeframes");
  });

  it("includes only linked-EA parameter groups + parameters", () => {
    expect(ids).toContain("parameterGroup:grp-risk");
    expect(ids).toContain("parameter:par-lot");
  });

  it("exposes image metadata only — never a signed URL or binary", () => {
    const img = imgBundle.facts.find((f) => f.kind === "image");
    expect(img?.value).toEqual({ altText: "Jendela Navigator MetaTrader", caption: null });
    expect(JSON.stringify(imgBundle)).not.toContain("signed.example");
    expect(JSON.stringify(imgBundle)).not.toMatch(/signedUrl|https?:\/\//);
  });

  it("includes the current block's allowlisted plain text, sliced", () => {
    const bc = bundle.facts.find((f) => f.id === "blockContent:current");
    expect(typeof bc?.value).toBe("string");
    expect(String(bc?.value)).toContain("folder Experts");
  });

  it("never carries org membership, other manuals, auth, or DB dump", () => {
    const blob = JSON.stringify(bundle);
    expect(blob).not.toMatch(/member_org_ids|auth\.uid|access_token|service_role|jwt/i);
  });
});

// ---------------------------------------------------------------------------
// Canonical input hash / idempotency (§22, §23, AC-P4-10)
// ---------------------------------------------------------------------------

describe("hashAiRequest", () => {
  const vm = makeVm();
  const facts = buildFactBundle(vm, vm.sections[0], BLOCK_CTX);
  const target = { manualVersionId: vm.manualVersion.id, sectionId: "sec-install", blockId: "blk-text", targetField: "content" };
  const base = buildGroundedRequest({ selectedText: "Pasang  file", factBundle: facts, locale: "id", operation: "improveText" });

  it("is stable across fact-bundle object key order (same element order)", () => {
    const reordered: GroundedRequest = {
      operation: "improveText",
      locale: "id",
      // same facts, same order — only each fact object's KEY order is shuffled
      factBundle: { facts: facts.facts.map((f) => ({ source: f.source, value: f.value, label: f.label, kind: f.kind, id: f.id })) },
      selectedText: "Pasang  file",
    } as GroundedRequest;
    expect(hashAiRequest(reordered, target)).toBe(hashAiRequest(base, target));
  });

  it("ignores insignificant whitespace / case in locale", () => {
    const b2 = buildGroundedRequest({ selectedText: "Pasang file", factBundle: facts, locale: " ID ", operation: "improveText" });
    const b1 = buildGroundedRequest({ selectedText: "Pasang   file", factBundle: facts, locale: "id", operation: "improveText" });
    expect(hashAiRequest(b1, target)).toBe(hashAiRequest(b2, target));
  });

  it("changes when operation, selectedText, or target identity changes", () => {
    const h0 = hashAiRequest(base, target);
    expect(hashAiRequest(buildGroundedRequest({ selectedText: "Pasang file", factBundle: facts, locale: "id", operation: "simplifyText" }), target)).not.toBe(h0);
    expect(hashAiRequest(buildGroundedRequest({ selectedText: "different", factBundle: facts, locale: "id", operation: "improveText" }), target)).not.toBe(h0);
    expect(hashAiRequest(base, { ...target, blockId: "blk-other" })).not.toBe(h0);
  });

  it("hashPayload is key-order independent", () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });
});

// ---------------------------------------------------------------------------
// Grounding guard (§13, §36, AC-P4-7)
// ---------------------------------------------------------------------------

describe("validateGrounding", () => {
  const vm = makeVm();
  const facts = buildFactBundle(vm, vm.sections[0], BLOCK_CTX).facts;

  it("allows a lexical rewrite that introduces no new factual tokens (re-case + punctuation only)", () => {
    const r = validateGrounding({
      selectedText: "pasang file ex5 ke folder Experts lalu restart terminal",
      facts,
      output: { kind: "text", text: "Pasang file ex5 ke folder Experts lalu restart terminal." },
    });
    expect(r.ok).toBe(true);
  });

  it("blocks a new unsupported number", () => {
    const r = validateGrounding({ selectedText: "pasang file", facts, output: { kind: "text", text: "Profit 90% dalam 30 hari." } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(" ")).toMatch(/angka baru/);
  });

  it("blocks a new symbol and a new timeframe", () => {
    const r = validateGrounding({ selectedText: "pasang file", facts, output: { kind: "text", text: "Gunakan GBPJPY pada H4." } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.join(" ")).toMatch(/simbol baru/);
      expect(r.violations.join(" ")).toMatch(/timeframe baru/);
    }
  });

  it("blocks an unlisted symbol/timeframe COMBINATION built from otherwise-known values", () => {
    // XAUUSD and H1 both appear in facts, but XAUUSD/H1 is NOT a stored setup row.
    const r = validateGrounding({ selectedText: "EA mendukung", facts, output: { kind: "text", text: "EA mendukung XAUUSD H1." } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(" ")).toMatch(/kombinasi simbol\/timeframe/);
  });

  it("allows an exact stored combination (XAUUSD / M15)", () => {
    const r = validateGrounding({
      selectedText: "Konfigurasi XAUUSD M15 telah diuji sepenuhnya",
      facts,
      output: { kind: "text", text: "Konfigurasi XAUUSD M15 telah diuji." },
    });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Grounding — case-insensitive symbol/timeframe normalisation (AC-P4-7)
// ---------------------------------------------------------------------------

describe("validateGrounding — case-insensitive symbol/timeframe normalisation", () => {
  const setupFact = (id: string, symbol: string, timeframe: string): Fact => ({
    id,
    kind: "setup",
    label: `Konfigurasi: ${symbol} / ${timeframe}`,
    value: { symbol, timeframe, testedMinimumLot: null, presetRef: null, notes: null, isSupported: true },
    source: "Supported Configuration",
  });
  // fact bundle knows ONLY XAUUSD / M15
  const xauM15: Fact[] = [setupFact("s1", "XAUUSD", "M15")];
  const g = (facts: Fact[], text: string, selectedText = "") =>
    validateGrounding({ selectedText, facts, output: { kind: "text", text } });

  it("1. blocks an unsupported lowercase symbol", () => {
    const r = g(xauM15, "Aktifkan EA pada eurusd.");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(" ")).toMatch(/simbol baru.*EURUSD/i);
  });

  it("2. blocks an unsupported mixed-case symbol", () => {
    const r = g(xauM15, "Aktifkan EA pada EurUsd.");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(" ")).toMatch(/simbol baru.*EURUSD/i);
  });

  it("3. blocks a lowercase timeframe", () => {
    const r = g(xauM15, "Jalankan EA pada h1.");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(" ")).toMatch(/timeframe baru.*H1/i);
  });

  it("4. blocks a mixed-case symbol + timeframe pair", () => {
    const r = g(xauM15, "EA berjalan di EurUsd / h1.");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.join(" ")).toMatch(/simbol baru.*EURUSD/i);
      expect(r.violations.join(" ")).toMatch(/timeframe baru.*H1/i);
    }
  });

  it("5. keeps broker-suffix exactness after normalisation", () => {
    const xauDotM = [setupFact("s1", "XAUUSD.m", "M15")];
    // bare XAUUSD (no suffix) is NOT the stored XAUUSD.m
    expect(g(xauDotM, "Gunakan XAUUSD pada M15.").ok).toBe(false);
    // a different suffixed pair is not implied
    expect(g(xauDotM, "Gunakan EURUSD.m pada M15.").ok).toBe(false);
    // right symbol, wrong timeframe
    expect(g(xauDotM, "Gunakan XAUUSD.m pada H1.").ok).toBe(false);
    // exact stored suffixed pair, different casing → allowed
    expect(g(xauDotM, "Konfigurasi xauusd.m pada m15 sudah diuji.").ok).toBe(true);
  });

  it("6. allows a supported pair when only the casing differs", () => {
    const r = g(xauM15, "Konfigurasi xauusd pada m15 telah teruji.");
    expect(r.ok).toBe(true);
  });

  it("7. rejects an unsupported combination of two individually-known values", () => {
    const facts = [setupFact("s1", "XAUUSD", "M15"), setupFact("s2", "EURUSD", "H1")];
    const r = g(facts, "EA mendukung XAUUSD H1.", "EA mendukung");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join(" ")).toMatch(/kombinasi simbol\/timeframe.*XAUUSD\/H1/);
  });

  it("8. rejects a fabricated lowercase symbol together with a fabricated number", () => {
    const r = g(xauM15, "Gunakan gbpjpy dengan target 500 pip.");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.join(" ")).toMatch(/simbol baru.*GBPJPY/i);
      expect(r.violations.join(" ")).toMatch(/angka baru.*500/);
    }
  });
});

// ---------------------------------------------------------------------------
// Fact references (§6)
// ---------------------------------------------------------------------------

describe("validateFactReferences", () => {
  const vm = makeVm();
  const facts = buildFactBundle(vm, vm.sections[0], BLOCK_CTX).facts;
  const proposal = (refs: string[]): RevisionProposal => ({
    status: "PROPOSAL",
    operation: "improveText",
    output: { kind: "text", text: "x" },
    factReferences: refs,
  });

  it("accepts references that all exist in the bundle", () => {
    expect(validateFactReferences(proposal(["ea:name", "blockContent:current"]), facts).ok).toBe(true);
  });

  it("rejects a provider-invented id", () => {
    const r = validateFactReferences(proposal(["setup:does-not-exist"]), facts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.unknownRefs).toEqual(["setup:does-not-exist"]);
  });
});

// ---------------------------------------------------------------------------
// AIProvider interface — mock + configured, all methods (§7, §29, AC-P4-1)
// ---------------------------------------------------------------------------

function fakeTransport(reply: string | (() => Promise<string>)): AiTransport {
  return {
    label: "fake",
    model: "fake-model-1",
    complete: typeof reply === "string" ? async () => reply : async () => reply(),
  };
}

const vm = makeVm();
const factBundle = buildFactBundle(vm, vm.sections[0], BLOCK_CTX);
// a bundle whose target block has no persisted content (nothing to fall back on)
const emptyBundle = buildFactBundle(vm, vm.sections[0], { blockId: null, blockType: "text", targetField: "content" });
// a bundle targeting the image block (carries the image-metadata fact)
const captionBundle = buildFactBundle(vm, vm.sections[0], { blockId: "blk-img", blockType: "image", targetField: "caption" });
const groundedFor = (op: RevisionProposal["operation"], selectedText: string): GroundedRequest =>
  buildGroundedRequest({ selectedText, factBundle, locale: "id", operation: op });

describe("MockAIProvider", () => {
  const p = new MockAIProvider();

  it("advertises itself unmistakably as mock", () => {
    expect(p.mode).toBe("mock");
    expect(p.label).toBe("Mock AI");
  });

  it("improveText / simplifyText / technicalRewrite return grounded PROPOSALs", async () => {
    for (const op of ["improveText", "simplifyText", "technicalRewrite"] as const) {
      const res = await p[op](groundedFor(op, "pasang  file ex5 ke folder experts lalu restart terminal"));
      expect(res.status).toBe("PROPOSAL");
      if (res.status === "PROPOSAL") {
        expect(res.output.kind).toBe("text");
        const g = validateGrounding({ selectedText: "pasang file ex5 ke folder experts lalu restart terminal", facts: factBundle.facts, output: res.output });
        expect(g.ok).toBe(true);
        for (const ref of res.factReferences) expect(factBundle.facts.map((f) => f.id)).toContain(ref);
      }
    }
  });

  it("returns ADDITIONAL_INFORMATION_REQUIRED instead of inventing when the source is too thin", async () => {
    const res = await p.improveText(
      buildGroundedRequest({ selectedText: "x", factBundle: emptyBundle, locale: "id", operation: "improveText" }),
    );
    expect(res.status).toBe("ADDITIONAL_INFORMATION_REQUIRED");
    if (res.status === "ADDITIONAL_INFORMATION_REQUIRED") {
      expect(res.missingFacts.length).toBeGreaterThan(0);
      expect(res.missingFacts[0]).toHaveProperty("label");
    }
  });

  it("generateSteps produces a structured steps proposal", async () => {
    const res = await p.generateSteps(
      groundedFor("generateSteps", "Buka MetaTrader\nSalin file ke folder Experts\nMulai ulang terminal"),
    );
    expect(res.status).toBe("PROPOSAL");
    if (res.status === "PROPOSAL" && res.output.kind === "steps") {
      expect(res.output.steps.length).toBeGreaterThanOrEqual(3);
      expect(res.output.steps[0]).toHaveProperty("title");
      expect(res.output.steps[0]).toHaveProperty("instruction");
    }
  });

  it("generateCaption uses image metadata, or asks for ALT when there is none", async () => {
    const ok = await p.generateCaption(
      buildGroundedRequest({ selectedText: "", factBundle: captionBundle, locale: "id", operation: "generateCaption" }),
    );
    expect(ok.status).toBe("PROPOSAL");
    if (ok.status === "PROPOSAL" && ok.output.kind === "caption") {
      expect(ok.output.caption.toLowerCase()).toContain("navigator");
    }

    const noAltVm = makeVm({ images: { "img-1": { id: "img-1", altText: null, caption: null, signedUrl: null } } });
    const noAltBundle = buildFactBundle(noAltVm, noAltVm.sections[0], { blockId: "blk-img", blockType: "image", targetField: "caption" });
    const air = await p.generateCaption(buildGroundedRequest({ selectedText: "", factBundle: noAltBundle, locale: "id", operation: "generateCaption" }));
    expect(air.status).toBe("ADDITIONAL_INFORMATION_REQUIRED");
  });

  it("detectClaims delegates to the deterministic scanner", async () => {
    const findings = await p.detectClaims({ text: "EA ini menjamin profit pasti setiap bulan.", locale: "id" });
    expect(findings.some((f) => f.category === "CLAIM-PROFIT-GUARANTEE")).toBe(true);
  });
});

describe("ConfiguredAIProvider (fake transport)", () => {
  it("advertises configured mode + a safe label/model", () => {
    const p = new ConfiguredAIProvider(fakeTransport("{}"));
    expect(p.mode).toBe("configured");
    expect(p.label).toBe("fake");
    expect(p.model).toBe("fake-model-1");
  });

  it("sends ONLY the 4-key GroundedRequest as the user message, with no key/secret", async () => {
    let captured: { system: string; user: string } | null = null;
    const transport: AiTransport = {
      label: "fake",
      model: "m",
      complete: async (a) => {
        captured = a;
        return JSON.stringify({ status: "PROPOSAL", operation: "improveText", output: { kind: "text", text: "Pasang file." }, factReferences: [] });
      },
    };
    const p = new ConfiguredAIProvider(transport);
    await p.improveText(groundedFor("improveText", "pasang file"));
    expect(captured).not.toBeNull();
    const userObj = JSON.parse(captured!.user);
    expect(Object.keys(userObj).sort()).toEqual(["factBundle", "locale", "operation", "selectedText"]);
    expect(captured!.user).not.toMatch(/api[_-]?key|sb_secret|authorization/i);
    expect(captured!.system).toMatch(/TIDAK TEPERCAYA/); // untrusted-content instruction present
  });

  it("parses a valid PROPOSAL (even wrapped in a ```json fence) and normalises the operation", async () => {
    const p = new ConfiguredAIProvider(
      fakeTransport("```json\n" + JSON.stringify({ status: "PROPOSAL", operation: "simplifyText", output: { kind: "text", text: "Pasang file." }, factReferences: [] }) + "\n```"),
    );
    const res = await p.improveText(groundedFor("improveText", "pasang file"));
    expect(res.status).toBe("PROPOSAL");
    if (res.status === "PROPOSAL") expect(res.operation).toBe("improveText");
  });

  it("passes ADDITIONAL_INFORMATION_REQUIRED through untouched", async () => {
    const p = new ConfiguredAIProvider(
      fakeTransport(JSON.stringify({ status: "ADDITIONAL_INFORMATION_REQUIRED", missingFacts: [{ label: "Menu path" }] })),
    );
    const res = await p.generateSteps(groundedFor("generateSteps", "pasang file"));
    expect(res.status).toBe("ADDITIONAL_INFORMATION_REQUIRED");
  });

  it("rejects malformed JSON as MALFORMED_RESPONSE (never a silent write)", async () => {
    const p = new ConfiguredAIProvider(fakeTransport("not json at all"));
    await expect(p.improveText(groundedFor("improveText", "pasang file"))).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("rejects a schema-invalid PROPOSAL as MALFORMED_RESPONSE", async () => {
    const p = new ConfiguredAIProvider(fakeTransport(JSON.stringify({ status: "PROPOSAL", output: { kind: "text" } })));
    await expect(p.improveText(groundedFor("improveText", "pasang file"))).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("maps a transport timeout to AiProviderError TIMEOUT", async () => {
    const p = new ConfiguredAIProvider(
      fakeTransport(async () => {
        throw new AiTransportError("TIMEOUT", "timed out");
      }),
    );
    await expect(p.improveText(groundedFor("improveText", "pasang file"))).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("maps transport unavailability to PROVIDER_UNAVAILABLE", async () => {
    const p = new ConfiguredAIProvider(
      fakeTransport(async () => {
        throw new AiTransportError("BAD_STATUS", "HTTP 500");
      }),
    );
    await expect(p.improveText(groundedFor("improveText", "pasang file"))).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("detectClaims is deterministic (does NOT call the transport)", async () => {
    const transport = fakeTransport(async () => {
      throw new Error("transport must not be used for detectClaims");
    });
    const p = new ConfiguredAIProvider(transport);
    const findings = await p.detectClaims({ text: "Dijamin tanpa risiko sama sekali.", locale: "id" });
    expect(findings.some((f) => f.category === "CLAIM-RISK-FREE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Provider selection (§8, AC-P4-3)
// ---------------------------------------------------------------------------

describe("provider selection", () => {
  const OLD = { p: process.env.AI_PROVIDER, k: process.env.AI_API_KEY };
  beforeEach(() => __resetAIProviderForTests());
  afterEach(() => {
    process.env.AI_PROVIDER = OLD.p;
    process.env.AI_API_KEY = OLD.k;
    __resetAIProviderForTests();
  });

  it("no env → mock", () => {
    expect(resolveProviderMode({})).toEqual({ mode: "mock" });
    expect(resolveProviderMode({ AI_PROVIDER: "mock" })).toEqual({ mode: "mock" });
  });

  it("both present → configured", () => {
    expect(resolveProviderMode({ AI_PROVIDER: "anthropic", AI_API_KEY: "sk-x" })).toEqual({ mode: "configured" });
  });

  it("exactly one present → explicit config error, no silent fallback", () => {
    expect(resolveProviderMode({ AI_PROVIDER: "anthropic" })).toHaveProperty("error");
    expect(resolveProviderMode({ AI_API_KEY: "sk-x" })).toHaveProperty("error");
  });

  it("getAIProvider() returns the mock when unconfigured", () => {
    delete process.env.AI_PROVIDER;
    delete process.env.AI_API_KEY;
    __resetAIProviderForTests();
    expect(getAIProvider().mode).toBe("mock");
    expect(currentProviderMode()).toBe("mock");
  });

  it("getAIProvider() throws CONFIG on a half-configured env", () => {
    process.env.AI_PROVIDER = "anthropic";
    delete process.env.AI_API_KEY;
    __resetAIProviderForTests();
    expect(() => getAIProvider()).toThrow(AiProviderError);
    expect(currentProviderMode()).toBe("config-error");
  });

  it("getAIProvider() throws CONFIG for an unsupported provider name", () => {
    process.env.AI_PROVIDER = "some-other-vendor";
    process.env.AI_API_KEY = "sk-x";
    __resetAIProviderForTests();
    expect(() => getAIProvider()).toThrow(/Unsupported AI_PROVIDER/);
  });
});
