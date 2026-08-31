/**
 * Manual block payload model (docs/DATA_MODEL.md "JSON boundaries").
 *
 * Phase 2 scope: PERSISTENCE + VALIDATION ONLY. Every payload is validated with Zod
 * at the write boundary (AC-P2-15). The canonical document source is structured JSON —
 * arbitrary/unsanitised HTML is never stored (PRD-SEC-010). The real rich editor is Phase 3.
 */

import { z } from "zod";
import {
  richTextSchema,
  emptyRichText,
  richTextToPlainText,
  type RichText,
} from "@/lib/domain/rich-text";

export const BLOCK_TYPES = ["text", "steps", "image", "callout", "parameterTable", "faq"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/**
 * Rich text for `text` blocks, `callout` bodies, and `faq` answers.
 *
 * Phase 3: a restricted ProseMirror/TipTap `doc` JSON (schemaVersion 2), validated against a
 * strict node/mark allowlist in `lib/domain/rich-text.ts`. The Phase 2 `plain-paragraphs`
 * shape (schemaVersion 1) is still accepted for back-compat and upgraded on read. Raw HTML is
 * never a storage format (PRD-SEC-010, AC-P3-3).
 */
const richTextDocument = richTextSchema;
export type RichTextDocument = RichText;

const stepSchema = z.object({
  title: z.string().min(1).max(200),
  instruction: z.string().min(1).max(2000),
  menuPath: z.string().max(300).optional(),
  imageAssetId: z.uuid().optional(),
});
export type Step = z.infer<typeof stepSchema>;

const textBlock = z.object({
  type: z.literal("text"),
  schemaVersion: z.literal(1),
  content: richTextDocument,
});

const stepsBlock = z.object({
  type: z.literal("steps"),
  schemaVersion: z.literal(1),
  steps: z.array(stepSchema).min(1).max(60),
});

const imageBlock = z.object({
  type: z.literal("image"),
  schemaVersion: z.literal(1),
  imageAssetId: z.uuid(),
  caption: z.string().max(500).optional(),
});

const calloutBlock = z.object({
  type: z.literal("callout"),
  schemaVersion: z.literal(1),
  tone: z.enum(["warning", "info", "tip"]),
  content: richTextDocument,
});

/** groupIds resolve against the manual version's linked EA version only (GI-11). */
const parameterTableBlock = z.object({
  type: z.literal("parameterTable"),
  schemaVersion: z.literal(1),
  groupIds: z.array(z.uuid()).min(1).max(40),
});

const faqBlock = z.object({
  type: z.literal("faq"),
  schemaVersion: z.literal(1),
  question: z.string().min(1).max(500),
  answer: richTextDocument,
});

export const blockPayloadSchema = z.discriminatedUnion("type", [
  textBlock,
  stepsBlock,
  imageBlock,
  calloutBlock,
  parameterTableBlock,
  faqBlock,
]);

export type BlockPayload = z.infer<typeof blockPayloadSchema>;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: { path: string; message: string }[] };

export function parseBlockPayload(input: unknown): ParseResult<BlockPayload> {
  const result = blockPayloadSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

export function emptyTextBlock(): BlockPayload {
  return { type: "text", schemaVersion: 1, content: emptyRichText() };
}

/**
 * A draft payload for a freshly added block. `steps`/`faq`/`image` drafts intentionally hold
 * empty required fields — the editor keeps them as local draft state and only persists once
 * `parseBlockPayload` succeeds, so an incomplete block is never written.
 */
export function draftBlockPayload(type: BlockType): Record<string, unknown> {
  switch (type) {
    case "text":
      return { type: "text", schemaVersion: 1, content: emptyRichText() };
    case "callout":
      return { type: "callout", schemaVersion: 1, tone: "info", content: emptyRichText() };
    case "faq":
      return { type: "faq", schemaVersion: 1, question: "", answer: emptyRichText() };
    case "steps":
      return { type: "steps", schemaVersion: 1, steps: [{ title: "", instruction: "" }] };
    case "image":
      return { type: "image", schemaVersion: 1, imageAssetId: "" };
    case "parameterTable":
      return { type: "parameterTable", schemaVersion: 1, groupIds: [] };
  }
}

/**
 * May a freshly-added, never-persisted block be written to the database yet? (UAT-04, Phase 8A-P0)
 *
 * The editor holds a new block as local draft state and calls this before its first save. Parse
 * must succeed AND the block must carry meaningful author content:
 *   - `text` / `callout`: the rich text must contain non-whitespace (an empty body parses fine but
 *     must not become a permanent blank row).
 *   - `steps` / `faq`: `parseBlockPayload` already requires non-empty title/instruction/question.
 *   - `parameterTable` / `image`: a valid payload already implies a real EA-Version group / asset
 *     reference — that reference IS the meaningful content (spec §3/§4).
 */
export function isPersistableDraft(payload: unknown): boolean {
  const parsed = parseBlockPayload(payload);
  if (!parsed.ok) return false;
  const v = parsed.value;
  if (v.type === "text" || v.type === "callout") {
    try {
      return richTextToPlainText(v.content).trim().length > 0;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Payload for a duplicated block (AC-P3-13): a deep copy of the ALLOWED payload only.
 * `parameterTable` keeps the same EA-Version group id references (no parameter definitions are
 * copied); `image` keeps the same `image_assets` id (no binary is duplicated). A new block id
 * and adjacent position are assigned by the server action, not here.
 */
export function duplicateBlockPayload(payload: BlockPayload): BlockPayload {
  return structuredClone(payload);
}
