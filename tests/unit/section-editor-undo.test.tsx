// @vitest-environment jsdom
/**
 * AC-P3-12 — undo/redo of structural block ops, exercised through the REAL <SectionEditor> UI
 * against an in-memory fake of the block server actions (a stand-in "database" with row_version).
 *
 * Covers: add -> undo -> redo, delete -> undo -> redo, reorder -> undo -> redo,
 * a new edit after undo clears redo, and the persisted (fake-DB) state stays correct after undo.
 */
import { useState } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import type { ManualViewModel } from "@/lib/manual/view-model";

// --------------------------------------------------------------------------- fake "DB"
type Row = {
  id: string;
  section: string;
  type: string;
  payload: unknown;
  position: number;
  deleted: boolean;
  row_version: number;
};
const db = new Map<string, Row>();
let seq = 0;
const uid = () => `blk-${++seq}`;
const liveRows = () => [...db.values()].filter((r) => !r.deleted).sort((a, b) => a.position - b.position);
const seed = (type: string, payload: unknown, section = "sec-1") => {
  const id = uid();
  db.set(id, { id, section, type, payload, position: liveRows().length, deleted: false, row_version: 1 });
  return id;
};

vi.mock("@/features/blocks/actions", () => ({
  createBlock: vi.fn(async ({ sectionId, blockType, payload }: { sectionId: string; blockType: string; payload: unknown }) => {
    const id = uid();
    const position = [...db.values()].filter((r) => r.section === sectionId && !r.deleted).length;
    db.set(id, { id, section: sectionId, type: blockType, payload, position, deleted: false, row_version: 1 });
    return { ok: true, data: { id, position, rowVersion: 1 } };
  }),
  updateBlock: vi.fn(
    async ({ blockId, expectedRowVersion, payload, blockType }: { blockId: string; expectedRowVersion: number; payload: unknown; blockType?: string }) => {
      const r = db.get(blockId);
      if (!r || r.deleted) return { ok: false, code: "NOT_FOUND", message: "not found" };
      if (r.row_version !== expectedRowVersion) return { ok: false, code: "CONFLICT", message: "conflict" };
      r.payload = payload;
      if (blockType) r.type = blockType;
      r.row_version += 1;
      return { ok: true, data: { rowVersion: r.row_version } };
    },
  ),
  softDeleteBlock: vi.fn(async ({ blockId }: { blockId: string }) => {
    const r = db.get(blockId);
    if (r && !r.deleted) {
      r.deleted = true;
      r.row_version += 1;
    }
    return { ok: true, data: { id: blockId } };
  }),
  restoreBlock: vi.fn(async ({ blockId }: { blockId: string }) => {
    const r = db.get(blockId);
    if (!r) return { ok: false, code: "NOT_FOUND", message: "not found" };
    r.deleted = false;
    r.row_version += 1;
    return { ok: true, data: { id: blockId, position: r.position, rowVersion: r.row_version } };
  }),
  reorderBlocks: vi.fn(async ({ orderedBlockIds }: { orderedBlockIds: string[] }) => {
    orderedBlockIds.forEach((id, i) => {
      const r = db.get(id);
      if (r) {
        r.position = i;
        r.row_version += 1;
      }
    });
    return { ok: true, data: { count: orderedBlockIds.length } };
  }),
  duplicateBlock: vi.fn(async ({ blockId }: { blockId: string }) => {
    const src = db.get(blockId);
    if (!src) return { ok: false, code: "NOT_FOUND", message: "not found" };
    const id = uid();
    db.set(id, { ...src, id, payload: structuredClone(src.payload), position: src.position + 1, row_version: 1 });
    return { ok: true, data: { id, position: src.position + 1 } };
  }),
  getBlockRowVersions: vi.fn(async ({ sectionId }: { sectionId: string }) => ({
    ok: true,
    data: {
      blocks: [...db.values()]
        .filter((r) => r.section === sectionId && !r.deleted)
        .map((r) => ({ id: r.id, rowVersion: r.row_version, position: r.position })),
    },
  })),
  getBlockState: vi.fn(async ({ blockId }: { blockId: string }) => {
    const r = db.get(blockId);
    return r && !r.deleted
      ? { ok: true, data: { exists: true, rowVersion: r.row_version, payload: r.payload } }
      : { ok: true, data: { exists: false, rowVersion: 0, payload: null } };
  }),
}));

