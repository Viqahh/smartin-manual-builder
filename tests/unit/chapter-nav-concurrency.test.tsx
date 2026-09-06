// @vitest-environment jsdom
/**
 * Phase 8B-6 review follow-up — chapter structural mutations (add / rename / reorder / delete)
 * are serialized: ManualBuilder holds a synchronous in-flight ref and passes `pending` down so
 * ChapterNav disables every mutation control while a request is outstanding. This guarantees:
 *   - a failing older request can only ever revert its OWN snapshot (no second mutation can have
 *     started, so nothing later can be wiped);
 *   - rapid repeated clicks on delete / add / reorder cannot issue duplicate requests.
 *
 * This file covers ChapterNav's half of the contract (the visible disabling + the guarded
 * callbacks). The ref-level guard in ManualBuilder is covered by code review + live failure
 * injection (see the 8B-6 report); ManualBuilder itself is not unit-mounted here for the same
 * reason chapter-nav-delete.test.tsx tests ChapterNav in isolation — its editor subtree pulls
 * in server-only modules.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { ChapterNav } from "@/features/manuals/editor/chapter-nav";
import type { ManualViewModel } from "@/lib/manual/view-model";

type Section = ManualViewModel["sections"][number];

const chapter = (id: string, title: string, position = 0): Section => ({
  id,
  key: id,
  title,
  required: false,
  isCustom: true,
  position,
  completionState: "incomplete",
  rowVersion: 1,
  blocks: [],
});

function setup(pending: boolean, sections: Section[] = [chapter("c1", "Bab Satu", 0), chapter("c2", "Bab Dua", 1)]) {
  const cb = {
    onSelect: vi.fn(),
    onReorder: vi.fn(),
    onAdd: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  };
  const el = (p: boolean): ReactElement => (
    <ChapterNav
      sections={sections}
      selectedId={sections[0].id}
      canEdit
      progress={0}
      completedCount={0}
      pending={p}
      {...cb}
    />
  );
  const view = render(el(pending));
  return { cb, goPending: () => view.rerender(el(true)) };
}

beforeEach(() => {
  cleanup();
});

describe("ChapterNav — mutation serialization while a request is pending", () => {
  it("baseline (not pending): one click on ▼ issues exactly one reorder", () => {
    const { cb } = setup(false);
    fireEvent.click(screen.getByRole("button", { name: "Turunkan bab Bab Satu" }));
    expect(cb.onReorder).toHaveBeenCalledTimes(1);
  });

  it("pending: the reorder / rename / delete / add-toggle controls are all disabled", () => {
    setup(true);
    expect(screen.getByRole("button", { name: "Naikkan bab Bab Dua" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Turunkan bab Bab Satu" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ubah judul bab Bab Satu" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hapus bab Bab Satu" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Seret untuk memindahkan bab Bab Satu/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tambah bab kustom" })).toBeDisabled();
  });

  it("pending: repeated rapid clicks on a move control issue zero reorder requests", () => {
    const { cb } = setup(true);
    const down = screen.getByRole("button", { name: "Turunkan bab Bab Satu" });
    fireEvent.click(down);
    fireEvent.click(down);
    fireEvent.click(down);
    expect(cb.onReorder).not.toHaveBeenCalled();
  });

  it("pending: a drag-start on the handle is prevented (no concurrent reorder via DnD)", () => {
    const { cb } = setup(true);
    const handle = screen.getByRole("button", { name: /Seret untuk memindahkan bab Bab Satu/ });
    const ev = new Event("dragstart", { bubbles: true, cancelable: true });
    // jsdom has no DataTransfer; the handler must bail before touching it
    fireEvent(handle, ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(cb.onReorder).not.toHaveBeenCalled();
  });

  it("a form left open when a mutation starts cannot submit: add", () => {
    const { cb, goPending } = setup(false);
    fireEvent.click(screen.getByRole("button", { name: "Tambah bab kustom" })); // open while idle
    fireEvent.change(screen.getByPlaceholderText("Judul bab baru"), { target: { value: "Bab Baru" } });
    goPending(); // a different chapter mutation begins
    fireEvent.submit(screen.getByPlaceholderText("Judul bab baru").closest("form")!);
    expect(cb.onAdd).not.toHaveBeenCalled();
  });

  it("a form left open when a mutation starts cannot submit: rename", () => {
    const { cb, goPending } = setup(false);
    fireEvent.click(screen.getByRole("button", { name: "Ubah judul bab Bab Satu" })); // open while idle
    fireEvent.change(screen.getByDisplayValue("Bab Satu"), { target: { value: "Nama Baru" } });
    goPending();
    fireEvent.submit(screen.getByDisplayValue("Nama Baru").closest("form")!);
    expect(cb.onRename).not.toHaveBeenCalled();
  });

  it("a delete confirmation open when a mutation starts cannot confirm", () => {
    const { cb, goPending } = setup(false);
    fireEvent.click(screen.getByRole("button", { name: "Hapus bab Bab Satu" })); // open confirm while idle
    goPending();
    const confirm = screen.getByRole("button", { name: "Ya, hapus bab Bab Satu" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(cb.onDelete).not.toHaveBeenCalled();
  });

  it("pending and error can be shown at the same time (independent props)", () => {
    render(
      <ChapterNav
        sections={[chapter("c1", "Bab Satu")]}
        selectedId="c1"
        canEdit
        progress={0}
        completedCount={0}
        pending
        error="Gagal mengubah urutan bab. Coba lagi."
        onSelect={() => {}}
        onReorder={() => {}}
        onAdd={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Gagal mengubah urutan bab. Coba lagi.");
  });
});
