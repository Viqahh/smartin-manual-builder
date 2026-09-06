// @vitest-environment jsdom
/**
 * Phase 8B-6 (live audit finding) — add/rename/reorder/delete used to fire-and-forget the
 * server result: a failed request was never surfaced to the user, and reorder/rename/delete
 * apply an optimistic UI change before the request resolves, so a failure could leave the
 * chapter list silently diverged from the server. `ManualBuilder` now reverts the optimistic
 * change and passes an `error` message down to `ChapterNav`; this covers `ChapterNav`'s half
 * of that contract — that the message is actually rendered as a visible, announced alert.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ChapterNav } from "@/features/manuals/editor/chapter-nav";
import type { ManualViewModel } from "@/lib/manual/view-model";

type Section = ManualViewModel["sections"][number];

const chapter = (id: string, title: string): Section => ({
  id,
  key: id,
  title,
  required: false,
  isCustom: true,
  position: 0,
  completionState: "incomplete",
  rowVersion: 1,
  blocks: [],
});

function setup(error?: string | null) {
  render(
    <ChapterNav
      sections={[chapter("c1", "Bab Satu")]}
      selectedId="c1"
      canEdit
      progress={0}
      completedCount={0}
      onSelect={() => {}}
      onReorder={() => {}}
      onAdd={() => {}}
      onRename={() => {}}
      onDelete={() => {}}
      error={error}
    />,
  );
}

beforeEach(() => {
  cleanup();
});

describe("ChapterNav — chapter-action error surfacing", () => {
  it("renders no alert when there is no error", () => {
    setup(null);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the error message as an announced alert", () => {
    setup("Gagal menghapus bab. Bab dikembalikan.");
    expect(screen.getByRole("alert")).toHaveTextContent("Gagal menghapus bab. Bab dikembalikan.");
  });
});
