/**
 * UAT-35 §3 — the human-evidence fingerprint is a deterministic function of the anchored content.
 * It MUST change when the referenced block text changes or the block is deleted, so a stale
 * acceptance can be detected.
 */
import { describe, it, expect } from "vitest";
import type { ManualViewModel } from "@/lib/manual/view-model";
import { evidenceFingerprint } from "@/lib/validation/evidence";
import { richTextFromParagraphs } from "@/lib/domain/rich-text";

type VmSection = ManualViewModel["sections"][number];

const textBlock = (id: string, text: string, position: number) => ({
  id,
  type: "text" as const,
  payload: { type: "text", schemaVersion: 1, content: richTextFromParagraphs([text]) } as Record<string, unknown>,
  position,
  imageAssetId: null,
  parameterGroupIds: [] as string[],
  rowVersion: 1,
});

const section = (key: string, blocks: ReturnType<typeof textBlock>[]): VmSection => ({
  id: `sec-${key}`,
  key,
  title: key,
  required: true,
  isCustom: false,
  position: 0,
  completionState: "incomplete",
  rowVersion: 1,
  blocks,
});

describe("evidenceFingerprint", () => {
  it("is deterministic for the same content", () => {
    const s = section("installation", [textBlock("b1", "Aktifkan Algo Trading lalu cek status.", 0)]);
    expect(evidenceFingerprint(s, null)).toBe(evidenceFingerprint(s, null));
    expect(evidenceFingerprint(s, "b1")).toBe(evidenceFingerprint(s, "b1"));
  });

  it("changes when the anchored block text changes", () => {
    const before = section("installation", [textBlock("b1", "Aktifkan Algo Trading.", 0)]);
    const after = section("installation", [textBlock("b1", "Aktifkan Algo Trading lalu verifikasi ikon status hijau.", 0)]);
    expect(evidenceFingerprint(after, "b1")).not.toBe(evidenceFingerprint(before, "b1"));
    expect(evidenceFingerprint(after, null)).not.toBe(evidenceFingerprint(before, null));
  });

  it("changes when the anchored block is removed (deleted-block staleness)", () => {
    const withBlock = section("installation", [textBlock("b1", "teks", 0), textBlock("b2", "lain", 1)]);
    const without = section("installation", [textBlock("b2", "lain", 1)]);
    expect(evidenceFingerprint(without, "b1")).not.toBe(evidenceFingerprint(withBlock, "b1"));
  });

  it("section-level and block-level fingerprints differ, and unrelated blocks don't affect a block anchor", () => {
    const a = section("installation", [textBlock("b1", "teks", 0), textBlock("b2", "x", 1)]);
    const b = section("installation", [textBlock("b1", "teks", 0), textBlock("b2", "y berbeda", 1)]);
    expect(evidenceFingerprint(a, null)).not.toBe(evidenceFingerprint(a, "b1"));
    // b2 changed → block anchor on b1 stays stable, section anchor changes
    expect(evidenceFingerprint(b, "b1")).toBe(evidenceFingerprint(a, "b1"));
    expect(evidenceFingerprint(b, null)).not.toBe(evidenceFingerprint(a, null));
  });

  it("a missing section yields a stable 64-hex sentinel that differs from any real content", () => {
    const gone = evidenceFingerprint(null, null);
    expect(gone).toHaveLength(64);
    expect(evidenceFingerprint(undefined, null)).toBe(gone);
    const real = section("installation", [textBlock("b1", "teks", 0)]);
    expect(evidenceFingerprint(real, null)).not.toBe(gone);
  });
});
