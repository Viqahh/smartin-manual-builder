// @vitest-environment jsdom
/**
 * Phase 8A.5 — Manual Builder persistence / navigation regression.
 *
 * Original bug: a coalesced autosave that fired right after `createBlock` re-ran the CREATE
 * path (id not yet reconciled) → a duplicate `manual_blocks` row the client abandoned; and a
 * chapter change dropped a pending debounced save (`dispose()` without a flush).
 *
 * These tests drive the real <SectionEditor> with a stub block editor + mocked block actions,
 * plus a harness parent that mirrors <ManualBuilder>'s save barrier (`await ref.flushPending()`
 * before switching the mounted section, with the same committed-set fold-back + dedup).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import type { ManualViewModel } from "@/lib/manual/view-model";

// ---- stub the rich block editor: one <textarea> per block, `onChange` emits a text payload ----
vi.mock("@/features/manuals/editor/block-editors", () => ({
  BlockEditor: ({
    payload,
    onChange,
  }: {
    blockType: string;
    payload: Record<string, unknown>;
    onChange: (p: Record<string, unknown>) => void;
  }) => (
    <textarea
      aria-label="stub-block-editor"
      value={plainOf(payload)}
      onChange={(e) => onChange(mkText(e.target.value))}
    />
  ),
}));
function mkText(s: string): Record<string, unknown> {
  return {
    type: "text",
    schemaVersion: 1,
    content: {
      schemaVersion: 2,
      format: "doc",
      doc: { type: "doc", content: [{ type: "paragraph", content: s ? [{ type: "text", text: s }] : [] }] },
    },
  };
}
function plainOf(payload: Record<string, unknown>): string {
  const doc = (payload as { content?: { doc?: { content?: { content?: { text?: string }[] }[] } } }).content?.doc;
  return (doc?.content ?? []).flatMap((p) => (p.content ?? []).map((t) => t.text ?? "")).join("");
}

vi.mock("@/features/parameters/actions", () => ({
  getParameterGroups: vi.fn(async () => ({ ok: true, data: { groups: [] } })),
}));

// ---- mocked block actions backed by an in-memory "DB" keyed by client_token -------------------
type Row = { id: string; token: string | null; payload: unknown; rowVersion: number };
const db: Row[] = [];
let dbSeq = 0;
let createGate: Promise<void> | null = null;
let failNextUpdate = false;

const createBlock = vi.fn(async (input: { clientToken?: string; payload: unknown }) => {
  if (createGate) await createGate;
  const token = input.clientToken ?? null;
  const existing = token ? db.find((r) => r.token === token) : undefined;
  if (existing) return { ok: true as const, data: { id: existing.id, position: 0, rowVersion: existing.rowVersion } };
  const row: Row = { id: `db-${++dbSeq}`, token, payload: input.payload, rowVersion: 1 };
  db.push(row);
  return { ok: true as const, data: { id: row.id, position: db.length - 1, rowVersion: 1 } };
});
const updateBlock = vi.fn(async (input: { blockId: string; payload: unknown }) => {
  if (failNextUpdate) {
    failNextUpdate = false;
    return { ok: false as const, code: "INTERNAL", message: "boom" };
  }
  const row = db.find((r) => r.id === input.blockId);
  if (!row) return { ok: false as const, code: "NOT_FOUND", message: "gone" };
  row.payload = input.payload;
  row.rowVersion += 1;
  return { ok: true as const, data: { rowVersion: row.rowVersion } };
});
vi.mock("@/features/blocks/actions", () => ({
  createBlock: (a: unknown) => createBlock(a as { clientToken?: string; payload: unknown }),
  updateBlock: (a: unknown) => updateBlock(a as { blockId: string; payload: unknown }),
  softDeleteBlock: vi.fn(async ({ blockId }: { blockId: string }) => ({ ok: true, data: { id: blockId } })),
  restoreBlock: vi.fn(),
  reorderBlocks: vi.fn(async () => ({ ok: true, data: { count: 0 } })),
  duplicateBlock: vi.fn(),
  getBlockRowVersions: vi.fn(async () => ({ ok: true, data: { blocks: [] } })),
  getBlockState: vi.fn(async () => ({ ok: true, data: { exists: false, rowVersion: 0, payload: null } })),
}));

import { SectionEditor, type SectionEditorHandle } from "@/features/manuals/editor/section-editor";

type Section = ManualViewModel["sections"][number];
const mkSection = (id: string, key: string, blocks: Section["blocks"] = []): Section => ({
  id,
  key,
  title: key,
  required: false,
  isCustom: false,
  position: 0,
  completionState: "incomplete",
  rowVersion: 1,
  blocks,
});
const vm = { parameterGroups: [] } as unknown as ManualViewModel;
const ctx = {
  images: [],
  groups: [],
  eaVersionId: "ea-1",
  parameterGroupsFull: [],
  onParametersChanged: () => {},
  onUploadImage: async () => ({ ok: false as const }),
  onUpdateImageMeta: async () => {},
} as never;

/** Mirrors <ManualBuilder>: two sections, committed-set fold-back with dedup, save barrier. */
function Harness({ onNav }: { onNav?: (ok: boolean) => void }) {
  const ref = useRef<SectionEditorHandle | null>(null);
  const [sections, setSections] = useState<Section[]>([mkSection("s1", "presets"), mkSection("s2", "faq")]);
  const [cur, setCur] = useState("s1");
  const section = sections.find((s) => s.id === cur)!;

  const fold = useCallback((sectionId: string, blocks: Section["blocks"]) => {
    setSections((prev) => {
      const s = prev.find((x) => x.id === sectionId);
      if (!s) return prev;
      const same =
        s.blocks.length === blocks.length &&
        s.blocks.every((b, i) => b.id === blocks[i].id && JSON.stringify(b.payload) === JSON.stringify(blocks[i].payload));
      return same ? prev : prev.map((x) => (x.id === sectionId ? { ...x, blocks } : x));
    });
  }, []);

  const go = async (id: string) => {
    const r = await ref.current!.flushPending();
    onNav?.(r.ok);
    if (r.ok) setCur(id);
  };

  return (
    <div>
      <button onClick={() => go(cur === "s1" ? "s2" : "s1")}>toggle</button>
      <button onClick={() => void ref.current!.flushPending()}>flush</button>
      <SectionEditor
        key={section.id}
        ref={ref}
        section={section}
        vm={vm}
        canEdit
        ctx={ctx}
        onBlocksChanged={() => {}}
        onSectionBlocksCommitted={fold}
      />
    </div>
  );
}

