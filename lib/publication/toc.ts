/**
 * Phase 7 slice 2 — public table of contents.
 *
 * Pure projection of the ordered, already-sanitized `vm.sections` (from `snapshotToViewModel`).
 * The order is IDENTICAL to `ManualRenderer`'s section order, and the anchor comes from the one
 * shared `chapterAnchor` helper — there is no second chapter list anywhere.
 */

import { chapterAnchor, type ManualViewModel } from "@/lib/manual/view-model";

export type TocEntry = {
  /** 1-based chapter number as shown to the reader */
  number: number;
  title: string;
  /** DOM id of the rendered `<section>` — `chapter-<index>` */
  anchor: string;
};

export function buildToc(vm: ManualViewModel): TocEntry[] {
  return vm.sections.map((s, i) => ({
    number: i + 1,
    title: s.title || `Bab ${i + 1}`,
    anchor: chapterAnchor(i),
  }));
}
