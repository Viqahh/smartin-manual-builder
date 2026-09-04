// @vitest-environment jsdom
/**
 * Block spacing / visual separation.
 *
 * Two consecutive Text blocks (and every other combination) must render as SEPARATE block
 * containers in the chapter body with a clear, consistent vertical gap that is visibly larger
 * than in-block paragraph spacing — driven by ONE layout token on the stack, not per-type
 * margins or blank-paragraph hacks. Same rule for Edit read-view, Preview, Public Manual, PDF.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionContent } from "@/components/manual-renderer/manual-renderer";
import type { ManualViewModel } from "@/lib/manual/view-model";

type Section = ManualViewModel["sections"][number];
type Block = Section["blocks"][number];

const richText = (...paras: string[]) => ({
  schemaVersion: 2,
  format: "doc",
  doc: {
    type: "doc",
    content: paras.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  },
});
const textBlock = (id: string): Block => ({
  id,
  type: "text",
  payload: { type: "text", schemaVersion: 1, content: richText(`Body of ${id}, line one.`, `Body of ${id}, line two.`) },
  position: 0,
  imageAssetId: null,
  parameterGroupIds: [],
  rowVersion: 1,
});
const calloutBlock = (id: string): Block => ({
  id,
  type: "callout",
  payload: { type: "callout", schemaVersion: 1, tone: "info", content: richText(`Callout ${id}`) },
  position: 0,
  imageAssetId: null,
  parameterGroupIds: [],
  rowVersion: 1,
});
const faqBlock = (id: string): Block => ({
  id,
  type: "faq",
  payload: { type: "faq", schemaVersion: 2, items: [{ question: `Q ${id}?`, answer: richText(`A ${id}`) }] },
  position: 0,
  imageAssetId: null,
  parameterGroupIds: [],
  rowVersion: 1,
});
const stepsBlock = (id: string): Block => ({
  id,
  type: "steps",
  payload: { type: "steps", schemaVersion: 1, steps: [{ title: `Step ${id}`, instruction: "Do it" }] },
  position: 0,
  imageAssetId: null,
  parameterGroupIds: [],
  rowVersion: 1,
});

const section = (blocks: Block[]): Section => ({
  id: "sec-1",
  key: "overview",
  title: "Ringkasan",
  required: true,
  isCustom: false,
  position: 1,
  completionState: "incomplete",
  rowVersion: 1,
  blocks,
});
const vm = { images: {}, parameterGroups: [], changelog: [] } as unknown as ManualViewModel;

function mount(blocks: Block[], anchored = false) {
  document.body.innerHTML = renderToStaticMarkup(
    <SectionContent section={section(blocks)} vm={vm} anchored={anchored} />,
  );
  return document.querySelector(".generic-chapter") as HTMLElement;
}
afterEach(() => {
  document.body.innerHTML = "";
});

describe("block stack — structure", () => {
  it("two consecutive Text blocks render as two separate sibling containers, not one text body", () => {
    const stack = mount([textBlock("a"), textBlock("b")]);
    const children = [...stack.children];
    expect(children).toHaveLength(2); // NOT merged into a single continuous body
    expect(children.every((c) => c.classList.contains("manual-content"))).toBe(true);
    // each block keeps its own text; content is not concatenated into one element
    expect(children[0].textContent).toContain("Body of a");
    expect(children[1].textContent).toContain("Body of b");
    expect(children[0].textContent).not.toContain("Body of b");
  });

  it("every block-type combination yields one container per block, in order", () => {
    const combos: [string, Block[]][] = [
      ["Text→Text", [textBlock("t1"), textBlock("t2")]],
      ["Text→Callout", [textBlock("t"), calloutBlock("c")]],
      ["Callout→Text", [calloutBlock("c"), textBlock("t")]],
      ["FAQ→Text", [faqBlock("f"), textBlock("t")]],
      ["Steps→Text", [stepsBlock("s"), textBlock("t")]],
      ["Callout→FAQ→Steps→Text", [calloutBlock("c"), faqBlock("f"), stepsBlock("s"), textBlock("t")]],
    ];
    for (const [name, blocks] of combos) {
      const stack = mount(blocks);
      expect([...stack.children].length, name).toBe(blocks.length);
    }
  });

  it("the anchored (review) variant also produces one separated wrapper per block", () => {
    const stack = mount([textBlock("a"), calloutBlock("b")], true);
    const children = [...stack.children];
    expect(children).toHaveLength(2);
    expect(children.every((c) => c.classList.contains("rc-anchor-block"))).toBe(true);
  });
});

describe("block stack — spacing contract (cascade applied)", () => {
  // literal values mirror app/globals.css (jsdom getComputedStyle does not resolve var())
  const CSS = `
    .generic-chapter > .rc-anchor-block > * { margin-top: 0; margin-bottom: 0; }
    .generic-chapter > * { margin-top: 26px; margin-bottom: 0; }
    .generic-chapter > :first-child { margin-top: 0; }
    .manual-content p { margin: 0 0 12px; }
    .manual-content p:last-child { margin-bottom: 0; }
  `;
  function mountStyled(blocks: Block[]) {
    document.head.innerHTML = `<style>${CSS}</style>`;
    return mount(blocks);
  }
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("adjacent blocks get the stack gap; the first block does not", () => {
    const stack = mountStyled([textBlock("a"), textBlock("b")]);
    const [first, second] = [...stack.children] as HTMLElement[];
    expect(getComputedStyle(first).marginTop).toBe("0px");
    expect(getComputedStyle(second).marginTop).toBe("26px");
  });

  it("the block gap is visibly larger than in-block paragraph spacing", () => {
    const stack = mountStyled([textBlock("a"), textBlock("b")]);
    const second = stack.children[1] as HTMLElement;
    const para = second.querySelector("p") as HTMLElement;
    const blockGap = parseFloat(getComputedStyle(second).marginTop); // 26
    const paraGap = parseFloat(getComputedStyle(para).marginBottom); // 12
    expect(blockGap).toBeGreaterThan(paraGap);
    expect(paraGap).toBeGreaterThan(0); // in-block paragraph spacing stays normal
  });

  it("a Callout after a Text is separated by the same stack gap (no per-type margin)", () => {
    const stack = mountStyled([textBlock("t"), calloutBlock("c")]);
    const callout = stack.children[1] as HTMLElement;
    expect(callout.classList.contains("manual-callout")).toBe(true);
    expect(getComputedStyle(callout).marginTop).toBe("26px");
  });
});

describe("app/globals.css — the stack token + owl rule exist", () => {
  const css = readFileSync("app/globals.css", "utf8");

  it("defines a single --block-stack-gap token and the owl separation rule", () => {
    expect(css).toMatch(/--block-stack-gap:\s*\d+px/);
    expect(css).toMatch(/\.generic-chapter\s*>\s*\*\s*\{[^}]*margin-top:\s*var\(--block-stack-gap\)/);
    expect(css).toMatch(/\.generic-chapter\s*>\s*:first-child\s*\{[^}]*margin-top:\s*0/);
  });

  it("no per-block-type outer margins remain on stack members (callout / image)", () => {
    // selector-boundary anchored: a *rule whose selector is* `.manual-callout` / `.manual-image-block`
    // (optionally surface-scoped), NOT `.manual-content > .manual-callout` (SupportedConfigTable note)
    const ruleFor = (sel: string, prop: string) =>
      new RegExp(`(?:^|[},;])\\s*(?:\\.(?:manual-page|public-manual|pdf-shell)\\s+)?\\.${sel}(?:[.:][\\w-]+)*\\s*\\{[^}]*\\b${prop}\\b`, "m");
    expect(css).not.toMatch(ruleFor("manual-callout", "margin-top"));
    expect(css).not.toMatch(ruleFor("manual-callout", "margin"));
    expect(css).not.toMatch(ruleFor("manual-image-block", "margin"));
  });

  it("each rendered surface re-points the token", () => {
    for (const scope of [".manual-page", ".public-manual", ".pdf-shell"]) {
      expect(css, scope).toMatch(
        new RegExp(`\\${scope}\\s+\\.generic-chapter\\s*\\{[^}]*--block-stack-gap:`),
      );
    }
  });
});
