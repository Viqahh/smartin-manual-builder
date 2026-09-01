// @vitest-environment jsdom
/**
 * UAT-34 — legacy persisted blocks with no authored content are auto-removed from an editable
 * DRAFT on load. Structural blocks (image, parameterTable) and meaningful content are never
 * touched, and a cleaned block does not come back on the next load.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import type { ManualViewModel } from "@/lib/manual/view-model";
import { isBlockContentEmpty } from "@/lib/domain/blocks";
import { emptyRichText, richTextFromParagraphs } from "@/lib/domain/rich-text";

// ---------------------------------------------------------------- isBlockContentEmpty (pure)
describe("isBlockContentEmpty", () => {
  const full = richTextFromParagraphs(["Ada isi nyata."]);

  it("is TRUE for a blank Text block", () => {
    expect(isBlockContentEmpty({ type: "text", schemaVersion: 1, content: emptyRichText() })).toBe(true);
  });
  it("is TRUE for a blank Callout block", () => {
    expect(isBlockContentEmpty({ type: "callout", schemaVersion: 1, tone: "info", content: emptyRichText() })).toBe(true);
  });
  it("is TRUE for a zero-item FAQ block and an all-blank FAQ item", () => {
    expect(isBlockContentEmpty({ type: "faq", schemaVersion: 2, items: [] })).toBe(true);
    expect(
      isBlockContentEmpty({ type: "faq", schemaVersion: 2, items: [{ question: "   ", answer: emptyRichText() }] }),
    ).toBe(true);
    // legacy v1 shape
    expect(isBlockContentEmpty({ type: "faq", schemaVersion: 1, question: "", answer: emptyRichText() })).toBe(true);
  });
  it("is TRUE for an empty Steps block and an all-blank step", () => {
    expect(isBlockContentEmpty({ type: "steps", schemaVersion: 1, steps: [] })).toBe(true);
    expect(
      isBlockContentEmpty({ type: "steps", schemaVersion: 1, steps: [{ title: " ", instruction: "", menuPath: "" }] }),
    ).toBe(true);
  });

  it("is FALSE for meaningful Text / Callout / FAQ / Steps", () => {
    expect(isBlockContentEmpty({ type: "text", schemaVersion: 1, content: full })).toBe(false);
    expect(isBlockContentEmpty({ type: "callout", schemaVersion: 1, tone: "warning", content: full })).toBe(false);
    expect(isBlockContentEmpty({ type: "faq", schemaVersion: 2, items: [{ question: "Apa itu?", answer: full }] })).toBe(false);
    expect(isBlockContentEmpty({ type: "steps", schemaVersion: 1, steps: [{ title: "Buka folder", instruction: "Klik" }] })).toBe(false);
  });
  it("is FALSE for structural blocks (never auto-removed)", () => {
    expect(isBlockContentEmpty({ type: "image", schemaVersion: 1, imageAssetId: "00000000-0000-4000-8000-000000000001" })).toBe(false);
    expect(isBlockContentEmpty({ type: "parameterTable", schemaVersion: 1, groupIds: ["00000000-0000-4000-8000-000000000002"] })).toBe(false);
    expect(isBlockContentEmpty({ type: "steps", schemaVersion: 1, steps: [{ title: "", instruction: "", imageAssetId: "x" }] })).toBe(false);
  });
  it("is FALSE for anything it cannot recognise", () => {
    expect(isBlockContentEmpty(null)).toBe(false);
    expect(isBlockContentEmpty({ type: "mystery" })).toBe(false);
  });
});

// ---------------------------------------------------------------- SectionEditor auto-cleanup
vi.mock("@/features/parameters/actions", () => ({
  getParameterGroups: vi.fn(async () => ({ ok: true, data: { groups: [] } })),
  createParameter: vi.fn(),
  updateParameter: vi.fn(),
  deleteParameter: vi.fn(),
  createParameterGroup: vi.fn(),
}));

const softDeleteBlock = vi.fn(async ({ blockId }: { blockId: string }) => ({ ok: true, data: { id: blockId } }));
vi.mock("@/features/blocks/actions", () => ({
  createBlock: vi.fn(async () => ({ ok: true, data: { id: "new", rowVersion: 1 } })),
  updateBlock: vi.fn(async () => ({ ok: true, data: { rowVersion: 2 } })),
  softDeleteBlock: (a: { blockId: string }) => softDeleteBlock(a),
  restoreBlock: vi.fn(),
  reorderBlocks: vi.fn(async () => ({ ok: true, data: { count: 0 } })),
  duplicateBlock: vi.fn(),
  getBlockRowVersions: vi.fn(async () => ({ ok: true, data: { blocks: [] } })),
  getBlockState: vi.fn(async () => ({ ok: true, data: { exists: false, rowVersion: 0, payload: null } })),
}));

import { SectionEditor } from "@/features/manuals/editor/section-editor";

const textBlock = (id: string, content: unknown, position: number) => ({
  id,
  type: "text" as const,
  payload: { type: "text", schemaVersion: 1, content } as Record<string, unknown>,
  position,
  imageAssetId: null,
  parameterGroupIds: [] as string[],
  rowVersion: 1,
});

function makeSection(blocks: ReturnType<typeof textBlock>[]): ManualViewModel["sections"][number] {
  return {
    id: "sec-1",
    key: "disclaimer",
    title: "Pernyataan Risiko",
    required: true,
    isCustom: false,
    position: 15,
    completionState: "incomplete",
    rowVersion: 1,
    blocks,
  };
}

const vm = { parameterGroups: [] } as unknown as ManualViewModel;
const ctx = {
  images: [],
  groups: [],
  eaVersionId: "ea-1",
  parameterGroupsFull: [],
  onParametersChanged: () => {},
  onUploadImage: async () => ({ ok: false as const }),
  onUpdateImageMeta: async () => {},
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SectionEditor legacy empty-block cleanup (UAT-34)", () => {
  it("soft-deletes the empty persisted blocks, keeps the meaningful one, and reports the reduced count", async () => {
    const counts: number[] = [];
    const section = makeSection([
      textBlock("blk-empty-1", emptyRichText(), 0),
      textBlock("blk-real", richTextFromParagraphs(["Trading berisiko."]), 1),
      textBlock("blk-empty-2", emptyRichText(), 2),
    ]);

    render(
      <SectionEditor
        section={section}
        vm={vm}
        canEdit
        ctx={ctx}
        onBlocksChanged={(c) => counts.push(c)}
        onBlockSaved={() => {}}
      />,
    );

    await waitFor(() => expect(softDeleteBlock).toHaveBeenCalledTimes(2));
    const deleted = softDeleteBlock.mock.calls.map((c) => c[0].blockId).sort();
    expect(deleted).toEqual(["blk-empty-1", "blk-empty-2"]);
    // the parent is told the section now has exactly one persisted block
    expect(counts.at(-1)).toBe(1);
  });

  it("does NOT touch blocks in a read-only manual", async () => {
    const section = makeSection([textBlock("blk-empty", emptyRichText(), 0)]);
    render(<SectionEditor section={section} vm={vm} canEdit={false} ctx={ctx} onBlocksChanged={() => {}} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(softDeleteBlock).not.toHaveBeenCalled();
  });

  it("a cleaned section (empty rows already gone) triggers no further deletes on reload", async () => {
    const section = makeSection([textBlock("blk-real", richTextFromParagraphs(["Isi."]), 0)]);
    const { rerender } = render(
      <SectionEditor section={section} vm={vm} canEdit ctx={ctx} onBlocksChanged={() => {}} />,
    );
    rerender(<SectionEditor section={section} vm={vm} canEdit ctx={ctx} onBlocksChanged={() => {}} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(softDeleteBlock).not.toHaveBeenCalled();
  });
});
