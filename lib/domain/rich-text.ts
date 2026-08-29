/**
 * Allowlisted rich-text document model (Phase 3 — serialization spike, AC-P3-2/AC-P3-3).
 *
 * The canonical persisted format for text-like content (`text` blocks, `callout` body,
 * `faq` answer) is **structured JSON**, never HTML. A v2 document is a restricted
 * ProseMirror / TipTap `doc` JSON: exactly what `editor.getJSON()` produces, but validated
 * against a strict node/mark allowlist at the write boundary. Nothing outside the allowlist
 * survives — unknown nodes/marks, `<script>` text, and non-http(s)/mailto links are rejected
 * by Zod (persist) or stripped by `sanitizeRichTextDoc` (paste). Raw HTML is never a storage
 * format and the renderer never uses `dangerouslySetInnerHTML`.
 *
 * v1 (`plain-paragraphs`, shipped in Phase 2) stays valid for back-compat and is upgraded to
 * v2 on read via `upgradeRichText`.
 */

import { z } from "zod";

/** Block-level nodes permitted inside a rich-text `doc`. */
export const RICH_TEXT_BLOCK_NODES = ["paragraph", "heading", "bulletList", "orderedList"] as const;
/** Every node type the schema will accept anywhere in the tree. */
export const RICH_TEXT_NODES = [
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "text",
  "hardBreak",
] as const;
/** Inline marks permitted on `text` nodes. */
export const RICH_TEXT_MARKS = ["bold", "italic", "link"] as const;
/** Only these heading levels — no H1 (the chapter title owns H1), no H4+. */
export const RICH_TEXT_HEADING_LEVELS = [2, 3] as const;
/** A link `href` must match one of these protocols; anything else is dropped/rejected. */
export const SAFE_LINK_PROTOCOL = /^(https?:|mailto:)/i;

const MAX_TEXT_LEN = 8000;
const MAX_INLINE_CHILDREN = 400;
const MAX_BLOCKS = 400;
const MAX_LIST_ITEMS = 200;

// ---------------------------------------------------------------------------
// v2 — restricted ProseMirror doc JSON
// ---------------------------------------------------------------------------

const linkMark = z
  .object({
    type: z.literal("link"),
    attrs: z.object({
      href: z.string().trim().min(1).max(2000),
      target: z.string().optional(),
      rel: z.string().optional(),
      class: z.unknown().optional(),
    }),
  })
  .refine((m) => SAFE_LINK_PROTOCOL.test(m.attrs.href), {
    message: "Tautan hanya boleh http(s):// atau mailto:.",
    path: ["attrs", "href"],
  })
  // normalise: force safe rel/target, drop any other attrs a paste may have carried
  .transform((m) => ({
    type: "link" as const,
    attrs: { href: m.attrs.href, target: "_blank", rel: "noopener noreferrer nofollow" },
  }));

const simpleMark = z.object({ type: z.enum(["bold", "italic"]) });

const mark = z.union([simpleMark, linkMark]);

const textNode = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(MAX_TEXT_LEN),
  marks: z.array(mark).max(8).optional(),
});

const hardBreak = z.object({ type: z.literal("hardBreak") });

const inlineNode = z.union([textNode, hardBreak]);

const paragraph = z.object({
  type: z.literal("paragraph"),
  content: z.array(inlineNode).max(MAX_INLINE_CHILDREN).optional(),
});

const heading = z.object({
  type: z.literal("heading"),
  attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }),
  content: z.array(inlineNode).max(MAX_INLINE_CHILDREN).optional(),
});

type ListItemShape = {
  type: "listItem";
  content: Array<z.infer<typeof paragraph> | BulletListShape | OrderedListShape>;
};
type BulletListShape = { type: "bulletList"; content: ListItemShape[] };
type OrderedListShape = { type: "orderedList"; attrs?: { start?: number }; content: ListItemShape[] };

const listItem: z.ZodType<ListItemShape> = z.lazy(() =>
  z.object({
    type: z.literal("listItem"),
    content: z
      .array(z.union([paragraph, bulletList, orderedList]))
      .min(1)
      .max(30),
  }),
);

const bulletList: z.ZodType<BulletListShape> = z.lazy(() =>
  z.object({
    type: z.literal("bulletList"),
    content: z.array(listItem).min(1).max(MAX_LIST_ITEMS),
  }),
);

const orderedList: z.ZodType<OrderedListShape> = z.lazy(() =>
  z.object({
    type: z.literal("orderedList"),
    attrs: z.object({ start: z.number().int().min(1).max(9999) }).partial().optional(),
    content: z.array(listItem).min(1).max(MAX_LIST_ITEMS),
  }),
);

const blockNode = z.union([paragraph, heading, bulletList, orderedList]);

const docNode = z.object({
  type: z.literal("doc"),
  content: z.array(blockNode).max(MAX_BLOCKS),
});
export type RichTextDoc = z.infer<typeof docNode>;

const richTextV2 = z.object({
  schemaVersion: z.literal(2),
  format: z.literal("doc"),
  doc: docNode,
});

// ---------------------------------------------------------------------------
// v1 — plain paragraph strings (Phase 2). Still accepted; upgraded on read.
// ---------------------------------------------------------------------------

const richTextV1 = z.object({
  schemaVersion: z.literal(1),
  format: z.literal("plain-paragraphs"),
  paragraphs: z.array(z.string().max(4000)).max(200),
});

