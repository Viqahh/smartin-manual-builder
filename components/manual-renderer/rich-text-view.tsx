import { Fragment, type ReactNode } from "react";
import {
  richTextSchema,
  upgradeRichText,
  type RichText,
  type RichTextDoc,
} from "@/lib/domain/rich-text";

/**
 * The ONE semantic renderer for allowlisted rich-text documents (AC-P3-3).
 *
 * It walks the validated ProseMirror-shaped JSON and emits React elements directly — it never
 * builds an HTML string and never uses `dangerouslySetInnerHTML`. Any value that fails
 * `richTextSchema` (unknown node/mark, unsafe link, `<script>` node) renders as nothing or as
 * escaped text, so a hostile payload cannot produce executable markup.
 */

type AnyNode = {
  type?: string;
  text?: string;
  content?: AnyNode[];
  marks?: { type?: string; attrs?: { href?: string } }[];
  attrs?: { level?: number; start?: number };
};

function Inline({ nodes }: { nodes: AnyNode[] | undefined }): ReactNode {
  if (!nodes) return null;
  return nodes.map((n, i) => {
    if (n.type === "hardBreak") return <br key={i} />;
    if (n.type !== "text" || typeof n.text !== "string") return null;
    let el: ReactNode = n.text; // React escapes this — never HTML
    for (const m of n.marks ?? []) {
      if (m.type === "bold") el = <strong key={`b${i}`}>{el}</strong>;
      else if (m.type === "italic") el = <em key={`i${i}`}>{el}</em>;
      else if (m.type === "link" && m.attrs?.href) {
        el = (
          <a key={`a${i}`} href={m.attrs.href} target="_blank" rel="noopener noreferrer nofollow">
            {el}
          </a>
        );
      }
    }
    return <Fragment key={i}>{el}</Fragment>;
  });
}

function Block({ node, keyPrefix }: { node: AnyNode; keyPrefix: string }): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p>{<Inline nodes={node.content} />}</p>;
    case "heading":
      return node.attrs?.level === 3 ? (
        <h3>{<Inline nodes={node.content} />}</h3>
      ) : (
        <h2>{<Inline nodes={node.content} />}</h2>
      );
    case "bulletList":
      return (
        <ul>
          {(node.content ?? []).map((li, i) => (
            <li key={`${keyPrefix}li${i}`}>
              {(li.content ?? []).map((child, j) => (
                <Block key={`${keyPrefix}li${i}c${j}`} node={child} keyPrefix={`${keyPrefix}li${i}c${j}`} />
              ))}
            </li>
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol start={node.attrs?.start && node.attrs.start > 1 ? node.attrs.start : undefined}>
          {(node.content ?? []).map((li, i) => (
            <li key={`${keyPrefix}li${i}`}>
              {(li.content ?? []).map((child, j) => (
                <Block key={`${keyPrefix}li${i}c${j}`} node={child} keyPrefix={`${keyPrefix}li${i}c${j}`} />
              ))}
            </li>
          ))}
        </ol>
      );
    default:
      return null;
  }
}

export function richTextIsEmptyDoc(doc: RichTextDoc): boolean {
  return !doc.content.some((b) => {
    if (b.type === "paragraph" || b.type === "heading") return (b.content?.length ?? 0) > 0;
    return true;
  });
}

/** Renders a rich-text value (v1 or v2). Invalid input renders as `fallback` (default: nothing). */
export function RichTextView({
  value,
  fallback = null,
}: {
  value: unknown;
  fallback?: ReactNode;
}): ReactNode {
  const parsed = richTextSchema.safeParse(value);
  if (!parsed.success) {
    // Legacy tolerance: a bare { paragraphs: string[] } that predates the schema tag.
    const legacy = (value as { paragraphs?: unknown })?.paragraphs;
    if (Array.isArray(legacy)) {
      return (
        <>
          {legacy
            .filter((p): p is string => typeof p === "string")
            .map((p, i) => (
              <p key={i}>{p}</p>
            ))}
        </>
      );
    }
    return <>{fallback}</>;
  }
  const doc = upgradeRichText(parsed.data as RichText);
  if (richTextIsEmptyDoc(doc)) return <>{fallback}</>;
  return (
    <>
      {doc.content.map((b, i) => (
        <Block key={`b${i}`} node={b as AnyNode} keyPrefix={`b${i}`} />
      ))}
    </>
  );
}
