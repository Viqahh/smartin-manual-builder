// @vitest-environment jsdom
/**
 * Phase 7 slice 5 — AC-P7-4 content parity, proven against the ACTUAL renderer output.
 *
 * `buildOutputParityManifest(vm)` (pure, from the ViewModel) must deep-equal `manifestFromA4Html`
 * built by parsing the real `<article class="a4-document">` that `<ManualRenderer>` renders — the
 * web route and the signed print route feed the SAME `vm` into that SAME renderer, so both
 * surfaces' output collapses to one manifest. The diff must be EMPTY, and it must catch every
 * class of divergence (missing / reordered chapter, changed text, changed parameter value,
 * changed image caption/alt).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { ManualRenderer } from "@/components/manual-renderer/manual-renderer";
import { snapshotToViewModel } from "@/lib/publication/snapshot-view-model";
import { buildOutputParityManifest, diffOutputParity } from "@/lib/publication/output-parity";
import { extractA4Document, manifestFromA4Html } from "@/tests/support/parity-html";
import {
  parityComprehensiveSnapshot,
  PARITY_SLUG,
  PARITY_VERSION,
} from "@/tests/support/parity-fixture";

const vm = () =>
  snapshotToViewModel(parityComprehensiveSnapshot(), {
    slug: PARITY_SLUG,
    version: PARITY_VERSION,
    status: "PUBLISHED",
  });

const renderedManifest = (model = vm()) =>
  manifestFromA4Html(extractA4Document(renderToStaticMarkup(<ManualRenderer vm={model} />)));

describe("output parity manifest — determinism", () => {
  it("is deterministic (same vm ⇒ identical manifest)", () => {
    expect(buildOutputParityManifest(vm())).toEqual(buildOutputParityManifest(vm()));
  });

  it("covers every public block type from the comprehensive fixture", () => {
    const kinds = new Set(
      buildOutputParityManifest(vm()).chapters.flatMap((c) => c.blocks.map((b) => b.kind)),
    );
    for (const k of ["text", "callout", "faq", "steps", "image", "parameterTable", "supportedSetups", "placeholder"]) {
      expect(kinds.has(k as never), `manifest is missing block kind "${k}"`).toBe(true);
    }
    // 14 chapters, a long (24-row) parameter table, a step image, a standalone image
    const man = buildOutputParityManifest(vm());
    expect(man.chapters).toHaveLength(14);
    const longTable = man.chapters
      .flatMap((c) => c.blocks)
      .find((b) => b.kind === "parameterTable" && b.groups.some((g) => g.paramCount === 24));
    expect(longTable, "24-row parameter table present").toBeTruthy();
  });
});

describe("output parity — web (renderer) == pdf-source (same renderer)", () => {
  it("comprehensive fixture: content-model diff is EMPTY", () => {
    const fromVm = buildOutputParityManifest(vm());
    const fromHtml = renderedManifest();
    const diff = diffOutputParity(fromVm, fromHtml);
    expect(diff, JSON.stringify(diff, null, 2)).toEqual([]);
  });

  it("manual header (title / version / platform / EA version) matches the rendered cover", () => {
    expect(renderedManifest().manual).toEqual({
      title: "Parity Demo EA",
      publicVersion: "1.0.0",
      platform: "MT5",
      eaVersion: "3.1.0",
    });
  });
});

describe("output parity diff — catches divergence", () => {
  it("detects a MISSING chapter", () => {
    const a = buildOutputParityManifest(vm());
    const b = buildOutputParityManifest(vm());
    b.chapters.splice(5, 1);
    const d = diffOutputParity(a, b);
    expect(d.some((x) => x.path === "chapters.length")).toBe(true);
  });

  it("detects a REORDERED block", () => {
    const a = buildOutputParityManifest(vm());
    const b = buildOutputParityManifest(vm());
    const blocks = b.chapters[3].blocks;
    [blocks[0], blocks[1]] = [blocks[1], blocks[0]];
    const d = diffOutputParity(a, b);
    expect(d.some((x) => x.path.startsWith("chapters[3].blocks[0]"))).toBe(true);
  });

  it("detects CHANGED visible text", () => {
    const a = buildOutputParityManifest(vm());
    const b = buildOutputParityManifest(vm());
    const t = b.chapters[9].blocks[0];
    if (t.kind === "text") t.text = t.text.replace("bulan-mengelilingi-bumi", "matahari-terbenam");
    const d = diffOutputParity(a, b);
    expect(d).toEqual([
      expect.objectContaining({ path: "chapters[9].blocks[0].text", web: expect.stringContaining("bulan-mengelilingi-bumi") }),
    ]);
  });

  it("detects a CHANGED parameter default value", () => {
    const a = buildOutputParityManifest(vm());
    const b = buildOutputParityManifest(vm());
    const pt = b.chapters[4].blocks[1];
    if (pt.kind === "parameterTable") pt.groups[0].parameters[7].defaultValue = "9.99";
    const d = diffOutputParity(a, b);
    expect(d).toEqual([
      { path: "chapters[4].blocks[1].groups[0].parameters[7].defaultValue", web: "0.08", pdf: "9.99" },
    ]);
  });

  it("detects a CHANGED image caption and alt", () => {
    const a = buildOutputParityManifest(vm());
    const b = buildOutputParityManifest(vm());
    const img = b.chapters[3].blocks[2];
    if (img.kind === "image" && img.image) {
      img.image.caption = "Gambar 2 — DIUBAH.";
      img.image.alt = "alt diubah";
    }
    const d = diffOutputParity(a, b);
    expect(d.map((x) => x.path).sort()).toEqual([
      "chapters[3].blocks[2].image.alt",
      "chapters[3].blocks[2].image.caption",
    ]);
  });

  it("detects a CHANGED step-image caption", () => {
    const a = buildOutputParityManifest(vm());
    const b = buildOutputParityManifest(vm());
    const st = b.chapters[2].blocks[0];
    if (st.kind === "steps" && st.steps[1].image) st.steps[1].image.caption = "berbeda";
    const d = diffOutputParity(a, b);
    expect(d.some((x) => x.path === "chapters[2].blocks[0].steps[1].image.caption")).toBe(true);
  });
});
