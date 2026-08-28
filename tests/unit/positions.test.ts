import { describe, it, expect } from "vitest";
import { nextPosition, validateReorder } from "@/lib/domain/positions";

describe("position helpers (AC-P2-16)", () => {
  it("nextPosition appends after the current max (gaps allowed)", () => {
    expect(nextPosition([])).toBe(0);
    expect(nextPosition([0, 1, 2])).toBe(3);
    expect(nextPosition([0, 5, 2])).toBe(6);
  });

  it("validateReorder accepts a full permutation", () => {
    expect(validateReorder(["a", "b", "c"], ["c", "a", "b"])).toEqual({ ok: true });
  });

  it("rejects a count mismatch, a duplicate, and an unknown id", () => {
    expect(validateReorder(["a", "b", "c"], ["a", "b"]).ok).toBe(false);
    expect(validateReorder(["a", "b", "c"], ["a", "a", "b"])).toEqual({ ok: false, reason: "duplicate_id" });
    expect(validateReorder(["a", "b", "c"], ["a", "b", "x"])).toEqual({ ok: false, reason: "unknown_id" });
  });
});
