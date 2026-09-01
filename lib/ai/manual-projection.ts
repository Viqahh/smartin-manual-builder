/**
 * Controlled textual projection of the CURRENT manual for the whole-manual claim scan (§16).
 * Includes only: chapter headings, `text` blocks, `faq` question + answer, `image` captions,
 * `callout` bodies, and `steps` text — all from this Manual Version. Never other manuals,
 * hidden DB data, credentials, signed URLs, or source code. If this projection is sent to a
 * provider it occupies the `selectedText` field of a `GroundedRequest` (never a side channel).
 */

import { richTextToPlainText } from "@/lib/domain/rich-text";
import { faqItems } from "@/lib/domain/blocks";
import type { ManualViewModel } from "@/lib/manual/view-model";
import type { ScanLine } from "./claim-scanner";

function plain(v: unknown): string {
  try {
    if (v && typeof v === "object") return richTextToPlainText(v as never);
  } catch {
    /* ignore */
  }
  return "";
}

export function projectManualLines(vm: ManualViewModel): ScanLine[] {
  const lines: ScanLine[] = [];
  const push = (text: string, location: string) => {
    for (const l of text.split(/\n+/)) {
      const t = l.trim();
      if (t) lines.push({ text: t, location });
    }
  };

  for (const section of vm.sections) {
    const chapter = `Bab "${section.title}"`;
    push(section.title, `${chapter} — judul`);
    for (const block of section.blocks) {
      const p = block.payload as Record<string, unknown>;
      switch (block.type) {
        case "text":
          push(plain(p.content), `${chapter} — teks`);
          break;
        case "callout":
          push(plain(p.content), `${chapter} — callout`);
          break;
        case "faq":
          for (const it of faqItems(p)) {
            push(it.question, `${chapter} — FAQ (pertanyaan)`);
            push(plain(it.answer), `${chapter} — FAQ (jawaban)`);
          }
          break;
        case "steps": {
          const steps = Array.isArray(p.steps) ? (p.steps as Record<string, unknown>[]) : [];
          steps.forEach((s, i) => {
            const t = [s.title, s.instruction, s.menuPath].filter((x) => typeof x === "string" && x).join(" — ");
            push(t, `${chapter} — langkah ${i + 1}`);
          });
          break;
        }
        case "image":
          push(typeof p.caption === "string" ? p.caption : "", `${chapter} — keterangan gambar`);
          break;
        default:
          break;
      }
    }
  }
  return lines;
}

/** The same projection as one string — used as `selectedText` for a provider-backed scan. */
export function projectManualText(vm: ManualViewModel): string {
  return projectManualLines(vm)
    .map((l) => l.text)
    .join("\n");
}