const addText = () => fireEvent.click(screen.getByRole("button", { name: /^Teks/ }));
const addAnotherText = () => {
  fireEvent.click(screen.getByRole("button", { name: /^Tambah blok/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Teks/ }));
};
const editors = () => screen.queryAllByLabelText("stub-block-editor") as HTMLTextAreaElement[];
const editor = () => editors()[0];
const btn = (name: string | RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  cleanup();
  db.length = 0;
  dbSeq = 0;
  createGate = null;
  failNextUpdate = false;
  vi.clearAllMocks();
});

describe("create while typing → exactly one persisted logical block", () => {
  it("a coalesced save mid-create becomes UPDATE, not a second CREATE", async () => {
    let release!: () => void;
    createGate = new Promise<void>((r) => (release = r));

    render(<Harness />);
    addText();
    fireEvent.change(editor(), { target: { value: "SMOKE" } });

    fireEvent.click(btn("flush")); // starts flush -> createBlock called, now gated
    await Promise.resolve();
    fireEvent.change(editor(), { target: { value: "SMOKE 2026" } }); // typing during the create
    release();

    await waitFor(() => expect(db).toHaveLength(1));
    await waitFor(() => expect(updateBlock).toHaveBeenCalledTimes(1));
    expect(createBlock).toHaveBeenCalledTimes(1);
    expect(plainOf(db[0].payload as Record<string, unknown>)).toBe("SMOKE 2026"); // latest wins
    expect(db[0].token).toBeTruthy();
  });
});

describe("chapter navigation is a save barrier", () => {
  it("type → next chapter → back → exact text survives once (no duplicate)", async () => {
    render(<Harness />);
    addText();
    fireEvent.change(editor(), { target: { value: "chapter one content" } });

    fireEvent.click(btn("toggle")); // -> s2 (awaits flush)
    await waitFor(() => expect(createBlock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(editors()).toHaveLength(0)); // s2 empty

    fireEvent.click(btn("toggle")); // -> back to s1
    await waitFor(() => expect(editor()?.value).toBe("chapter one content"));
    expect(db).toHaveLength(1);
    expect(createBlock).toHaveBeenCalledTimes(1);
  });

  it("type → toggle before the 800ms debounce → content still persisted exactly once", async () => {
    render(<Harness />);
    addText();
    fireEvent.change(editor(), { target: { value: "beat the debounce" } });
    fireEvent.click(btn("toggle")); // no waiting

    await waitFor(() => expect(db).toHaveLength(1));
    expect(createBlock).toHaveBeenCalledTimes(1);
    expect(plainOf(db[0].payload as Record<string, unknown>)).toBe("beat the debounce");
  });

  it("a failed save blocks navigation and does not lose the edit", async () => {
    const nav: boolean[] = [];
    render(<Harness onNav={(ok) => nav.push(ok)} />);

    addText();
    fireEvent.change(editor(), { target: { value: "v1" } });
    fireEvent.click(btn("toggle")); // flush + go s2
    await waitFor(() => expect(db).toHaveLength(1));
    fireEvent.click(btn("toggle")); // back to s1
    await waitFor(() => expect(editor()?.value).toBe("v1"));

    failNextUpdate = true;
    fireEvent.change(editor(), { target: { value: "v2 will fail" } });
    fireEvent.click(btn("toggle"));

    await waitFor(() => expect(nav.at(-1)).toBe(false)); // navigation refused
    expect(editor()?.value).toBe("v2 will fail"); // still on s1, edit retained
    expect(db[0].rowVersion).toBe(1); // failed write did not persist
  });
});

describe("blocks stay independent", () => {
  it("two text blocks are two rows with distinct tokens and no overwrite", async () => {
    render(<Harness />);
    addText();
    fireEvent.change(editor(), { target: { value: "alpha" } });
    fireEvent.click(btn("flush"));
    await waitFor(() => expect(db).toHaveLength(1));

    addAnotherText();
    await waitFor(() => expect(editors()).toHaveLength(2));
    fireEvent.change(editors()[1], { target: { value: "beta" } });
    fireEvent.click(btn("flush"));

    await waitFor(() => expect(db).toHaveLength(2));
    expect(db.map((r) => plainOf(r.payload as Record<string, unknown>)).sort()).toEqual(["alpha", "beta"]);
    expect(new Set(db.map((r) => r.token)).size).toBe(2);
  });
});