import { SectionEditor } from "@/features/manuals/editor/section-editor";

const stepsPayload = (title: string) => ({
  type: "steps",
  schemaVersion: 1,
  steps: [{ title, instruction: "isi" }],
});

function makeSection(blocks: { id: string; type: string; payload: unknown; position: number }[]): ManualViewModel["sections"][number] {
  return {
    id: "sec-1",
    key: "installation",
    title: "Instalasi",
    required: true,
    isCustom: false,
    position: 4,
    completionState: "incomplete",
    rowVersion: 1,
    blocks: blocks.map((b) => ({
      id: b.id,
      type: b.type as ManualViewModel["sections"][number]["blocks"][number]["type"],
      payload: b.payload as Record<string, unknown>,
      position: b.position,
      imageAssetId: null,
      parameterGroupIds: [],
      rowVersion: db.get(b.id)?.row_version ?? 1,
    })),
  };
}

const vm = { parameterGroups: [] } as unknown as ManualViewModel;
const ctx = {
  images: [],
  groups: [],
  onUploadImage: async () => ({ ok: false as const }),
  onUpdateImageMeta: async () => {},
};

function renderEditor(section: ManualViewModel["sections"][number]) {
  return render(<SectionEditor section={section} vm={vm} canEdit ctx={ctx} onBlocksChanged={() => {}} />);
}

const undoBtn = () => screen.getByRole("button", { name: "Batalkan" });
const redoBtn = () => screen.getByRole("button", { name: "Ulangi" });

beforeEach(() => {
  db.clear();
  seq = 0;
  cleanup();
  vi.clearAllMocks();
});

