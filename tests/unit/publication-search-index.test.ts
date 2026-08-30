/**
 * Phase 7 slice 2 — public in-page search (spec §30).
 *
 * `buildPublicSearchIndex` is a pure projection of the sanitized ManualViewModel; `searchPublicIndex`
 * is a case-insensitive, whitespace-normalized substring match with a bounded snippet, results in
 * document order. Neither touches the DB or any private field.
 */

import { describe, it, expect } from "vitest";
import { buildPublicSearchIndex, searchPublicIndex } from "@/lib/publication/search-index";
import { richTextFromParagraphs } from "@/lib/domain/rich-text";
import type { ManualViewModel } from "@/lib/manual/view-model";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const sec = (over: Partial<ManualViewModel["sections"][number]>): ManualViewModel["sections"][number] => ({
  id: "x", key: "k", title: "Bab", required: true, isCustom: false, position: 0,
  completionState: "complete", rowVersion: 0, blocks: [], ...over,
});
const blk = (over: Partial<ManualViewModel["sections"][number]["blocks"][number]>) => ({
  id: "b", type: "text" as const, payload: {} as Record<string, unknown>, position: 0,
  imageAssetId: null as string | null, parameterGroupIds: [] as string[], rowVersion: 0, ...over,
});

const LONG = `awal ${"x ".repeat(80)}JARUM ${"y ".repeat(80)} akhir`;

const VM: ManualViewModel = {
  manual: { id: "", locale: "id" },
  manualVersion: { id: "", version: "1.0.0", status: "PUBLISHED", rowVersion: 0, updatedAt: "" },
  eaProduct: { id: "", name: "Vmax EA", slug: "vmax-ea", description: "" },
  eaVersion: { id: "", version: "1.0.0", platform: "MT5", releaseDate: null,
    requirements: { note: "PRIVATE-STORAGE-SENTINEL-XYZ should never be indexed" }, support: {} },
  organization: { id: "", name: "Org" },
  developer: null,
  supportedSetups: [
    { id: "s0", symbol: "XAUUSD", timeframe: "M15", presetRef: "xau.set", testedMinimumLot: 0.01, notes: null, isSupported: true, position: 0 },
  ],
  sections: [
    sec({ key: "cover", title: "Pendahuluan Manual", position: 0, blocks: [
      blk({ type: "text", payload: { type: "text", content: richTextFromParagraphs(["Selamat datang di manual EA ini.", LONG]) } }),
    ] }),
    sec({ key: "install", title: "Langkah Instalasi", position: 1, blocks: [
      blk({ type: "steps", payload: { type: "steps", steps: [
        { title: "Buka MetaTrader", instruction: "Klik menu File", menuPath: "File > Buka Data" },
      ] } }),
    ] }),
    sec({ key: "faq", title: "Tanya Jawab", position: 2, blocks: [
      blk({ type: "faq", payload: { type: "faq", question: "Apakah aman?", answer: richTextFromParagraphs(["Ya, sangat aman digunakan."]) } }),
    ] }),
    sec({ key: "params", title: "Parameter EA", position: 3, blocks: [
      blk({ type: "parameterTable", payload: { type: "parameterTable", groupIds: [0] }, parameterGroupIds: ["pg-0"] }),
    ] }),
    sec({ key: "requirements", title: "Persyaratan", position: 4, blocks: [] }),
    sec({ key: "notes", title: "Catatan", position: 5, blocks: [
      blk({ type: "callout", payload: { type: "callout", tone: "warning", content: richTextFromParagraphs(["Perhatian penting sebelum memakai."]) } }),
    ] }),
  ],
  parameterGroups: [
    { id: "pg-0", name: "Grup Trading", position: 0, parameters: [
      { id: "par-0-0", displayName: "Fixed Lot", technicalName: "FixedLot", paramType: "double", defaultValue: "0.01", unit: null, safeRange: "0.01-1", description: "ukuran lot tetap", orderEffect: "berpengaruh besar", mutability: "before_start", required: true, position: 0 },
    ] },
  ],
  images: {},
  changelog: [{ id: "c0", position: 0, entryType: "ADDED", body: "changelog tidak dirender", sourceEaVersionId: null, isFeatureChange: false, openPositionImpact: null }],
};

