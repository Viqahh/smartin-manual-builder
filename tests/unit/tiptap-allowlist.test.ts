// @vitest-environment jsdom
/**
 * AC-P3-3 / AC-P3-4 — the TipTap surface can only produce allowlisted nodes/marks, and pasted
 * hostile HTML is normalised away. Runs a real headless `@tiptap/core` Editor.
 */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions, DISABLED_STARTERKIT_FEATURES, EDITOR_TOOLBAR_ACTIONS } from "@/lib/editor/tiptap-config";
import { richTextSchema, RICH_TEXT_NODES, RICH_TEXT_MARKS } from "@/lib/domain/rich-text";

function editorFromHTML(html: string) {
  const e = new Editor({ element: document.createElement("div"), extensions: buildEditorExtensions(), content: html });
  const json = e.getJSON();
  e.destroy();
  return json as { type: string; content?: unknown[] };
}

function nodeTypes(node: { type?: string; content?: unknown[] }, acc = new Set<string>()): Set<string> {
  if (node.type) acc.add(node.type);
  for (const c of (node.content as { type?: string }[]) ?? []) nodeTypes(c, acc);
  return acc;
}
function markTypes(node: { marks?: { type?: string }[]; content?: unknown[] }, acc = new Set<string>()): Set<string> {
  for (const m of node.marks ?? []) if (m.type) acc.add(m.type);
  for (const c of (node.content as object[]) ?? []) markTypes(c, acc);
  return acc;
}

describe("extension configuration", () => {
  it("registers only the allowlisted schema and disables the rest of StarterKit", () => {
    const e = new Editor({ element: document.createElement("div"), extensions: buildEditorExtensions() });
    const names = new Set(e.extensionManager.extensions.map((x) => x.name));
    e.destroy();
    // allowlist present
    for (const n of ["paragraph", "heading", "bulletList", "orderedList", "listItem", "bold", "italic", "link"]) {
      expect(names.has(n)).toBe(true);
    }
    // disabled features absent
    for (const off of DISABLED_STARTERKIT_FEATURES) expect(names.has(off)).toBe(false);
  });

  it("toolbar surface is exactly the documented action list", () => {
    expect([...EDITOR_TOOLBAR_ACTIONS].sort()).toEqual(
      ["bold", "bulletList", "heading2", "heading3", "italic", "link", "orderedList", "redo", "undo"].sort(),
    );
  });
});

describe("paste / setContent normalisation", () => {
  it("drops <script>, <style>, <iframe>, inline styles, event handlers, spans, and images", () => {
    const hostile = `
      <h1>judul besar</h1>
      <script>alert(1)</script>
      <style>*{color:red}</style>
      <iframe src="https://evil.example"></iframe>
      <p style="color:red" onclick="steal()">teks <b>tebal</b> <span class="x">span</span></p>
      <img src="https://evil.example/x.png" />
      <blockquote>kutipan</blockquote>
      <pre><code>rm -rf /</code></pre>
    `;
    const json = editorFromHTML(hostile);
    const nodes = nodeTypes(json);

    for (const bad of ["script", "iframe", "image", "blockquote", "codeBlock", "code", "style"]) {
      expect(nodes.has(bad)).toBe(false);
    }
    // every surviving node is on the allowlist
    for (const n of nodes) expect(RICH_TEXT_NODES as readonly string[]).toContain(n);
    // and the whole thing still validates as a v2 doc
    expect(richTextSchema.safeParse({ schemaVersion: 2, format: "doc", doc: json }).success).toBe(true);
    // <h1> is not allowed → it collapses to paragraph/heading-in-range, never h1/level 1
    const headings = JSON.stringify(json).match(/"level":(\d)/g) ?? [];
    for (const h of headings) expect(["2", "3"]).toContain(h.replace(/\D/g, ""));
  });

  it("keeps bold/italic/lists/links but strips unknown marks", () => {
    const json = editorFromHTML(
      `<p><b>tebal</b> <i>miring</i> <s>coret</s> <a href="https://ok.example">tautan</a></p><ul><li>butir</li></ul>`,
    );
    const marks = markTypes(json);
    expect(marks.has("bold")).toBe(true);
    expect(marks.has("italic")).toBe(true);
    expect(marks.has("link")).toBe(true);
    expect(marks.has("strike")).toBe(false);
    for (const m of marks) expect(RICH_TEXT_MARKS as readonly string[]).toContain(m);
  });

  it("a javascript: link is not accepted", () => {
    const json = editorFromHTML(`<p><a href="javascript:alert(1)">klik</a></p>`);
    expect(JSON.stringify(json)).not.toMatch(/javascript:/i);
    expect(richTextSchema.safeParse({ schemaVersion: 2, format: "doc", doc: json }).success).toBe(true);
  });
});