describe("SectionEditor undo/redo (AC-P3-12)", () => {
  it("UAT-04: a freshly added block is a LOCAL draft — nothing is written until real content is typed", async () => {
    renderEditor(makeSection([]));

    fireEvent.click(screen.getByRole("button", { name: /Tambah blok/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Langkah instalasi/ }));

    // the draft editor is on screen…
    expect(screen.getByLabelText("Hapus blok 1")).toBeInTheDocument();
    // …but the empty draft is NOT persisted (no ghost row), even after the autosave window
    await new Promise((r) => setTimeout(r, 1200));
    expect(liveRows()).toHaveLength(0);

    // typing meaningful content (a steps block needs BOTH title and instruction to parse) persists it once
    fireEvent.change(titleInputs()[0], { target: { value: "Salin file EA" } });
    fireEvent.change(screen.getAllByLabelText("Instruksi")[0], { target: { value: "Letakkan .ex5 di folder Experts." } });
    await waitFor(() => expect(liveRows()).toHaveLength(1), { timeout: 4000 });
  }, 15000);

  it("add block -> type content -> undo -> redo; persisted state matches the visible state", async () => {
    renderEditor(makeSection([]));

    fireEvent.click(screen.getByRole("button", { name: /Tambah blok/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Langkah instalasi/ }));
    fireEvent.change(titleInputs()[0], { target: { value: "Langkah nyata" } });
    fireEvent.change(screen.getAllByLabelText("Instruksi")[0], { target: { value: "Instruksi nyata." } });

    // block persisted after the autosave debounce
    await waitFor(() => expect(liveRows()).toHaveLength(1), { timeout: 4000 });
    expect(screen.getByLabelText("Hapus blok 1")).toBeInTheDocument();

    // Undo -> block removed from the editor AND soft-deleted in the DB
    fireEvent.click(undoBtn());
    await waitFor(() => expect(liveRows()).toHaveLength(0));
    expect(screen.queryByLabelText("Hapus blok 1")).not.toBeInTheDocument();

    // Redo -> restored in both
    expect(redoBtn()).toBeEnabled();
    fireEvent.click(redoBtn());
    await waitFor(() => expect(liveRows()).toHaveLength(1));
    expect(screen.getByLabelText("Hapus blok 1")).toBeInTheDocument();
    expect(redoBtn()).toBeDisabled();
  }, 15000);

  it("UAT-04: an untouched draft block is discarded on unmount — no server write", async () => {
    const { unmount } = renderEditor(makeSection([]));
    fireEvent.click(screen.getByRole("button", { name: /Tambah blok/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Teks/ }));
    unmount();
    await new Promise((r) => setTimeout(r, 300));
    expect(liveRows()).toHaveLength(0);
    const { createBlock } = (await import("@/features/blocks/actions")) as unknown as { createBlock: { mock: { calls: unknown[] } } };
    expect(createBlock.mock.calls).toHaveLength(0);
  }, 15000);

  it("delete block -> undo -> redo", async () => {
    const a = seed("steps", stepsPayload("A"));
    const b = seed("steps", stepsPayload("B"));
    renderEditor(makeSection([
      { id: a, type: "steps", payload: stepsPayload("A"), position: 0 },
      { id: b, type: "steps", payload: stepsPayload("B"), position: 1 },
    ]));
    expect(liveRows()).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Hapus blok 2"));
    await waitFor(() => expect(liveRows()).toHaveLength(1));
    expect(liveRows()[0].id).toBe(a);

    fireEvent.click(undoBtn());
    await waitFor(() => expect(liveRows()).toHaveLength(2));

    fireEvent.click(redoBtn());
    await waitFor(() => expect(liveRows()).toHaveLength(1));
    expect(liveRows()[0].id).toBe(a);
  }, 15000);

  it("reorder -> undo -> redo", async () => {
    const a = seed("steps", stepsPayload("A"));
    const b = seed("steps", stepsPayload("B"));
    renderEditor(makeSection([
      { id: a, type: "steps", payload: stepsPayload("A"), position: 0 },
      { id: b, type: "steps", payload: stepsPayload("B"), position: 1 },
    ]));

    // move block 1 down
    fireEvent.click(screen.getByLabelText("Turunkan blok 1"));
    await waitFor(() => expect(liveRows().map((r) => r.id)).toEqual([b, a]));

    fireEvent.click(undoBtn());
    await waitFor(() => expect(liveRows().map((r) => r.id)).toEqual([a, b]));

    fireEvent.click(redoBtn());
    await waitFor(() => expect(liveRows().map((r) => r.id)).toEqual([b, a]));
  }, 15000);

  it("a new edit after undo clears the redo control", async () => {
    const a = seed("steps", stepsPayload("A"));
    const b = seed("steps", stepsPayload("B"));
    const c = seed("steps", stepsPayload("C"));
    renderEditor(makeSection([
      { id: a, type: "steps", payload: stepsPayload("A"), position: 0 },
      { id: b, type: "steps", payload: stepsPayload("B"), position: 1 },
      { id: c, type: "steps", payload: stepsPayload("C"), position: 2 },
    ]));

    fireEvent.click(screen.getByLabelText("Hapus blok 3")); // delete C
    await waitFor(() => expect(liveRows()).toHaveLength(2));

    fireEvent.click(undoBtn()); // C back — redo (delete C) now available
    await waitFor(() => expect(liveRows()).toHaveLength(3));
    expect(redoBtn()).toBeEnabled();

    fireEvent.click(screen.getByLabelText("Hapus blok 1")); // NEW edit: delete A
    await waitFor(() => expect(liveRows()).toHaveLength(2));
    expect(redoBtn()).toBeDisabled(); // redo stack discarded
  }, 15000);
});

// --------------------------------------------------------------------------- autosave / conflict UX
const titleInputs = () => screen.getAllByLabelText("Judul langkah") as HTMLInputElement[];
const blockState = (n: number) =>
  within(screen.getByLabelText(`Hapus blok ${n}`).closest("li.block-item") as HTMLElement)
    .getByRole("status")
    .textContent;

