// @vitest-environment jsdom
/**
 * UAT-21 + UAT-33 (Phase 8A-P0).
 *
 * UAT-21 (deployed stuck condition): `ChangelogEditor` must NOT call `router.refresh()` — it
 * self-reconciles locally (create adopts the real id so a 2nd Save updates and never duplicates;
 * delete removes the row; controls stay usable; a "Tersimpan" state shows).
 *
 * UAT-33 (placement/editing UX): the structured changelog is authored INLINE inside the BAB 14
 * document canvas — no separate management panel. A saved entry renders as a compact content card;
 * "Edit" expands it inline; "Simpan" collapses it again; "Tambah entri" opens an inline editor.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

// in-memory changelog "DB" so create/update/delete are observable and ordered
type Rec = { id: string; body: string; entryType: string; position: number };
let db: Rec[] = [];
let seq = 0;
const updateChangelogEntry = vi.fn(async ({ entryId, entry }: { entryId: string; entry: { body: string; entryType: string } }) => {
  const r = db.find((x) => x.id === entryId);
  if (!r) return { ok: false as const, message: "not found" };
  r.body = entry.body;
  r.entryType = entry.entryType;
  return { ok: true as const, data: { id: entryId } };
});
const createChangelogEntry = vi.fn(async ({ entry }: { entry: { body: string; entryType: string } }) => {
  const id = `db-${++seq}`;
  db.push({ id, body: entry.body, entryType: entry.entryType, position: db.length });
  return { ok: true as const, data: { id, position: db.length - 1 } };
});
const deleteChangelogEntry = vi.fn(async ({ entryId }: { entryId: string }) => {
  db = db.filter((x) => x.id !== entryId);
  return { ok: true as const, data: { id: entryId } };
});
const reorderChangelogEntries = vi.fn(async ({ orderedIds }: { orderedIds: string[] }) => {
  orderedIds.forEach((id, i) => {
    const r = db.find((x) => x.id === id);
    if (r) r.position = i;
  });
  return { ok: true as const, data: { count: orderedIds.length } };
});
vi.mock("@/features/changelog/actions", () => ({
  updateChangelogEntry: (...a: unknown[]) => updateChangelogEntry(...(a as [never])),
  createChangelogEntry: (...a: unknown[]) => createChangelogEntry(...(a as [never])),
  deleteChangelogEntry: (...a: unknown[]) => deleteChangelogEntry(...(a as [never])),
  reorderChangelogEntries: (...a: unknown[]) => reorderChangelogEntries(...(a as [never])),
}));

import { ChangelogEditor } from "@/features/changelog/changelog-editor";

const EA_ID = "e0000000-0000-4000-8000-00000000000e";
const baseProps = {
  manualVersionId: "mv-1",
  canEdit: true,
  pbkScope: "IN_SCOPE" as const,
  sourceOptions: [{ id: EA_ID, label: "v1.0.0 (MT5)" }],
  linkedEaVersionId: EA_ID,
};
const seededEntry = {
  id: "db-seed",
  position: 0,
  entryType: "ADDED" as const,
  body: "Rilis awal.",
  sourceEaVersionId: EA_ID,
  isFeatureChange: false,
  openPositionImpact: null,
};

const bodyBox = () => screen.getByLabelText("Uraian perubahan") as HTMLTextAreaElement;
const queryBodyBox = () => screen.queryByLabelText("Uraian perubahan");
const saveBtn = () => screen.getByRole("button", { name: /Simpan|Menyimpan/ });
const editBtn = () => screen.getByRole("button", { name: /^Edit/ });
const addBtn = () => screen.getByRole("button", { name: /Tambah entri/ });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  db = [{ id: "db-seed", body: "Rilis awal.", entryType: "ADDED", position: 0 }];
  seq = 0;
});

describe("UAT-33 — inline collapsed/expanded changelog authoring", () => {
  it("a saved entry renders COLLAPSED (content card, no editable fields) with an Edit action", () => {
    render(<ChangelogEditor {...baseProps} entries={[seededEntry]} />);
    // body text is shown as content…
    expect(screen.getByText("Rilis awal.")).toBeInTheDocument();
    // …but no editor fields for it yet
    expect(queryBodyBox()).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(editBtn()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hapus/ })).toBeInTheDocument();
  });

  it("Edit expands inline; Cancel collapses back without a write", () => {
    render(<ChangelogEditor {...baseProps} entries={[seededEntry]} />);
    fireEvent.click(editBtn());
    expect(bodyBox()).toBeInTheDocument();
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);

    fireEvent.change(bodyBox(), { target: { value: "diketik lalu dibatalkan" } });
    fireEvent.click(screen.getByRole("button", { name: /Batal/ }));

    expect(queryBodyBox()).not.toBeInTheDocument(); // collapsed again
    expect(screen.getByText("Rilis awal.")).toBeInTheDocument(); // reverted to the saved value
    expect(updateChangelogEntry).not.toHaveBeenCalled();
  });

  it("Edit → change → Simpan collapses back to the compact card with the new value", async () => {
    render(<ChangelogEditor {...baseProps} entries={[seededEntry]} />);
    fireEvent.click(editBtn());
    fireEvent.change(bodyBox(), { target: { value: "Rilis awal — diperbarui." } });
    fireEvent.click(saveBtn());

    await waitFor(() => expect(updateChangelogEntry).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryBodyBox()).not.toBeInTheDocument()); // collapsed
    expect(screen.getByText("Rilis awal — diperbarui.")).toBeInTheDocument();
    expect(db[0].body).toBe("Rilis awal — diperbarui.");
    expect(refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Tersimpan")).toBeInTheDocument());
  });

  it("Tambah entri opens an inline editor; successful create collapses to a saved card with the server id", async () => {
    db = [];
    render(<ChangelogEditor {...baseProps} entries={[]} />);

    fireEvent.click(addBtn());
    expect(bodyBox()).toBeInTheDocument(); // inline editor, in the canvas
    fireEvent.change(bodyBox(), { target: { value: "Entri baru." } });
    fireEvent.click(saveBtn());

    await waitFor(() => expect(createChangelogEntry).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryBodyBox()).not.toBeInTheDocument()); // collapsed to summary
    expect(screen.getByText("Entri baru.")).toBeInTheDocument();
    expect(db).toHaveLength(1);
    expect(db[0].id).toBe("db-1"); // adopted the server id
    expect(refresh).not.toHaveBeenCalled();
  });

  it("editing the just-created entry a 2nd time UPDATES the same row — never a duplicate", async () => {
    db = [];
    render(<ChangelogEditor {...baseProps} entries={[]} />);
    fireEvent.click(addBtn());
    fireEvent.change(bodyBox(), { target: { value: "Entri baru." } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(db).toHaveLength(1));

    fireEvent.click(editBtn());
    fireEvent.change(bodyBox(), { target: { value: "Entri baru — v2." } });
    fireEvent.click(saveBtn());

    await waitFor(() => expect(updateChangelogEntry).toHaveBeenCalledTimes(1));
    expect(createChangelogEntry).toHaveBeenCalledTimes(1); // NOT called again
    expect(db).toHaveLength(1); // no duplicate
    expect(db[0].body).toBe("Entri baru — v2.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("delete removes the row locally, no route refresh; reorder stays functional", async () => {
    db = [
      { id: "db-seed", body: "Rilis awal.", entryType: "ADDED", position: 0 },
      { id: "db-2", body: "Perbaikan.", entryType: "ADDED", position: 1 },
    ];
    const second = { ...seededEntry, id: "db-2", body: "Perbaikan.", position: 1 };
    render(<ChangelogEditor {...baseProps} entries={[seededEntry, second]} />);

    const cards = () => screen.getAllByRole("listitem");
    expect(cards()).toHaveLength(2);

    // reorder: move the 2nd entry up
    fireEvent.click(within(cards()[1]).getByRole("button", { name: /Naikkan entri/ }));
    await waitFor(() => expect(reorderChangelogEntries).toHaveBeenCalledTimes(1));

    fireEvent.click(within(screen.getAllByRole("listitem")[1]).getByRole("button", { name: /Hapus/ }));
    await waitFor(() => expect(deleteChangelogEntry).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(db).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(addBtn()).toBeEnabled();
  });

  it("renders as inline canvas content — NOT the old separate .cl-editor panel", () => {
    const { container } = render(<ChangelogEditor {...baseProps} entries={[seededEntry]} />);
    expect(container.querySelector(".cl-editor")).toBeNull(); // old floating panel gone
    expect(container.querySelector(".cl-head-row")).toBeNull();
    const canvas = container.querySelector(".cl-canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.querySelector("h3")).toBeNull(); // no panel-level heading, only a subtle label
  });
});