export const richTextSchema = z.discriminatedUnion("schemaVersion", [richTextV1, richTextV2]);
export type RichText = z.infer<typeof richTextSchema>;
export type RichTextV2 = z.infer<typeof richTextV2>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function emptyRichTextDoc(): RichTextDoc {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

export function emptyRichText(): RichTextV2 {
  return { schemaVersion: 2, format: "doc", doc: emptyRichTextDoc() };
}

/** Build a v2 document from plain paragraph strings (used to upgrade v1 + seed content). */
export function richTextFromParagraphs(paragraphs: readonly string[]): RichTextV2 {
  const content = paragraphs.length
    ? paragraphs.map((p) =>
        p.trim() === ""
          ? { type: "paragraph" as const }
          : { type: "paragraph" as const, content: [{ type: "text" as const, text: p }] },
      )
    : [{ type: "paragraph" as const }];
  return { schemaVersion: 2, format: "doc", doc: { type: "doc", content } };
}

/** Normalise any accepted rich-text value to a v2 `doc` node (lossless for v2, best-effort for v1). */
export function upgradeRichText(value: RichText): RichTextDoc {
  if (value.schemaVersion === 2) return value.doc;
  return richTextFromParagraphs(value.paragraphs).doc;
}

type AnyNode = { type?: unknown; text?: unknown; content?: unknown; marks?: unknown; attrs?: unknown };

/** Flatten a doc to plain text (search / plain fallback / completion checks). */
export function richTextToPlainText(value: RichText | RichTextDoc): string {
  const doc: RichTextDoc =
    "type" in value && value.type === "doc"
      ? (value as RichTextDoc)
      : upgradeRichText(value as RichText);
  const out: string[] = [];
  const walkInline = (nodes: unknown): string => {
    if (!Array.isArray(nodes)) return "";
    return nodes
      .map((n: AnyNode) => {
        if (n?.type === "text" && typeof n.text === "string") return n.text;
        if (n?.type === "hardBreak") return "\n";
        return "";
      })
      .join("");
  };
  const walkBlock = (node: AnyNode) => {
    if (node?.type === "paragraph" || node?.type === "heading") {
      out.push(walkInline(node.content));
    } else if (node?.type === "bulletList" || node?.type === "orderedList") {
      for (const li of (node.content as AnyNode[]) ?? []) {
        for (const child of (li?.content as AnyNode[]) ?? []) walkBlock(child);
      }
    }
  };
  for (const b of doc.content ?? []) walkBlock(b as AnyNode);
  return out.join("\n").trim();
}

/** True when the document has no visible text (used by chapter-completion checks). */
export function isRichTextEmpty(value: RichText | RichTextDoc): boolean {
  return richTextToPlainText(value) === "";
}

/**
 * Best-effort structural sanitiser for pasted / untrusted doc JSON: keep only allowlisted
 * node & mark types, coerce heading levels into range, drop links whose protocol is unsafe.
 * The result is still validated by `richTextSchema` before it is persisted.
 */
export function sanitizeRichTextDoc(input: unknown): RichTextDoc {
  const nodeOk = new Set<string>(RICH_TEXT_NODES);
  const markOk = new Set<string>(RICH_TEXT_MARKS);

  type CleanMark = { type: string; attrs?: { href: string; target: string; rel: string } };
  const cleanMarks = (marks: unknown): CleanMark[] | undefined => {
    if (!Array.isArray(marks)) return undefined;
    const kept: CleanMark[] = [];
    for (const m of marks as AnyNode[]) {
      const t = typeof m?.type === "string" ? (m.type as string) : "";
      if (!markOk.has(t)) continue;
      if (t !== "link") {
        kept.push({ type: t });
        continue;
      }
      const href = String((m.attrs as { href?: unknown } | undefined)?.href ?? "").trim();
      if (!SAFE_LINK_PROTOCOL.test(href)) continue;
      kept.push({ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow" } });
    }
    return kept.length ? kept : undefined;
  };

  const cleanNode = (node: AnyNode): AnyNode | null => {
    const type = typeof node?.type === "string" ? (node.type as string) : "";
    if (!nodeOk.has(type)) return null;

    if (type === "text") {
      const text = typeof node.text === "string" ? node.text : "";
      if (text === "") return null;
      const marks = cleanMarks(node.marks);
      return marks ? { type, text, marks } : { type, text };
    }
    if (type === "hardBreak") return { type };

    const content = Array.isArray(node.content)
      ? (node.content as AnyNode[]).map(cleanNode).filter((n): n is AnyNode => n !== null)
      : [];

    if (type === "heading") {
      const raw = Number((node.attrs as { level?: unknown } | undefined)?.level ?? 2);
      const level = RICH_TEXT_HEADING_LEVELS.includes(raw as 2 | 3) ? raw : 2;
      return { type, attrs: { level }, content };
    }
    if (type === "orderedList") {
      const start = Number((node.attrs as { start?: unknown } | undefined)?.start ?? 1);
      const items = content.filter((n) => n.type === "listItem");
      return items.length
        ? { type, attrs: Number.isFinite(start) && start > 1 ? { start } : undefined, content: items }
        : null;
    }
    if (type === "bulletList") {
      const items = content.filter((n) => n.type === "listItem");
      return items.length ? { type, content: items } : null;
    }
    if (type === "listItem") {
      const kids = content.filter((n) => ["paragraph", "bulletList", "orderedList"].includes(n.type as string));
      return kids.length ? { type, content: kids } : { type, content: [{ type: "paragraph" }] };
    }
    // paragraph
    return { type, content };
  };

  const root = input as AnyNode;
  const blocks = Array.isArray(root?.content)
    ? (root.content as AnyNode[])
        .map(cleanNode)
        .filter((n): n is AnyNode => n !== null && RICH_TEXT_BLOCK_NODES.includes(n.type as never))
    : [];
  return { type: "doc", content: blocks.length ? (blocks as RichTextDoc["content"]) : [{ type: "paragraph" }] };
}
