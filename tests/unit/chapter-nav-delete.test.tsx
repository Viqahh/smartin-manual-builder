// @vitest-environment jsdom
/**
 * Phase 8B-4 — chapter delete safety.
 *
 * Deleting a custom chapter has no undo (unlike block delete, which stashes + offers restore),
 * so the first click must never delete — it opens an inline confirmation whose default-focused
 * action is Cancel, and only an explicit second click (or Enter while the danger button itself
 * has focus) on "Ya, hapus bab …" calls onDelete. Escape cancels. Cancel never deletes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { ChapterNav } from "@/features/manuals/editor/chapter-nav";
import type { ManualViewModel } from "@/lib/manual/view-model";

type Section = ManualViewModel["sections"][number];

const chapter = (id: string, title: string, isCustom = true): Section => ({
  id,
  key: id,
  title,
  required: false,
  isCustom,
  position: 0,
  completionState: "incomplete",
  rowVersion: 1,
  blocks: [],
});

function setup(sections: Section[] = [chapter("c1", "Catatan Tambahan")]) {
  const onDelete = vi.fn();
  const onSelect = vi.fn();
  render(
    <ChapterNav
      sections={sections}
      selectedId={sections[0].id}
      canEdit
      progress={0}
      completedCount={0}
      onSelect={onSelect}
      onReorder={() => {}}
      onAdd={() => {}}
      onRename={() => {}}
      onDelete={onDelete}
    />,
  );
  return { onDelete, onSelect };
}

beforeEach(() => {
  cleanup();
});

describe("ChapterNav — delete confirmation", () => {
  it("the first click never deletes — it only opens the inline confirmation", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Hapus bab Catatan Tambahan" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: /Konfirmasi hapus bab Catatan Tambahan/i })).toBeInTheDocument();
  });

  it("shows the chapter title in the visible warning text", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Hapus bab Catatan Tambahan" }));
    const group = screen.getByRole("group", { name: /Konfirmasi hapus bab Catatan Tambahan/i });
    expect(group).toHaveTextContent("Catatan Tambahan");
    expect(group).toHaveTextContent(/Tidak dapat dibatalkan/i);
  });

  it("Cancel is the default-focused action and never deletes", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Hapus bab Catatan Tambahan" }));
    const cancel = screen.getByRole("button", { name: "Batal" });
    expect(document.activeElement).toBe(cancel); // safe default focus
    fireEvent.click(cancel);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: /Konfirmasi hapus/i })).not.toBeInTheDocument();
    // the normal row actions (including the Trash2 trigger) are back
    expect(screen.getByRole("button", { name: "Hapus bab Catatan Tambahan" })).toBeInTheDocument();
  });

  it("Escape cancels without deleting", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Hapus bab Catatan Tambahan" }));
    fireEvent.keyDown(screen.getByRole("group", { name: /Konfirmasi hapus/i }), { key: "Escape" });
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: /Konfirmasi hapus/i })).not.toBeInTheDocument();
  });

  it("confirming deletes exactly once, with the right chapter id", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Hapus bab Catatan Tambahan" }));
    fireEvent.click(screen.getByRole("button", { name: "Ya, hapus bab Catatan Tambahan" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("c1");
  });

  it("does not affect an unrelated chapter's row", () => {
    const { onDelete } = setup([chapter("c1", "Bab Satu"), chapter("c2", "Bab Dua")]);
    fireEvent.click(screen.getByRole("button", { name: "Hapus bab Bab Satu" }));
    expect(screen.getByRole("button", { name: "Hapus bab Bab Dua" })).toBeInTheDocument(); // still the plain trigger
    fireEvent.click(screen.getByRole("button", { name: "Ya, hapus bab Bab Satu" }));
    expect(onDelete).toHaveBeenCalledWith("c1");
  });

  it("a non-custom (template) chapter never shows a delete trigger at all", () => {
    setup([chapter("c1", "Instalasi", false)]);
    expect(screen.queryByRole("button", { name: /Hapus bab/i })).not.toBeInTheDocument();
  });
});
