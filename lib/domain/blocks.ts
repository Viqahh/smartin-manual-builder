/**
 * Manual block payload model (docs/DATA_MODEL.md "JSON boundaries").
 *
 * Phase 2 scope: PERSISTENCE + VALIDATION ONLY. Every payload is validated with Zod
 * at the write boundary (AC-P2-15). The canonical document source is structured JSON —
 * arbitrary/unsanitised HTML is never stored (PRD-SEC-010). The real rich editor is Phase 3.
 */

import { z } from "zod";

export const BLOCK_TYPES = ["text", "steps", "image", "callout", "parameterTable", "faq"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/**
 * Phase 2 rich text is a minimal, allow-listed document: an ordered list of paragraph
 * strings. Phase 3 replaces this with a TipTap JSON document behind the same block type.
 */
const richTextDocument = z.object({
  schemaVersion: z.literal(1),
  format: z.literal("plain-paragraphs"),
  paragraphs: z.array(z.string().max(4000)).max(200),
});
export type RichTextDocument = z.infer<typeof richTextDocument>;

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
  return { type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: [] } };
}
