import { describe, it, expect } from "vitest";
import { arrayMove, moveByStep, isValidPermutation, contiguousPositions } from "@/lib/editor/reorder";

describe("arrayMove / moveByStep (AC-P3-5 — one path for drag and keyboard)", () => {
  it("moves an item forward and backward, returning a new array", () => {
    const base = ["a", "b", "c", "d"];
    expect(arrayMove(base, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(arrayMove(base, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(arrayMove(base, 0, 2)).not.toBe(base);
    expect(base).toEqual(["a", "b", "c", "d"]); // input untouched
  });

  it("clamps out-of-range targets and no-ops an out-of-range source", () => {
    expect(arrayMove(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
    expect(arrayMove(["a", "b", "c"], 0, -5)).toEqual(["a", "b", "c"]);
    expect(arrayMove(["a", "b", "c"], 9, 0)).toEqual(["a", "b", "c"]);
  });

  it("keyboard step up/down is the same operation as a drag", () => {
    const base = ["a", "b", "c"];
    expect(moveByStep(base, 1, -1)).toEqual(arrayMove(base, 1, 0));
    expect(moveByStep(base, 1, 1)).toEqual(arrayMove(base, 1, 2));
  });
});

describe("isValidPermutation / contiguousPositions", () => {
  it("accepts a true permutation and rejects dup / missing / extra / wrong-count", () => {
    const cur = ["a", "b", "c"];
    expect(isValidPermutation(cur, ["c", "a", "b"])).toBe(true);
    expect(isValidPermutation(cur, ["a", "a", "b"])).toBe(false);
    expect(isValidPermutation(cur, ["a", "b"])).toBe(false);
    expect(isValidPermutation(cur, ["a", "b", "c", "d"])).toBe(false);
    expect(isValidPermutation(cur, ["a", "b", "z"])).toBe(false);
  });

  it("assigns contiguous 0..n-1 positions in list order", () => {
    expect(contiguousPositions([{ id: "x" }, { id: "y" }, { id: "z" }])).toEqual([
      { id: "x", position: 0 },
      { id: "y", position: 1 },
      { id: "z", position: 2 },
    ]);
  });
});
