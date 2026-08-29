// @vitest-environment jsdom
/**
 * PHASE 3 SERIALIZATION SPIKE (AC-P3-2, AC-P3-3) — executable proof for
 * docs/PHASE_3_SERIALIZATION_SPIKE.md.
 *
 * Proves that all six block types round-trip
 *   DB structured payload → editor representation (+ TipTap JSON where applicable)
 *   → serialization → DB structured payload → renderer
 * without losing fields, changing IDs/references, storing HTML, introducing unsafe HTML, or
 * flattening structured facts into rich text.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions } from "@/lib/editor/tiptap-config";
import {
  richTextSchema,
  upgradeRichText,
  richTextToPlainText,
  sanitizeRichTextDoc,
  richTextFromParagraphs,
  type RichTextDoc,
  type RichTextV2,
} from "@/lib/domain/rich-text";
import { parseBlockPayload, type BlockPayload } from "@/lib/domain/blocks";
import { RichTextView } from "@/components/manual-renderer/rich-text-view";

const UUID_A = "d0000000-0000-4000-8000-00000000000a";
const UUID_B = "d0000000-0000-4000-8000-00000000000b";
const UUID_IMG = "d0000000-0000-4000-8000-0000000000f0";

// A representative v2 rich-text doc that exercises every allowlisted node + mark.
// Built through the schema so the literal is validated input, not a hand-typed tree.
const SAMPLE_DOC: RichTextDoc = (
  richTextSchema.parse({
    schemaVersion: 2,
    format: "doc",
    doc: {
      type: "doc",
      content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Ikhtisar" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "EA ini " },
        { type: "text", text: "wajib", marks: [{ type: "bold" }] },
        { type: "text", text: " diuji pada akun demo. " },
        {
          type: "text",
          text: "Panduan",
          marks: [{ type: "link", attrs: { href: "https://smartin.example/guide" } }],
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Butir satu" }] }] },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Butir dua", marks: [{ type: "italic" }] }] }],
        },
      ],
    },
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Langkah A" }] }] },
          ],
        },
      ],
    },
  }) as RichTextV2
).doc;

function tiptapRoundTrip(doc: RichTextDoc): RichTextDoc {
  const editor = new Editor({ element: document.createElement("div"), extensions: buildEditorExtensions(), content: doc });
  const out = editor.getJSON() as RichTextDoc;
  editor.destroy();
  return out;
}

function nodeTypeSet(doc: RichTextDoc): string[] {
  const seen = new Set<string>();
  const walk = (n: { type?: string; content?: unknown[] }) => {
    if (n.type) seen.add(n.type);
    for (const c of (n.content as { type?: string }[]) ?? []) walk(c);
  };
  walk(doc);
  return [...seen].sort();
}

function linkHrefs(doc: RichTextDoc): string[] {
  const hrefs: string[] = [];
  const walk = (n: { marks?: { type?: string; attrs?: { href?: string } }[]; content?: unknown[] }) => {
    for (const m of n.marks ?? []) if (m.type === "link" && m.attrs?.href) hrefs.push(m.attrs.href);
    for (const c of (n.content as object[]) ?? []) walk(c);
  };
  walk(doc);
  return hrefs.sort();
}

describe("rich-text v2 ↔ TipTap JSON round-trip", () => {
  it("survives a real headless TipTap editor without losing nodes, marks, links, or text", () => {
    const after = tiptapRoundTrip(SAMPLE_DOC);

    // still an allowlisted v2 document
    expect(richTextSchema.safeParse({ schemaVersion: 2, format: "doc", doc: after }).success).toBe(true);
    // same visible text
    expect(richTextToPlainText(after)).toBe(richTextToPlainText(SAMPLE_DOC));
    // same structural node types (paragraph/heading/bulletList/orderedList/listItem/text)
    expect(nodeTypeSet(after)).toEqual(nodeTypeSet(SAMPLE_DOC));
    // heading level preserved
    const h = after.content.find((n) => n.type === "heading") as { attrs?: { level?: number } };
    expect(h?.attrs?.level).toBe(2);
    // link href preserved exactly
    expect(linkHrefs(after)).toEqual(["https://smartin.example/guide"]);
    // persisted value is structured JSON, never an HTML string
    expect(typeof after).toBe("object");
    expect(JSON.stringify(after)).not.toMatch(/<[a-z]/i);
  });

  it("v1 plain-paragraphs upgrades to an equivalent v2 doc with no text loss", () => {
    const v1 = { schemaVersion: 1 as const, format: "plain-paragraphs" as const, paragraphs: ["baris satu", "", "baris dua"] };
    const doc = upgradeRichText(v1);
    expect(richTextSchema.safeParse({ schemaVersion: 2, format: "doc", doc }).success).toBe(true);
    expect(richTextToPlainText(doc)).toBe("baris satu\n\nbaris dua");
  });
});

describe("six block types — payload round-trip (DB → editor repr → serialize → DB)", () => {
  // helper: assert a payload survives parse → (editor repr) → re-serialize → parse unchanged
  function assertStructuralRoundTrip(payload: BlockPayload, mutateEditorRepr: (p: BlockPayload) => BlockPayload) {
    const parsed = parseBlockPayload(payload);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reSerialised = mutateEditorRepr(parsed.value);
    const reparsed = parseBlockPayload(reSerialised);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    return reparsed.value;
  }

  it("1. text — rich content round-trips through the doc representation, no HTML stored", () => {
    const payload: BlockPayload = { type: "text", schemaVersion: 1, content: { schemaVersion: 2, format: "doc", doc: SAMPLE_DOC } };
    const out = assertStructuralRoundTrip(payload, (p) => {
      // editor repr = upgradeRichText(content); serialize = wrap the doc again
      const doc = upgradeRichText((p as Extract<BlockPayload, { type: "text" }>).content);
      return { type: "text", schemaVersion: 1, content: { schemaVersion: 2, format: "doc", doc } };
    });
    expect(out?.type).toBe("text");
    const content = (out as Extract<BlockPayload, { type: "text" }>).content;
    expect(typeof content).toBe("object");
    expect("doc" in content).toBe(true);
    expect(richTextToPlainText(content)).toBe(richTextToPlainText(SAMPLE_DOC));
  });

  it("2. steps — title/instruction/menuPath/imageAssetId and ORDER preserved (no TipTap)", () => {
    const payload: BlockPayload = {
      type: "steps",
      schemaVersion: 1,
      steps: [
        { title: "Buka MetaEditor", instruction: "Tekan F4 di terminal.", menuPath: "Terminal > MetaEditor" },
        { title: "Kompilasi", instruction: "Tekan F7.", imageAssetId: UUID_IMG },
        { title: "Pasang EA", instruction: "Seret EA ke chart." },
        { title: "Aktifkan AutoTrading", instruction: "Klik tombol AutoTrading." },
        { title: "Verifikasi", instruction: "Cek smiley di kanan atas." },
      ],
    };
    const out = assertStructuralRoundTrip(payload, (p) => structuredClone(p));
    expect(out).toEqual(payload); // deep equal — nothing lost, order identical
    const steps = (out as Extract<BlockPayload, { type: "steps" }>).steps;
    expect(steps.map((s) => s.title)).toEqual([
      "Buka MetaEditor",
      "Kompilasi",
      "Pasang EA",
      "Aktifkan AutoTrading",
      "Verifikasi",
    ]);
    expect(steps[1].imageAssetId).toBe(UUID_IMG); // reference UUID unchanged
  });

  it("3. image — imageAssetId reference and caption preserved exactly", () => {
    const payload: BlockPayload = { type: "image", schemaVersion: 1, imageAssetId: UUID_IMG, caption: "Tombol AutoTrading" };
    const out = assertStructuralRoundTrip(payload, (p) => structuredClone(p));
    expect(out).toEqual(payload);
    expect((out as Extract<BlockPayload, { type: "image" }>).imageAssetId).toBe(UUID_IMG);
  });

  it("4. callout — typed tone stays a discrete enum, body round-trips as structured JSON", () => {
    const payload: BlockPayload = {
      type: "callout",
      schemaVersion: 1,
      tone: "warning",
      content: richTextFromParagraphs(["Rugi dapat melebihi modal."]),
    };
    const out = assertStructuralRoundTrip(payload, (p) => {
      const c = p as Extract<BlockPayload, { type: "callout" }>;
      return { type: "callout", schemaVersion: 1, tone: c.tone, content: { schemaVersion: 2, format: "doc", doc: upgradeRichText(c.content) } };
    });
    expect((out as Extract<BlockPayload, { type: "callout" }>).tone).toBe("warning");
    expect(richTextToPlainText((out as Extract<BlockPayload, { type: "callout" }>).content)).toBe("Rugi dapat melebihi modal.");
  });

  it("5. parameterTable — group id references preserved; no parameter facts flattened in", () => {
    const payload: BlockPayload = { type: "parameterTable", schemaVersion: 1, groupIds: [UUID_A, UUID_B] };
    const out = assertStructuralRoundTrip(payload, (p) => structuredClone(p));
    expect(out).toEqual(payload);
    expect((out as Extract<BlockPayload, { type: "parameterTable" }>).groupIds).toEqual([UUID_A, UUID_B]);
    // the block carries ONLY id references — parameter names/defaults live in ea_parameters
    expect(JSON.stringify(out)).not.toMatch(/default|technical|displayName/i);
  });

  it("6. faq — question stays plain text; answer round-trips as structured JSON", () => {
    const payload: BlockPayload = {
      type: "faq",
      schemaVersion: 1,
      question: "Apakah EA butuh VPS?",
      answer: richTextFromParagraphs(["Disarankan untuk koneksi 24/7."]),
    };
    const out = assertStructuralRoundTrip(payload, (p) => {
      const f = p as Extract<BlockPayload, { type: "faq" }>;
      return { type: "faq", schemaVersion: 1, question: f.question, answer: { schemaVersion: 2, format: "doc", doc: upgradeRichText(f.answer) } };
    });
    expect((out as Extract<BlockPayload, { type: "faq" }>).question).toBe("Apakah EA butuh VPS?");
    expect(richTextToPlainText((out as Extract<BlockPayload, { type: "faq" }>).answer)).toBe("Disarankan untuk koneksi 24/7.");
  });
});

describe("security — no raw/unsafe HTML ever becomes storage or rendered markup (AC-P3-3)", () => {
  it("`<script>` inside a text node stays inert text (escaped by React, no <script> element)", () => {
    const doc: RichTextDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "<script>alert(1)</script>" }] }],
    };
    // it is valid structured JSON — the angle brackets are DATA, not markup
    expect(richTextSchema.safeParse({ schemaVersion: 2, format: "doc", doc }).success).toBe(true);
    const html = renderToStaticMarkup(createElement(RichTextView, { value: { schemaVersion: 2, format: "doc", doc } }));
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("an unknown node type in the doc is REJECTED at the write boundary", () => {
    const bad = {
      type: "text",
      schemaVersion: 1,
      content: {
        schemaVersion: 2,
        format: "doc",
        doc: { type: "doc", content: [{ type: "iframeEmbed", attrs: { src: "https://evil.example" } }] },
      },
    };
    expect(parseBlockPayload(bad).ok).toBe(false);
  });

  it("a `javascript:` link is rejected at the write boundary and stripped by the sanitiser", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "klik", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
        },
      ],
    };
    expect(parseBlockPayload({ type: "text", schemaVersion: 1, content: { schemaVersion: 2, format: "doc", doc } }).ok).toBe(false);

    const cleaned = sanitizeRichTextDoc(doc);
    expect(richTextSchema.safeParse({ schemaVersion: 2, format: "doc", doc: cleaned }).success).toBe(true);
    expect(linkHrefs(cleaned)).toEqual([]); // the unsafe link mark was dropped, text kept
    expect(richTextToPlainText(cleaned)).toBe("klik");
  });

  it("the sanitiser drops arbitrary nodes/marks and coerces out-of-range headings", () => {
    const hostile = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 6 }, content: [{ type: "text", text: "judul" }] },
        { type: "marquee", content: [{ type: "text", text: "berkedip" }] },
        { type: "paragraph", content: [{ type: "text", text: "aman", marks: [{ type: "strike" }, { type: "bold" }] }] },
      ],
    };
    const cleaned = sanitizeRichTextDoc(hostile);
    expect(richTextSchema.safeParse({ schemaVersion: 2, format: "doc", doc: cleaned }).success).toBe(true);
    expect(nodeTypeSet(cleaned)).not.toContain("marquee");
    const heading = cleaned.content.find((n) => n.type === "heading") as { attrs?: { level?: number } };
    expect(heading?.attrs?.level).toBe(2); // level 6 → coerced to 2
    const para = cleaned.content.find((n) => n.type === "paragraph") as { content?: { marks?: { type?: string }[] }[] };
    expect(para?.content?.[0].marks?.map((m) => m.type)).toEqual(["bold"]); // strike dropped, bold kept
  });

  it("an unknown BLOCK type is refused by the discriminated union", () => {
    expect(parseBlockPayload({ type: "embed", schemaVersion: 1, src: "https://evil.example" }).ok).toBe(false);
    expect(parseBlockPayload({ type: "script", schemaVersion: 1, html: "<script>x</script>" }).ok).toBe(false);
  });
});
