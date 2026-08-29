/**
 * TipTap extension configuration for the Phase 3 rich-text surface (text blocks, callout body,
 * faq answer). This module is pure config — no React — so it can be imported by the editor
 * component AND asserted in unit tests.
 *
 * The extension set is deliberately narrow and maps 1:1 onto `lib/domain/rich-text.ts`:
 * paragraph, heading (H2/H3), bold, italic, bullet/ordered list, link (http/https/mailto only),
 * hard break, and local history (undo/redo). Nothing here can emit an arbitrary node, colour,
 * font, iframe, or script. `editor.getJSON()` produces exactly a v2 `doc` payload.
 */

import { StarterKit } from "@tiptap/starter-kit";
import { Link } from "@tiptap/extension-link";
import type { Extensions } from "@tiptap/core";
import { RICH_TEXT_HEADING_LEVELS, SAFE_LINK_PROTOCOL } from "@/lib/domain/rich-text";

/** Marks/nodes StarterKit ships that we explicitly turn OFF (not in the allowlist). */
export const DISABLED_STARTERKIT_FEATURES = [
  "blockquote",
  "code",
  "codeBlock",
  "horizontalRule",
  "strike",
  "underline",
] as const;

export function buildEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [...RICH_TEXT_HEADING_LEVELS] },
      // keep: paragraph, text, bold, italic, bulletList, orderedList, listItem, hardBreak,
      //       history (undo/redo), dropcursor, gapcursor
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      strike: false,
      underline: false,
      // `link` is provided separately with a protocol allowlist
      link: false,
    }),
    Link.configure({
      openOnClick: false,
      autolink: false,
      protocols: ["http", "https", "mailto"],
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      isAllowedUri: (url) => SAFE_LINK_PROTOCOL.test(url.trim()),
    }),
  ];
}

/** Toolbar actions exposed by the rich-text editor — nothing beyond this list. */
export const EDITOR_TOOLBAR_ACTIONS = [
  "bold",
  "italic",
  "heading2",
  "heading3",
  "bulletList",
  "orderedList",
  "link",
  "undo",
  "redo",
] as const;
export type EditorToolbarAction = (typeof EDITOR_TOOLBAR_ACTIONS)[number];
