"use client";

import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Bold, Italic, Heading2, Heading3, List, ListOrdered, Link2, Link2Off, Undo2, Redo2 } from "lucide-react";
import { buildEditorExtensions } from "@/lib/editor/tiptap-config";
import { sanitizeRichTextDoc, SAFE_LINK_PROTOCOL, type RichTextDoc } from "@/lib/domain/rich-text";
import { stableStringify } from "@/lib/editor/autosave-queue";

/**
 * The one rich-text surface for `text` blocks, `callout` bodies, and `faq` answers (AC-P3-2).
 * It persists `editor.getJSON()` — a restricted ProseMirror `doc` — never HTML. The extension
 * set (`buildEditorExtensions`) can only produce allowlisted nodes/marks; pasted HTML is mapped
 * by TipTap onto that set and re-sanitised via `transformPastedHTML` before it enters the doc.
 */
export function RichTextEditor({
  value,
  onChange,
  readOnly = false,
  ariaLabel,
  minimalToolbar = false,
}: {
  value: RichTextDoc;
  onChange: (doc: RichTextDoc) => void;
  readOnly?: boolean;
  ariaLabel: string;
  minimalToolbar?: boolean;
}) {
  // canonical form of the doc this editor last emitted — so an incoming `value` that is just the
  // echo of our own keystroke is ignored, but an EXTERNAL change (app-level undo/redo, or the
  // "Muat versi terbaru" conflict resolution replacing the block payload) is pushed into TipTap.
  const lastEmitted = useRef<string | null>(null);

  const editor = useEditor({
    extensions: buildEditorExtensions(),
    content: value,
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: {
      attributes: { "aria-label": ariaLabel, role: "textbox", "aria-multiline": "true", class: "rte-surface" },
      // defence in depth: strip anything obviously dangerous from a paste before TipTap parses it
      transformPastedHTML: (html) =>
        html
          .replace(/<\s*(script|style|iframe|object|embed|link|meta)[\s\S]*?>[\s\S]*?<\/\s*\1\s*>/gi, "")
          .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>/gi, "")
          .replace(/ on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ""),
    },
    onUpdate: ({ editor: e }) => {
      // re-sanitise the JSON so the persisted payload is always allowlist-clean
      const doc = sanitizeRichTextDoc(e.getJSON());
      lastEmitted.current = stableStringify(doc);
      onChange(doc);
    },
  });

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Adopt an externally-changed `value` (undo/redo, "Muat versi terbaru") into the live editor.
  // Skipped when `value` is our own last emission or already matches the editor — so ordinary
  // typing never fights the caret.
  useEffect(() => {
    if (!editor) return;
    const incoming = stableStringify(value);
    if (incoming === lastEmitted.current) return;
    if (incoming === stableStringify(editor.getJSON())) return;
    lastEmitted.current = incoming;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return <div className="rte" aria-busy="true" />;

  if (readOnly) {
    return (
      <div className="rte rte-readonly">
        <EditorContent editor={editor} />
      </div>
    );
  }

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const input = window.prompt("Tautan (http(s):// atau mailto:)", prev ?? "https://");
    if (input === null) return;
    const href = input.trim();
    if (href === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    if (!SAFE_LINK_PROTOCOL.test(href)) {
      window.alert("Protokol tautan tidak diizinkan. Gunakan http(s):// atau mailto:.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };

  return (
    <div className="rte">
      <div
        className="rte-toolbar"
        role="toolbar"
        aria-label={`Format ${ariaLabel}`}
        // keep the editor's text selection while a toolbar button is pressed
        onMouseDown={(e) => e.preventDefault()}
      >
        <button type="button" aria-pressed={editor.isActive("bold")} aria-label="Tebal" onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold aria-hidden="true" size={15} />
        </button>
        <button type="button" aria-pressed={editor.isActive("italic")} aria-label="Miring" onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic aria-hidden="true" size={15} />
        </button>
        {!minimalToolbar && (
          <>
            <button type="button" aria-pressed={editor.isActive("heading", { level: 2 })} aria-label="Judul 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
              <Heading2 aria-hidden="true" size={15} />
            </button>
            <button type="button" aria-pressed={editor.isActive("heading", { level: 3 })} aria-label="Judul 3" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
              <Heading3 aria-hidden="true" size={15} />
            </button>
          </>
        )}
        <button type="button" aria-pressed={editor.isActive("bulletList")} aria-label="Daftar poin" onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List aria-hidden="true" size={15} />
        </button>
        <button type="button" aria-pressed={editor.isActive("orderedList")} aria-label="Daftar bernomor" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered aria-hidden="true" size={15} />
        </button>
        <button type="button" aria-pressed={editor.isActive("link")} aria-label="Sisipkan tautan" onClick={setLink}>
          <Link2 aria-hidden="true" size={15} />
        </button>
        <button type="button" aria-label="Hapus tautan" disabled={!editor.isActive("link")} onClick={() => editor.chain().focus().unsetLink().run()}>
          <Link2Off aria-hidden="true" size={15} />
        </button>
        <span className="rte-sep" aria-hidden="true" />
        <button type="button" aria-label="Batalkan" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 aria-hidden="true" size={15} />
        </button>
        <button type="button" aria-label="Ulangi" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 aria-hidden="true" size={15} />
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