describe("SectionEditor autosave — single-session conflict UX (AC-P3 fix)", () => {
  it("E. reorder a block, then immediately edit it — no false conflict, edit converges to Tersimpan", async () => {
    const a = seed("steps", stepsPayload("A"));
    const b = seed("steps", stepsPayload("B"));
    renderEditor(makeSection([
      { id: a, type: "steps", payload: stepsPayload("A"), position: 0 },
      { id: b, type: "steps", payload: stepsPayload("B"), position: 1 },
    ]));

    // reorder — the RPC bumps every live block's row_version out from under the editor
    fireEvent.click(screen.getByLabelText("Turunkan blok 1"));
    // ...and immediately edit the block that just moved, before any version re-sync settles
    fireEvent.change(titleInputs()[1], { target: { value: "A edited right after reorder" } });

    // the stale-version write is recognised as a self-race: adopted + retried silently
    await waitFor(
      () => {
        const row = [...db.values()].find((r) => r.id === a)!;
        expect((row.payload as { steps: { title: string }[] }).steps[0].title).toBe("A edited right after reorder");
      },
      { timeout: 4000 },
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(blockState(2)).toBe("Tersimpan"));
  }, 15000);

  it("F. a genuine external edit surfaces the conflict panel, keeps local text, and never auto-overwrites", async () => {
    const a = seed("steps", stepsPayload("A"));
    renderEditor(makeSection([{ id: a, type: "steps", payload: stepsPayload("A"), position: 0 }]));

    // a first local edit lands normally (establishes lastPersisted, server row_version -> 2)
    fireEvent.change(titleInputs()[0], { target: { value: "mine v1" } });
    await waitFor(() => {
      const row = [...db.values()].find((r) => r.id === a)!;
      expect((row.payload as { steps: { title: string }[] }).steps[0].title).toBe("mine v1");
    }, { timeout: 4000 });

    // ANOTHER writer changes the same row's content out of band
    const row = db.get(a)!;
    row.payload = { type: "steps", schemaVersion: 1, steps: [{ title: "THEIRS", instruction: "isi" }] };
    row.row_version += 3;

    // my next edit clashes and the server content is NOT one I've seen -> real conflict
    fireEvent.change(titleInputs()[0], { target: { value: "mine v2" } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument(), { timeout: 4000 });
    expect(within(screen.getByRole("alert")).getByText(/Perubahan lain terdeteksi/)).toBeInTheDocument();
    // my typed text is still mounted, untouched
    expect((titleInputs()[0] as HTMLInputElement).value).toBe("mine v2");
    // neither side was silently overwritten
    expect((db.get(a)!.payload as { steps: { title: string }[] }).steps[0].title).toBe("THEIRS");

    // "Gunakan perubahan saya" -> my retained draft is saved against the current server version
    fireEvent.click(screen.getByRole("button", { name: "Gunakan perubahan saya" }));
    await waitFor(() => {
      expect((db.get(a)!.payload as { steps: { title: string }[] }).steps[0].title).toBe("mine v2");
    }, { timeout: 4000 });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  }, 15000);

  it("G. edit a block payload, undo, redo — the DB round-trips through the serialized queue", async () => {
    const a = seed("steps", stepsPayload("A"));
    renderEditor(makeSection([{ id: a, type: "steps", payload: stepsPayload("A"), position: 0 }]));

    fireEvent.change(titleInputs()[0], { target: { value: "A2" } });
    await waitFor(
      () => expect((db.get(a)!.payload as { steps: { title: string }[] }).steps[0].title).toBe("A2"),
      { timeout: 4000 },
    );

    fireEvent.click(undoBtn());
    await waitFor(
      () => expect((db.get(a)!.payload as { steps: { title: string }[] }).steps[0].title).toBe("A"),
      { timeout: 4000 },
    );

    fireEvent.click(redoBtn());
    await waitFor(
      () => expect((db.get(a)!.payload as { steps: { title: string }[] }).steps[0].title).toBe("A2"),
      { timeout: 4000 },
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  }, 15000);

  it("F2. 'Muat versi terbaru' replaces local content with the server version", async () => {
    const a = seed("steps", stepsPayload("A"));
    renderEditor(makeSection([{ id: a, type: "steps", payload: stepsPayload("A"), position: 0 }]));

    fireEvent.change(titleInputs()[0], { target: { value: "mine v1" } });
    await waitFor(() => {
      const row = [...db.values()].find((r) => r.id === a)!;
      expect((row.payload as { steps: { title: string }[] }).steps[0].title).toBe("mine v1");
    }, { timeout: 4000 });

    const row = db.get(a)!;
    row.payload = { type: "steps", schemaVersion: 1, steps: [{ title: "SERVER COPY", instruction: "isi" }] };
    row.row_version += 3;

    fireEvent.change(titleInputs()[0], { target: { value: "mine v2" } });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument(), { timeout: 4000 });
    expect(within(screen.getByRole("alert")).getByText(/Perubahan lain terdeteksi/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Muat versi terbaru" }));
    await waitFor(() => expect((titleInputs()[0] as HTMLInputElement).value).toBe("SERVER COPY"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  }, 15000);
});

// --------------------------------------------------------------------------- UAT-01 chapter state
/**
 * A minimal stand-in for the builder's chapter switch: it keeps `sections` state, remounts
 * <SectionEditor key={id}> per selected chapter, and folds committed blocks back via
 * `onSectionBlocksCommitted`. Without the lift, switching A → B → A shows stale content.
 */
function ChapterHarness() {
  const [sections, setSections] = useState<ManualViewModel["sections"][number][]>([
    makeSection([{ id: "seed-a", type: "steps", payload: stepsPayload("A original"), position: 0 }]),
    { ...makeSection([]), id: "sec-2", key: "faq", title: "Tanya Jawab", position: 5 },
  ]);
  const [sel, setSel] = useState("sec-1");
  const section = sections.find((s) => s.id === sel)!;
  return (
    <div>
      <button onClick={() => setSel("sec-1")}>go-A</button>
      <button onClick={() => setSel("sec-2")}>go-B</button>
      <SectionEditor
        key={section.id}
        section={section}
        vm={vm}
        canEdit
        ctx={ctx}
        onBlocksChanged={() => {}}
        onSectionBlocksCommitted={(id, blocks) =>
          setSections((prev) => {
            const cur = prev.find((s) => s.id === id);
            // same dedupe the real builder uses — an unchanged set must be a no-op (no re-render loop)
            if (cur && JSON.stringify(cur.blocks) === JSON.stringify(blocks)) return prev;
            return prev.map((s) => (s.id === id ? { ...s, blocks } : s));
          })
        }
      />
    </div>
  );
}

describe("SectionEditor — chapter state lift (UAT-01)", () => {
  it("A → B → A shows the latest saved content, not the stale prop", async () => {
    // the harness seeds chapter A with a fake-DB row id "seed-a"
    db.set("seed-a", { id: "seed-a", section: "sec-1", type: "steps", payload: stepsPayload("A original"), position: 0, deleted: false, row_version: 1 });

    render(<ChapterHarness />);

    // edit chapter A and let it persist
    fireEvent.change(titleInputs()[0], { target: { value: "A edited" } });
    await waitFor(
      () => expect((db.get("seed-a")!.payload as { steps: { title: string }[] }).steps[0].title).toBe("A edited"),
      { timeout: 4000 },
    );

    // switch to B, then back to A — the editor remounts from the harness `sections` state
    fireEvent.click(screen.getByText("go-B"));
    await waitFor(() => expect(screen.queryByLabelText("Judul langkah")).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("go-A"));

    // the remounted A editor shows the edited title (lifted), not "A original"
    await waitFor(() => expect(titleInputs()[0].value).toBe("A edited"));
  }, 20000);
});

// --------------------------------------------------------------------------- UAT-33 canvas slot
describe("SectionEditor — canvasPrefix renders INSIDE the document canvas (UAT-33)", () => {
  it("puts inline chapter content (e.g. the structured changelog) inside .editor-canvas, above blocks", () => {
    const { container } = render(
      <SectionEditor
        section={makeSection([])}
        vm={vm}
        canEdit
        ctx={ctx}
        onBlocksChanged={() => {}}
        canvasPrefix={<div data-testid="cl-slot">catatan perubahan</div>}
      />,
    );
    const canvas = container.querySelector(".editor-canvas");
    expect(canvas).not.toBeNull();
    // the prefix is a child of the canvas, not a sibling panel outside it
    expect(canvas!.querySelector('[data-testid="cl-slot"]')).not.toBeNull();
    // with a prefix present the big "Tambah blok pertama" empty state is replaced by the
    // "optional blocks" hint (blocks remain available, just not the primary affordance)
    expect(screen.queryByText("Tambah blok pertama")).not.toBeInTheDocument();
    expect(screen.getByText(/Blok tambahan bersifat opsional/)).toBeInTheDocument();
  });
});
