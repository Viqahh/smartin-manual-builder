// @vitest-environment jsdom
/**
 * UAT-20 — one FAQ block, many Q/A items. v1 payloads (draft manuals + immutable published
 * snapshots) still parse and render; new writes are v2. AC-P7-4 parity holds with a multi-item FAQ.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { ManualRenderer } from "@/components/manual-renderer/manual-renderer";
import { snapshotToViewModel } from "@/lib/publication/snapshot-view-model";
import { buildOutputParityManifest, diffOutputParity } from "@/lib/publication/output-parity";
import { extractA4Document, manifestFromA4Html } from "@/tests/support/parity-html";
import { parseBlockPayload, faqItems, draftBlockPayload, type BlockPayload } from "@/lib/domain/blocks";
import { richTextFromParagraphs } from "@/lib/domain/rich-text";

const rt = (t: string) => ({
  schemaVersion: 2 as const,
  format: "doc" as const,
  doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] },
});

describe("FAQ payload v1 ↔ v2", () => {
  it("a v1 {question,answer} payload upgrades to v2 items[] on parse", () => {
    const r = parseBlockPayload({ type: "faq", schemaVersion: 1, question: "Butuh VPS?", answer: rt("Disarankan.") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as Extract<BlockPayload, { type: "faq" }>;
      expect(v.schemaVersion).toBe(2);
      expect(v.items.map((i) => i.question)).toEqual(["Butuh VPS?"]);
    }
  });

  it("faqItems() reads BOTH shapes", () => {
    expect(faqItems({ question: "q", answer: rt("a") })).toHaveLength(1);
    expect(faqItems({ items: [{ question: "q1", answer: rt("a1") }, { question: "q2", answer: rt("a2") }] })).toHaveLength(2);
  });

  it("the FAQ draft carries an EMPTY question (no seeded placeholder string) and is not persistable", () => {
    const d = draftBlockPayload("faq") as { items: { question: string }[] };
    expect(d.items[0].question).toBe("");
    expect(parseBlockPayload(d).ok).toBe(false); // won't be written until a real question is typed
  });
});

const SLUG = "faq-multi-fixture";
const VERSION = "1.0.0";
function snapshotWithFaq(faqPayload: Record<string, unknown>) {
  return {
    snapshotVersion: 2 as const,
    public: { slug: SLUG, version: VERSION },
    template: { id: "00000000-0000-4000-8000-0000000000fa", version: 1 },
    content: {
      manual: { locale: "id" },
      manualVersion: { version: VERSION },
      organization: { name: "PT Smartin Advisor Sistem" },
      eaProduct: { name: "FAQ Demo EA", slug: SLUG, description: "fixture" },
      eaVersion: { version: "1.0.0", platform: "MT5", releaseDate: "2026-03-01", requirements: {}, support: {} },
      developer: "Dev",
      supportedSetups: [],
      parameterGroups: [],
      sections: [
        {
          key: "faq",
          title: "Pertanyaan Umum",
          required: false,
          isCustom: false,
          position: 0,
          blocks: [{ type: "faq", position: 0, payload: faqPayload, groupRefs: [] }],
        },
      ],
      images: [],
      changelog: [],
    },
    images: [],
  };
}
const vm = (payload: Record<string, unknown>) =>
  snapshotToViewModel(snapshotWithFaq(payload), { slug: SLUG, version: VERSION, status: "PUBLISHED" });
const html = (payload: Record<string, unknown>) => renderToStaticMarkup(<ManualRenderer vm={vm(payload)} />);

describe("FAQ multi-item rendering + AC-P7-4 parity", () => {
  const v2 = {
    type: "faq",
    schemaVersion: 2,
    items: [
      { question: "Bisa banyak pair?", answer: richTextFromParagraphs(["Ya, gunakan magic number berbeda."]) },
      { question: "Ubah timeframe saat berjalan?", answer: richTextFromParagraphs(["Attach ulang setelah mengubah."]) },
      { question: "Kenapa tester beda dari live?", answer: richTextFromParagraphs(["Spread, slippage, eksekusi."]) },
    ],
  };

  it("renders every Q and every A", () => {
    const out = html(v2);
    expect(out).toContain("Bisa banyak pair?");
    expect(out).toContain("Ubah timeframe saat berjalan?");
    expect(out).toContain("Kenapa tester beda dari live?");
    expect(out).toContain("Ya, gunakan magic number berbeda.");
    expect(out).toContain("Spread, slippage, eksekusi.");
    expect((out.match(/manual-faq-item/g) ?? []).length).toBe(3);
  });

  it("a v1 payload still renders (one item)", () => {
    const out = html({ type: "faq", schemaVersion: 1, question: "Butuh VPS?", answer: richTextFromParagraphs(["Disarankan."]) });
    expect(out).toContain("Butuh VPS?");
    expect(out).toContain("Disarankan.");
  });

  it("vm manifest == rendered-HTML manifest (parity) for a multi-item FAQ", () => {
    const fromVm = buildOutputParityManifest(vm(v2));
    const fromHtml = manifestFromA4Html(extractA4Document(html(v2)));
    expect(diffOutputParity(fromVm, fromHtml)).toEqual([]);
    const faqBlock = fromVm.chapters[0].blocks.find((b) => b.kind === "faq");
    expect(faqBlock && faqBlock.kind === "faq" && faqBlock.items).toHaveLength(3);
  });

  it("a changed answer in item 2 is caught by the parity diff", () => {
    const a = buildOutputParityManifest(vm(v2));
    const mutated = { ...v2, items: v2.items.map((it, i) => (i === 1 ? { ...it, answer: richTextFromParagraphs(["BERUBAH"]) } : it)) };
    const b = buildOutputParityManifest(vm(mutated));
    const diff = diffOutputParity(a, b);
    expect(diff.length).toBeGreaterThan(0);
    expect(JSON.stringify(diff)).toMatch(/items\[1\]\.answer/);
  });
});
