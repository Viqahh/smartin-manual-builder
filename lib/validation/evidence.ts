/**
 * UAT-35 — deterministic fingerprint of the manual content a human-evidence submission points at.
 *
 * Computed SERVER-SIDE (the Next.js server action, never the browser) at submission time and again
 * at evaluation time; a mismatch means the evidence is STALE and a prior reviewer acceptance is no
 * longer effective. This is the *secondary* staleness signal — the DB also eagerly flips a live
 * submission to STALE when the anchored block/section changes (migration 29 triggers). Both must
 * agree for an acceptance to keep clearing a gate.
 *
 * Pure + import-safe on the server. `node:crypto` is fine in a server action / Node test.
 */
import { createHash } from "node:crypto";
import type { ManualViewModel } from "@/lib/manual/view-model";
import { faqItems } from "@/lib/domain/blocks";
import { richTextToPlainText } from "@/lib/domain/rich-text";

type VmSection = ManualViewModel["sections"][number];
type VmBlock = VmSection["blocks"][number];

const FINGERPRINT_VERSION = "ev1";
const UNIT = String.fromCharCode(31); // field separator inside the hashed string
const RECORD = String.fromCharCode(30); // block separator for section-level evidence

function safePlain(v: unknown): string {
  try {
    return v && typeof v === "object" ? richTextToPlainText(v as never) : "";
  } catch {
    return "";
  }
}

/** normalized, order-preserving plain text of one block's authored content */
function blockText(b: VmBlock): string {
  const p = b.payload as Record<string, unknown>;
  try {
    switch (b.type) {
      case "text":
      case "callout":
        return safePlain(p.content);
      case "faq":
        return faqItems(p)
          .map((it) => `${it.question}\n${safePlain(it.answer)}`)
          .join("\n");
      case "steps":
        return (Array.isArray(p.steps) ? (p.steps as Record<string, unknown>[]) : [])
          .map((s) => [s?.title, s?.instruction, s?.menuPath].filter((x) => typeof x === "string" && x).join(" — "))
          .join("\n");
      case "image":
        return `image:${String(p.imageAssetId ?? "")}:${String(p.caption ?? "")}`;
      case "parameterTable":
        return `params:${(Array.isArray(p.groupIds) ? (p.groupIds as string[]) : []).join(",")}`;
      default:
        return JSON.stringify(p ?? {});
    }
  } catch {
    return "";
  }
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Fingerprint of the evidence a submission points at.
 * - block anchor  → that one block's type + normalized text (or the sentinel `__missing_block__`
 *   when the block no longer exists in the section, which forces STALE)
 * - section anchor → every block in the section, order preserved
 */
export function evidenceFingerprint(section: VmSection | null | undefined, blockId: string | null): string {
  let scope: string;
  if (!section) {
    scope = "__missing_section__";
  } else if (blockId) {
    const b = section.blocks.find((x) => x.id === blockId);
    scope = b ? `${b.type}${UNIT}${norm(blockText(b))}` : "__missing_block__";
  } else {
    scope = section.blocks.map((b) => `${b.type}${UNIT}${norm(blockText(b))}`).join(RECORD);
  }
  return createHash("sha256")
    .update([FINGERPRINT_VERSION, section?.key ?? "", blockId ?? "", scope].join(UNIT))
    .digest("hex");
}