const index = buildPublicSearchIndex(VM);
const textOf = (kind: string) => index.filter((e) => e.kind === kind).map((e) => e.text);

describe("buildPublicSearchIndex", () => {
  it("indexes every chapter title in document order", () => {
    expect(index.filter((e) => e.kind === "Bab").map((e) => e.text)).toEqual([
      "Pendahuluan Manual", "Langkah Instalasi", "Tanya Jawab", "Parameter EA", "Persyaratan", "Catatan",
    ]);
  });

  it("extracts visible rich text, steps, FAQ, parameters and supported configs", () => {
    expect(textOf("Teks").join(" ")).toContain("Selamat datang di manual EA");
    expect(textOf("Langkah")[0]).toContain("Buka MetaTrader");
    expect(textOf("Langkah")[0]).toContain("File > Buka Data");
    expect(textOf("FAQ")[0]).toContain("Apakah aman");
    expect(textOf("FAQ")[0]).toContain("sangat aman digunakan");
    expect(textOf("Parameter")[0]).toContain("Grup Trading");
    expect(textOf("Parameter")[0]).toContain("Fixed Lot");
    expect(textOf("Parameter")[0]).toContain("FixedLot");
    expect(textOf("Parameter")[0]).toContain("0.01-1");
    expect(textOf("Parameter")[0]).toContain("ukuran lot tetap");
    expect(textOf("Konfigurasi")[0]).toContain("XAUUSD");
    expect(textOf("Konfigurasi")[0]).toContain("M15");
    expect(textOf("Konfigurasi")[0]).toContain("xau.set");
  });

  it("does not index the changelog, raw jsonb, UUIDs, or private sentinels", () => {
    const json = JSON.stringify(index);
    expect(json).not.toMatch(UUID_RE);
    expect(json).not.toMatch(/PRIVATE-STORAGE-SENTINEL/);
    expect(json).not.toMatch(/changelog tidak dirender/);
    expect(json).not.toMatch(/signedUrl|storageKey|content_hash|reviewer|checklist/i);
    // every entry kind is from the fixed public whitelist
    expect(new Set(index.map((e) => e.kind))).toEqual(
      new Set(["Bab", "Teks", "Catatan", "Langkah", "FAQ", "Parameter", "Konfigurasi"]),
    );
  });
});

describe("searchPublicIndex", () => {
  it("empty / blank query → no results", () => {
    expect(searchPublicIndex(index, "")).toEqual([]);
    expect(searchPublicIndex(index, "   ")).toEqual([]);
  });

  it("case-insensitive and whitespace-normalized", () => {
    const a = searchPublicIndex(index, "fixed lot");
    const b = searchPublicIndex(index, "  FIXED   LOT ");
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it("no match → empty", () => {
    expect(searchPublicIndex(index, "xyzzy-tidak-ada")).toEqual([]);
  });

  it("multiple matches come back in document order", () => {
    const r = searchPublicIndex(index, "manual");
    expect(r.length).toBeGreaterThanOrEqual(2); // ch0 title + ch0 text
    const anchors = r.map((x) => x.anchor);
    expect(anchors).toEqual([...anchors].sort((x, y) => Number(x.slice(8)) - Number(y.slice(8))));
    expect(r[0].anchor).toBe("chapter-0");
  });

  it("snippet is bounded and contains the match", () => {
    const [hit] = searchPublicIndex(index, "JARUM");
    expect(hit).toBeTruthy();
    expect(hit.snippet.toLowerCase()).toContain("jarum");
    expect(hit.snippet.length).toBeLessThanOrEqual(160); // 40 + len + 60 + ellipses
    expect(hit.snippet.startsWith("… ")).toBe(true);
    expect(hit.snippet.endsWith(" …")).toBe(true);
  });

  it("results carry chapter + anchor + kind, never a block id", () => {
    const r = searchPublicIndex(index, "aman");
    expect(r[0]).toMatchObject({ chapter: "Tanya Jawab", anchor: "chapter-2", kind: "FAQ" });
    expect(JSON.stringify(r)).not.toMatch(UUID_RE);
  });
});
