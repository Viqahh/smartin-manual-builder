import { describe, it, expect } from "vitest";
import {
  createHistory,
  pushHistory,
  undo,
  redo,
  canUndo,
  canRedo,
  replacePresent,
} from "@/lib/editor/history";

/** AC-P3-12 — undo restores the previous editor state; the stack is bounded and safe. */
describe("editor history (undo/redo for structural block ops)", () => {
  it("push → undo → redo walks the timeline", () => {
    let h = createHistory("s0");
    h = pushHistory(h, "s1");
    h = pushHistory(h, "s2");
    expect(h.present).toBe("s2");
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);

    h = undo(h);
    expect(h.present).toBe("s1");
    h = undo(h);
    expect(h.present).toBe("s0");
    expect(canUndo(h)).toBe(false);

    h = redo(h);
    expect(h.present).toBe("s1");
    h = redo(h);
    expect(h.present).toBe("s2");
    expect(canRedo(h)).toBe(false);
  });

  it("a new push after undo clears the redo branch (no diverging future)", () => {
    let h = createHistory(0);
    h = pushHistory(h, 1);
    h = pushHistory(h, 2);
    h = undo(h); // present = 1
    h = pushHistory(h, 99); // branch
    expect(h.present).toBe(99);
    expect(canRedo(h)).toBe(false);
    h = undo(h);
    expect(h.present).toBe(1);
  });

  it("respects the size limit (oldest entries drop)", () => {
    let h = createHistory("a", 3);
    for (const s of ["b", "c", "d", "e"]) h = pushHistory(h, s);
    // past holds at most `limit` entries
    expect(h.past.length).toBeLessThanOrEqual(3);
    // we can still undo back through the retained window
    h = undo(h);
    expect(h.present).toBe("d");
  });

  it("replacePresent updates state WITHOUT creating an undo entry (server reconciliation)", () => {
    let h = createHistory("a");
    h = pushHistory(h, "b");
    const before = h.past.length;
    h = replacePresent(h, "b-reconciled");
    expect(h.present).toBe("b-reconciled");
    expect(h.past.length).toBe(before);
  });

  it("undo/redo are no-ops at the ends", () => {
    const h = createHistory("only");
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it("a custom `eq` dedups a structurally-equal snapshot (no phantom undo step)", () => {
    type Doc = { key: string; payload: number }[];
    const eq = (a: Doc, b: Doc) =>
      a.length === b.length && a.every((x, i) => x.key === b[i].key && x.payload === b[i].payload);

    let h = createHistory<Doc>([]);
    h = pushHistory(h, [{ key: "A", payload: 0 }], eq);
    const past = h.past.length;
    // a re-save that only changed a server id / row_version produces an equal-by-`eq` snapshot
    h = pushHistory(h, [{ key: "A", payload: 0 }], eq);
    expect(h.past.length).toBe(past); // no new entry
    expect(canRedo(h)).toBe(false);
    // a real change still pushes
    h = pushHistory(h, [{ key: "A", payload: 1 }], eq);
    expect(h.past.length).toBe(past + 1);
  });
});

/**
 * The discipline SectionEditor uses: `present` always tracks the CURRENT document; each op
 * pushes the POST-op state. This proves the model behind AC-P3-12 for add / remove / reorder /
 * text edit, and that a new edit after undo clears redo.
 */
describe("document-snapshot history (SectionEditor discipline)", () => {
  type Block = { key: string; payload: number };
  type Doc = Block[];
  const eq = (a: Doc, b: Doc) =>
    a.length === b.length && a.every((x, i) => x.key === b[i].key && x.payload === b[i].payload);
  const keys = (d: Doc) => d.map((b) => b.key);

  it("add block -> undo -> redo", () => {
    let h = createHistory<Doc>([]); // section loads empty
    h = pushHistory(h, [{ key: "A", payload: 0 }], eq); // add A (post-op state)
    expect(keys(h.present)).toEqual(["A"]);

    h = undo(h);
    expect(h.present).toEqual([]); // restores the state before the add
    expect(canRedo(h)).toBe(true);

    h = redo(h);
    expect(keys(h.present)).toEqual(["A"]); // redo re-adds
    expect(canRedo(h)).toBe(false);
  });

  it("delete block -> undo -> redo", () => {
    let h = createHistory<Doc>([{ key: "A", payload: 0 }, { key: "B", payload: 0 }]);
    h = pushHistory(h, [{ key: "A", payload: 0 }], eq); // delete B
    expect(keys(h.present)).toEqual(["A"]);

    h = undo(h);
    expect(keys(h.present)).toEqual(["A", "B"]); // B restored

    h = redo(h);
    expect(keys(h.present)).toEqual(["A"]); // deleted again
  });

  it("reorder -> undo -> redo", () => {
    let h = createHistory<Doc>([{ key: "A", payload: 0 }, { key: "B", payload: 0 }, { key: "C", payload: 0 }]);
    h = pushHistory(h, [{ key: "C", payload: 0 }, { key: "A", payload: 0 }, { key: "B", payload: 0 }], eq);
    expect(keys(h.present)).toEqual(["C", "A", "B"]);

    h = undo(h);
    expect(keys(h.present)).toEqual(["A", "B", "C"]); // original order

    h = redo(h);
    expect(keys(h.present)).toEqual(["C", "A", "B"]);
  });

  it("text edit -> undo -> redo restores the payload", () => {
    let h = createHistory<Doc>([{ key: "A", payload: 0 }]);
    h = pushHistory(h, [{ key: "A", payload: 42 }], eq); // committed payload edit

    h = undo(h);
    expect(h.present[0].payload).toBe(0); // previous text
    h = redo(h);
    expect(h.present[0].payload).toBe(42);
  });

  it("a new edit after undo clears the redo stack (Redo control must disable)", () => {
    let h = createHistory<Doc>([]);
    h = pushHistory(h, [{ key: "A", payload: 0 }], eq); // add A
    h = pushHistory(h, [{ key: "A", payload: 0 }, { key: "B", payload: 0 }], eq); // add B
    h = undo(h); // back to [A]; redo -> [A,B] is available
    expect(canRedo(h)).toBe(true);

    h = pushHistory(h, [{ key: "A", payload: 0 }, { key: "C", payload: 0 }], eq); // new edit
    expect(canRedo(h)).toBe(false); // redo branch discarded
    expect(keys(h.present)).toEqual(["A", "C"]);
  });
});
