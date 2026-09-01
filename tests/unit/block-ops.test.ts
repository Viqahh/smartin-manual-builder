import { describe, it, expect } from "vitest";
import {
  BLOCK_TYPES,
  draftBlockPayload,
  duplicateBlockPayload,
  parseBlockPayload,
  type BlockPayload,
} from "@/lib/domain/blocks";
import { richTextFromParagraphs } from "@/lib/domain/rich-text";

const UUID = "d0000000-0000-4000-8000-00000000000a";
const UUID2 = "d0000000-0000-4000-8000-00000000000b";

describe("draftBlockPayload — every block type has a draft; text/callout drafts are immediately valid", () => {
  it("returns the right discriminant for all six types", () => {
    for (const t of BLOCK_TYPES) {
      expect(draftBlockPayload(t).type).toBe(t);
    }
  });
  it("text and callout drafts pass the write boundary as-is", () => {
    expect(parseBlockPayload(draftBlockPayload("text")).ok).toBe(true);
    expect(parseBlockPayload(draftBlockPayload("callout")).ok).toBe(true);
  });
  it("steps/faq/image/parameterTable drafts are intentionally incomplete (not persisted until filled)", () => {
    expect(parseBlockPayload(draftBlockPayload("steps")).ok).toBe(false);
    expect(parseBlockPayload(draftBlockPayload("faq")).ok).toBe(false);
    expect(parseBlockPayload(draftBlockPayload("image")).ok).toBe(false);
    expect(parseBlockPayload(draftBlockPayload("parameterTable")).ok).toBe(false);
  });
});

describe("duplicateBlockPayload (AC-P3-13)", () => {
  it("is a deep copy — new object, equal value", () => {
    const src: BlockPayload = { type: "steps", schemaVersion: 1, steps: [{ title: "a", instruction: "b" }] };
    const copy = duplicateBlockPayload(src);
    expect(copy).toEqual(src);
    expect(copy).not.toBe(src);
    expect((copy as typeof src).steps).not.toBe(src.steps);
  });
  it("parameterTable keeps the SAME EA-Version group id references (no definitions copied)", () => {
    const src: BlockPayload = { type: "parameterTable", schemaVersion: 1, groupIds: [UUID, UUID2] };
    const copy = duplicateBlockPayload(src) as typeof src;
    expect(copy.groupIds).toEqual([UUID, UUID2]);
    expect(JSON.stringify(copy)).not.toMatch(/default|technical|displayName/i);
  });
  it("image keeps the SAME image_assets id (no binary duplicated)", () => {
    const src: BlockPayload = { type: "image", schemaVersion: 1, imageAssetId: UUID, caption: "x" };
    expect((duplicateBlockPayload(src) as typeof src).imageAssetId).toBe(UUID);
  });
});

describe("write boundary refuses unknown / malformed block types (AC-P3-4)", () => {
  it("unknown discriminant", () => {
    expect(parseBlockPayload({ type: "marquee", schemaVersion: 1 }).ok).toBe(false);
    expect(parseBlockPayload({ type: "embed", schemaVersion: 1, src: "x" }).ok).toBe(false);
  });
  it("wrong shape for a known type", () => {
    expect(parseBlockPayload({ type: "callout", schemaVersion: 1, tone: "danger", content: {} }).ok).toBe(false);
    expect(parseBlockPayload({ type: "parameterTable", schemaVersion: 1, groupIds: [] }).ok).toBe(false);
    expect(parseBlockPayload({ type: "image", schemaVersion: 1, imageAssetId: "not-a-uuid" }).ok).toBe(false);
  });
});

describe("steps block — ≥5 ordered steps round-trip (AC-P3-7)", () => {
  it("preserves count, order, and per-step fields", () => {
    const payload: BlockPayload = {
      type: "steps",
      schemaVersion: 1,
      steps: [
        { title: "1", instruction: "buka" },
        { title: "2", instruction: "kompilasi", menuPath: "F7" },
        { title: "3", instruction: "pasang", imageAssetId: UUID },
        { title: "4", instruction: "aktifkan" },
        { title: "5", instruction: "verifikasi" },
        { title: "6", instruction: "selesai" },
      ],
    };
    const parsed = parseBlockPayload(payload);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const steps = (parsed.value as Extract<BlockPayload, { type: "steps" }>).steps;
    expect(steps).toHaveLength(6);
    expect(steps.map((s) => s.title)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(steps[1].menuPath).toBe("F7");
    expect(steps[2].imageAssetId).toBe(UUID);
  });
});

describe("faq / callout rich bodies persist as structured JSON, not strings", () => {
  it("faq answer + callout content survive parse as objects", () => {
    // legacy v1 payload — normalizeBlockPayload upgrades it to v2 (items[]) on parse
    const faq = parseBlockPayload({
      type: "faq",
      schemaVersion: 1,
      question: "q?",
      answer: richTextFromParagraphs(["jawaban"]),
    });
    expect(faq.ok).toBe(true);
    if (faq.ok) {
      const v = faq.value as Extract<BlockPayload, { type: "faq" }>;
      expect(v.schemaVersion).toBe(2);
      expect(v.items).toHaveLength(1);
      expect(v.items[0].question).toBe("q?");
      expect(typeof v.items[0].answer).toBe("object");
    }
  });

  it("a v2 multi-item faq payload parses with all items", () => {
    const faq = parseBlockPayload({
      type: "faq",
      schemaVersion: 2,
      items: [
        { question: "q1?", answer: richTextFromParagraphs(["a1"]) },
        { question: "q2?", answer: richTextFromParagraphs(["a2"]) },
      ],
    });
    expect(faq.ok).toBe(true);
    if (faq.ok) {
      const v = faq.value as Extract<BlockPayload, { type: "faq" }>;
      expect(v.items.map((i) => i.question)).toEqual(["q1?", "q2?"]);
    }
  });
});
