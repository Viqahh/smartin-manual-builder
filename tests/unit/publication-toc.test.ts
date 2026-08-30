/**
 * Phase 7 slice 2 — public table of contents (spec §29).
 *
 * `buildToc` is a pure projection of `vm.sections` in the SAME order `ManualRenderer` renders.
 * Anchors come from the shared `chapterAnchor(index)` helper — never a DB id.
 */

import { describe, it, expect } from "vitest";
import { buildToc } from "@/lib/publication/toc";
import { chapterAnchor, type ManualViewModel } from "@/lib/manual/view-model";

const section = (over: Partial<ManualViewModel["sections"][number]>): ManualViewModel["sections"][number] => ({
  id: crypto.randomUUID(),
  key: "k",
  title: "Bab",
  required: true,
  isCustom: false,
  position: 0,
  completionState: "complete",
  rowVersion: 0,
  blocks: [],
  ...over,
});

const vmWith = (sections: ManualViewModel["sections"]): ManualViewModel =>
  ({
    manual: { id: "", locale: "id" },
    manualVersion: { id: "", version: "1.0.0", status: "PUBLISHED", rowVersion: 0, updatedAt: "" },
    eaProduct: { id: "", name: "EA", slug: "ea", description: "" },
    eaVersion: { id: "", version: "1.0.0", platform: "MT5", releaseDate: null, requirements: {}, support: {} },
    organization: { id: "", name: "Org" },
    developer: null,
    supportedSetups: [],
    sections,
    parameterGroups: [],
    images: {},
    changelog: [],
  }) as ManualViewModel;

describe("buildToc", () => {
  it("order and numbering follow vm.sections exactly; anchors are chapter-<index>", () => {
    const vm = vmWith([
      section({ key: "cover", title: "Pendahuluan", position: 0 }),
      section({ key: "install", title: "Instalasi", position: 1 }),
      section({ key: "params", title: "Parameter", position: 2 }),
    ]);
    expect(buildToc(vm)).toEqual([
      { number: 1, title: "Pendahuluan", anchor: "chapter-0" },
      { number: 2, title: "Instalasi", anchor: "chapter-1" },
      { number: 3, title: "Parameter", anchor: "chapter-2" },
    ]);
    expect(buildToc(vm).map((t) => t.anchor)).toEqual(vm.sections.map((_, i) => chapterAnchor(i)));
  });

  it("duplicate chapter titles still get unique anchors", () => {
    const vm = vmWith([
      section({ title: "Catatan", position: 0 }),
      section({ title: "Catatan", position: 1 }),
    ]);
    const anchors = buildToc(vm).map((t) => t.anchor);
    expect(new Set(anchors).size).toBe(2);
    expect(anchors).toEqual(["chapter-0", "chapter-1"]);
  });

  it("a custom chapter is included", () => {
    const vm = vmWith([
      section({ title: "Kanonik", isCustom: false, position: 0 }),
      section({ title: "Bab Kustom", isCustom: true, key: "custom-abc", position: 1 }),
    ]);
    expect(buildToc(vm).map((t) => t.title)).toEqual(["Kanonik", "Bab Kustom"]);
  });

  it("an empty section (no blocks) is still listed — the renderer renders it", () => {
    const vm = vmWith([
      section({ title: "Isi", blocks: [{ id: "b", type: "text", payload: {}, position: 0, imageAssetId: null, parameterGroupIds: [], rowVersion: 0 }], position: 0 }),
      section({ title: "Kosong", blocks: [], position: 1 }),
    ]);
    expect(buildToc(vm).map((t) => t.title)).toEqual(["Isi", "Kosong"]);
  });

  it("a blank title falls back to a chapter label but the anchor stays deterministic", () => {
    const vm = vmWith([section({ title: "", position: 0 })]);
    expect(buildToc(vm)).toEqual([{ number: 1, title: "Bab 1", anchor: "chapter-0" }]);
  });
});
