/**
 * Phase 8B-5 (live audit finding) — `listManuals` must return exactly one row per manual, even
 * when a manual has more than one manual_version (e.g. an ARCHIVED v1 + a PUBLISHED v2). The
 * underlying query is one row per version; without dedup this produced duplicate `manualId`s —
 * a React duplicate-key console error on Dashboard "Manual terbaru" and `/manuals`, and (per the
 * function's own contract) the wrong displayed row count.
 *
 * Phase 8B-5 hygiene follow-up — the selected row per manual MUST be the highest version number,
 * decided deterministically from `manualVersion` itself, never from `updatedAt` or from
 * incidental input/row order (a DB query's row order for ties is not guaranteed).
 */
import { describe, it, expect } from "vitest";
import { dedupeLatestManualVersion, type ManualListRow } from "@/lib/manual/list-dedupe";

const row = (over: Partial<ManualListRow>): ManualListRow => ({
  manualId: "m1",
  eaName: "VMax EA",
  platform: "MT5",
  eaVersion: "1.0.0",
  manualVersion: "1.0.0",
  status: "DRAFT",
  updatedAt: "2026-01-01T00:00:00Z",
  sectionsTotal: 0,
  ...over,
});

describe("dedupeLatestManualVersion", () => {
  it("keeps exactly one row per manualId — the highest version", () => {
    const rows = [
      row({ manualId: "m1", manualVersion: "2.0.0", status: "PUBLISHED", updatedAt: "2026-02-01T00:00:00Z" }),
      row({ manualId: "m1", manualVersion: "1.0.0", status: "ARCHIVED", updatedAt: "2026-01-01T00:00:00Z" }),
    ];
    const out = dedupeLatestManualVersion(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ manualId: "m1", manualVersion: "2.0.0", status: "PUBLISHED" });
  });

  it("selects the highest version by NUMBER even when the older version has a NEWER updatedAt", () => {
    // e.g. v1 was ARCHIVED (touched) after v2 already existed — v1's updatedAt is now the latest,
    // but v2 is still the version that must represent the manual.
    const rows = [
      row({ manualId: "m1", manualVersion: "1.0.0", status: "ARCHIVED", updatedAt: "2026-05-01T00:00:00Z" }),
      row({ manualId: "m1", manualVersion: "2.0.0", status: "PUBLISHED", updatedAt: "2026-01-01T00:00:00Z" }),
    ];
    const out = dedupeLatestManualVersion(rows);
    expect(out).toHaveLength(1);
    expect(out[0].manualVersion).toBe("2.0.0");
  });

  it("is independent of input row order (not incidental DB order)", () => {
    const base = { manualId: "m1", updatedAt: "2026-01-01T00:00:00Z" };
    const versions = ["1.0.0", "10.0.0", "2.5.0", "2.10.0", "9.9.9"];
    const forward = versions.map((v) => row({ ...base, manualVersion: v }));
    const reversed = [...forward].reverse();
    const shuffled = [forward[2], forward[0], forward[4], forward[1], forward[3]];

    for (const input of [forward, reversed, shuffled]) {
      const out = dedupeLatestManualVersion(input);
      expect(out).toHaveLength(1);
      expect(out[0].manualVersion).toBe("10.0.0"); // highest numerically, not lexically ("9.9.9" > "10.0.0" as strings)
    }
  });

  it("compares major/minor/patch numerically, not lexically", () => {
    const rows = [row({ manualId: "m1", manualVersion: "1.9.0" }), row({ manualId: "m1", manualVersion: "1.10.0" })];
    expect(dedupeLatestManualVersion(rows)[0].manualVersion).toBe("1.10.0");
  });

  it("preserves the manual-to-manual list order (first appearance), only the row content is version-based", () => {
    const rows = [
      row({ manualId: "a", manualVersion: "1.0.0" }),
      row({ manualId: "b", manualVersion: "1.0.0" }),
      row({ manualId: "a", manualVersion: "2.0.0" }), // a's newer version arrives later in the array
      row({ manualId: "c", manualVersion: "1.0.0" }),
    ];
    const out = dedupeLatestManualVersion(rows);
    expect(out.map((r) => r.manualId)).toEqual(["a", "b", "c"]); // order = first appearance, not last
    expect(out[0].manualVersion).toBe("2.0.0"); // but content = the highest version for "a"
  });

  it("leaves distinct manuals untouched, in order", () => {
    const rows = [row({ manualId: "a" }), row({ manualId: "b" }), row({ manualId: "c" })];
    expect(dedupeLatestManualVersion(rows).map((r) => r.manualId)).toEqual(["a", "b", "c"]);
  });

  it("a manual with 3 versions still yields exactly one row", () => {
    const rows = [
      row({ manualId: "m1", manualVersion: "3.0.0", updatedAt: "2026-03-01T00:00:00Z" }),
      row({ manualId: "m1", manualVersion: "2.0.0", updatedAt: "2026-02-01T00:00:00Z" }),
      row({ manualId: "m1", manualVersion: "1.0.0", updatedAt: "2026-01-01T00:00:00Z" }),
    ];
    expect(dedupeLatestManualVersion(rows)).toHaveLength(1);
  });

  it("empty input yields empty output", () => {
    expect(dedupeLatestManualVersion([])).toEqual([]);
  });
});
