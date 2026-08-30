/**
 * Phase 7 slice 2 — client-side in-page search, WITHIN ONE published snapshot.
 *
 * `buildPublicSearchIndex(vm)` is a pure projection of the already-sanitized `ManualViewModel`
 * (from `snapshotToViewModel`) into publication-safe {anchor, chapter, kind, text} rows in
 * DOCUMENT ORDER. It indexes only what the reader actually sees on the page (chapter titles, rich
 * text via `richTextToPlainText`, steps, FAQ, resolved parameter tables, supported configurations)
 * — never DB ids, reviewer / checklist / audit data, storage keys, or the changelog (the renderer
 * does not render it). `searchPublicIndex(index, query)` is a case-insensitive, whitespace-
 * normalized substring match with a bounded snippet. Both are pure and unit-tested; the client
 * component only renders their output.
 */

import { richTextToPlainText } from "@/lib/domain/rich-text";
import { chapterAnchor, type ManualViewModel } from "@/lib/manual/view-model";

export type PublicSearchEntry = {
  anchor: string;
  chapter: string;
  kind: string;
  text: string;
};

export type PublicSearchResult = {
  anchor: string;
  chapter: string;
  kind: string;
  snippet: string;
};

const KIND = {
  chapter: "Bab",
  text: "Teks",
  callout: "Catatan",
  steps: "Langkah",
  faq: "FAQ",
  parameter: "Parameter",
  config: "Konfigurasi",
} as const;

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Rich text -> visible plain text; never throws on a malformed payload. */
function safePlain(value: unknown): string {
  try {
    return richTextToPlainText(value as Parameters<typeof richTextToPlainText>[0]);
  } catch {
    return "";
  }
}

const SETUP_SECTION_KEYS = new Set(["requirements", "presets"]);

export function buildPublicSearchIndex(vm: ManualViewModel): PublicSearchEntry[] {
  const out: PublicSearchEntry[] = [];
  const groupsById = new Map(vm.parameterGroups.map((g) => [g.id, g]));

  vm.sections.forEach((section, index) => {
    const anchor = chapterAnchor(index);
    const chapter = section.title || `Bab ${index + 1}`;
    const push = (kind: string, text: string) => {
      const t = text.replace(/\s+/g, " ").trim();
      if (t) out.push({ anchor, chapter, kind, text: t });
    };

    push(KIND.chapter, chapter);

    for (const block of section.blocks) {
      const payload = block.payload as Record<string, unknown>;
      switch (block.type) {
        case "text":
          push(KIND.text, safePlain(payload.content));
          break;
        case "callout":
          push(KIND.callout, safePlain(payload.content));
          break;
        case "steps": {
          const steps = Array.isArray(payload.steps) ? (payload.steps as Record<string, unknown>[]) : [];
          for (const s of steps) {
            push(
              KIND.steps,
              [s.title, s.instruction, s.menuPath].filter((x): x is string => typeof x === "string" && x !== "").join(" — "),
            );
          }
          break;
        }
        case "faq":
          push(KIND.faq, [String(payload.question ?? ""), safePlain(payload.answer)].join(" — "));
          break;
        case "parameterTable": {
          const ids = block.parameterGroupIds ?? [];
          const groups = ids.length
            ? ids.map((id) => groupsById.get(id)).filter((g): g is NonNullable<typeof g> => !!g)
            : vm.parameterGroups;
          for (const g of groups) {
            const params = g.parameters
              .map((p) =>
                [p.displayName, p.technicalName, p.paramType, p.defaultValue, p.unit, p.safeRange, p.description, p.orderEffect]
                  .filter((x): x is string => typeof x === "string" && x !== "")
                  .join(" "),
              )
              .join(" · ");
            push(KIND.parameter, [g.name, params].filter(Boolean).join(" — "));
          }
          break;
        }
        default:
          break; // image: nothing textual to index in slice 2
      }
    }

    // The renderer injects the supported-configuration table into these chapters.
    if (SETUP_SECTION_KEYS.has(section.key)) {
      for (const s of vm.supportedSetups) {
        push(
          KIND.config,
          [s.symbol, s.timeframe, s.presetRef, s.testedMinimumLot == null ? null : String(s.testedMinimumLot)]
            .filter((x): x is string => typeof x === "string" && x !== "")
            .join(" "),
        );
      }
    }
  });

  return out;
}

export function searchPublicIndex(index: PublicSearchEntry[], rawQuery: string): PublicSearchResult[] {
  const q = norm(rawQuery);
  if (!q) return [];
  const results: PublicSearchResult[] = [];
  for (const e of index) {
    const flat = e.text.replace(/\s+/g, " ").trim();
    const hit = flat.toLowerCase().indexOf(q);
    if (hit === -1) continue;
    const start = Math.max(0, hit - 40);
    const end = Math.min(flat.length, hit + q.length + 60);
    const snippet = `${start > 0 ? "… " : ""}${flat.slice(start, end)}${end < flat.length ? " …" : ""}`;
    results.push({ anchor: e.anchor, chapter: e.chapter, kind: e.kind, snippet });
  }
  return results; // document order (index is already in document order)
}
