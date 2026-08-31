// @vitest-environment jsdom
/**
 * UAT-22 (Phase 8A-P0) — the ONE shared renderer must render the structured changelog for the
 * changelog chapter on Preview / Public / PDF, and NO internal implementation placeholder
 * ("Phase N", "template Smartin", "akan disusun pada editor") may appear on any output path.
 *
 * Also proves AC-P7-4 web/PDF content parity still holds WITH a changelog present: the manifest
 * built from the ViewModel deep-equals the manifest parsed back out of the rendered
 * `<article class="a4-document">`.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { ManualRenderer } from "@/components/manual-renderer/manual-renderer";
import { snapshotToViewModel } from "@/lib/publication/snapshot-view-model";
import { buildOutputParityManifest, diffOutputParity } from "@/lib/publication/output-parity";
import { extractA4Document, manifestFromA4Html } from "@/tests/support/parity-html";

const SLUG = "cl-render-fixture";
const VERSION = "2.1.0";

const rt = (paras: string[]) => ({
  schemaVersion: 2 as const,
  format: "doc" as const,
  doc: { type: "doc", content: paras.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })) },
});

function snapshotWithChangelog(entries: Record<string, unknown>[]) {
  return {
    snapshotVersion: 2 as const,
    public: { slug: SLUG, version: VERSION },
    template: { id: "00000000-0000-4000-8000-0000000000cd", version: 1 },
    content: {
      manual: { locale: "id" },
      manualVersion: { version: VERSION },
      organization: { name: "PT Smartin Advisor Sistem" },
      eaProduct: { name: "Changelog Demo EA", slug: SLUG, description: "Fixture render changelog." },
      eaVersion: { version: "2.1.0", platform: "MT5", releaseDate: "2026-03-01", requirements: {}, support: {} },
      developer: "Rina Putri",
      supportedSetups: [],
      parameterGroups: [],
      sections: [
        {
          key: "cover",
          title: "Pendahuluan",
          required: true,
          isCustom: false,
          position: 0,
          blocks: [
            { type: "text", position: 0, payload: { type: "text", content: rt(["Ringkasan manual."]) }, groupRefs: [] },
          ],
        },
        {
          key: "changelog",
          title: "Riwayat Perubahan",
          required: false,
          isCustom: true,
          position: 1,
          blocks: [], // authored through the structured ChangelogEditor, not blocks
        },
      ],
      images: [],
      changelog: entries,
    },
    images: [],
  };
}

const ENTRIES = [
  { position: 0, entryType: "ADDED", body: "Menambahkan mode trailing-stop adaptif.", isFeatureChange: true, openPositionImpact: null },
  { position: 1, entryType: "FIXED", body: "Memperbaiki perhitungan lot pada akun sen.", isFeatureChange: false, openPositionImpact: null },
  {
    position: 2,
    entryType: "BREAKING",
    body: "Mengganti nama parameter RiskPercent menjadi RiskPerTrade.",
    isFeatureChange: true,
    openPositionImpact: "Tutup posisi terbuka sebelum memperbarui EA ke versi ini.",
  },
];

const vm = (entries = ENTRIES) =>
  snapshotToViewModel(snapshotWithChangelog(entries as Record<string, unknown>[]), {
    slug: SLUG,
    version: VERSION,
    status: "PUBLISHED",
  });

const html = (model = vm()) => renderToStaticMarkup(<ManualRenderer vm={model} />);

describe("UAT-22 — structured changelog renders on the shared output path", () => {
  it("renders every changelog entry body and the BREAKING open-position impact", () => {
    const out = html();
    expect(out).toContain("Menambahkan mode trailing-stop adaptif.");
    expect(out).toContain("Memperbaiki perhitungan lot pada akun sen.");
    expect(out).toContain("Mengganti nama parameter RiskPercent menjadi RiskPerTrade.");
    expect(out).toContain("Tutup posisi terbuka sebelum memperbarui EA ke versi ini.");
    // type labels
    expect(out).toContain("Perubahan besar");
  });

  it("contains NO internal implementation placeholder anywhere in the output", () => {
    const out = html();
    expect(out).not.toMatch(/Phase\s*\d/i);
    expect(out).not.toMatch(/template Smartin/i);
    expect(out).not.toMatch(/akan disusun pada editor/i);
    expect(out).not.toMatch(/will be implemented/i);
  });

  it("an empty changelog chapter shows the neutral placeholder, not internal wording", () => {
    const out = html(vm([]));
    expect(out).toContain("Bagian ini belum memiliki konten.");
    expect(out).not.toMatch(/Phase\s*\d/i);
    expect(out).not.toMatch(/template Smartin/i);
  });

  it("AC-P7-4 parity holds WITH a changelog: vm manifest == rendered-HTML manifest", () => {
    const fromVm = buildOutputParityManifest(vm());
    const fromHtml = manifestFromA4Html(extractA4Document(html()));
    expect(diffOutputParity(fromVm, fromHtml)).toEqual([]);
    // the changelog chapter really carries a changelog block
    const kinds = fromVm.chapters.flatMap((c) => c.blocks.map((b) => b.kind));
    expect(kinds).toContain("changelog");
  });

  it("a mutated changelog entry body is detected by the parity diff", () => {
    const a = buildOutputParityManifest(vm());
    const mutated = ENTRIES.map((e, i) => (i === 1 ? { ...e, body: "TEKS BERUBAH" } : e));
    const b = buildOutputParityManifest(vm(mutated));
    const diff = diffOutputParity(a, b);
    expect(diff.length).toBeGreaterThan(0);
    expect(JSON.stringify(diff)).toContain("body");
  });
});
