// @vitest-environment jsdom
/**
 * AC-P3-3 / AC-P3-10 — the shared renderer emits semantic React for allowlisted rich text and
 * renders supported-configuration rows verbatim with no inferred combinations.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { RichTextView } from "@/components/manual-renderer/rich-text-view";
import { ManualRenderer } from "@/components/manual-renderer/manual-renderer";
import type { ManualViewModel } from "@/lib/manual/view-model";
import { richTextFromParagraphs } from "@/lib/domain/rich-text";

function render(node: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(node);
}

describe("RichTextView", () => {
  it("renders headings, lists, bold, italic and safe links as semantic elements", () => {
    const doc = {
      type: "doc" as const,
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Judul" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "tebal", marks: [{ type: "bold" }] },
            { type: "text", text: " dan " },
            { type: "text", text: "miring", marks: [{ type: "italic" }] },
          ],
        },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "butir" }] }] }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "situs", marks: [{ type: "link", attrs: { href: "https://ok.example" } }] }],
        },
      ],
    };
    const html = render(createElement(RichTextView, { value: { schemaVersion: 2, format: "doc", doc } }));
    expect(html).toContain("<h2>Judul</h2>");
    expect(html).toContain("<strong>tebal</strong>");
    expect(html).toContain("<em>miring</em>");
    expect(html).toContain("<ul><li><p>butir</p></li></ul>");
    expect(html).toContain('href="https://ok.example"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it("renders a legacy v1 plain-paragraphs value", () => {
    const html = render(createElement(RichTextView, { value: richTextFromParagraphs(["satu", "dua"]) }));
    expect(html).toBe("<p>satu</p><p>dua</p>");
  });

  it("invalid input renders the fallback, never markup", () => {
    const html = render(createElement(RichTextView, { value: { type: "doc", content: [{ type: "evil" }] }, fallback: "—" }));
    expect(html).toBe("—");
  });
});

// A minimal but complete view model for the shared renderer.
function vmWithSetups(): ManualViewModel {
  return {
    manual: { id: "m", locale: "id" },
    manualVersion: { id: "mv", version: "1.0.0", status: "DRAFT", rowVersion: 1, updatedAt: "2026-01-01" },
    eaProduct: { id: "p", name: "VMax EA", slug: "vmax", description: "" },
    eaVersion: { id: "e", version: "1.0.0", platform: "MT5", releaseDate: null, requirements: {}, support: {} },
    organization: { id: "o", name: "Org" },
    developer: null,
    supportedSetups: [
      { id: "s1", symbol: "XAUUSD", timeframe: "M15", presetRef: null, testedMinimumLot: 0.01, notes: null, isSupported: true, position: 0 },
      { id: "s2", symbol: "EURUSD", timeframe: "H1", presetRef: null, testedMinimumLot: null, notes: null, isSupported: true, position: 1 },
    ],
    sections: [
      {
        id: "sec1",
        key: "presets",
        title: "Preset, Pair & Timeframe",
        required: true,
        isCustom: false,
        position: 0,
        completionState: "incomplete",
        rowVersion: 1,
        blocks: [],
      },
    ],
    parameterGroups: [],
    images: {},
  };
}

describe("AC-P3-10 — supported configuration renders explicit rows only, no inferred combos", () => {
  it("shows exactly the stored rows and never a cross-product", () => {
    const html = render(createElement(ManualRenderer, { vm: vmWithSetups() }));
    expect(html).toContain("XAUUSD");
    expect(html).toContain("EURUSD");
    // both explicit pairs present
    expect(html).toMatch(/XAUUSD<\/td>\s*<td[^>]*>M15/);
    expect(html).toMatch(/EURUSD<\/td>\s*<td[^>]*>H1/);
    // the inferred combinations XAUUSD/H1 and EURUSD/M15 must NOT appear
    expect(html).not.toMatch(/XAUUSD<\/td>\s*<td[^>]*>H1/);
    expect(html).not.toMatch(/EURUSD<\/td>\s*<td[^>]*>M15/);
    // tested-minimum-lot wording + broker disclaimer retained
    expect(html).toContain("data uji developer");
    expect(html).toMatch(/broker/i);
  });
});
