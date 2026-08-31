/**
 * Phase 7 slice 5 — AC-P7-4 content-parity model.
 *
 * `buildOutputParityManifest(vm)` is a PURE, deterministic projection of every PUBLIC-RENDERED
 * semantic value the one shared `ManualRenderer` emits — chapters, block order, visible text,
 * parameter values, image alt/caption — and NOTHING surface-specific (TOC / search / version
 * switcher / archived banner / download button on the web; pagination / page-number footer on
 * print). The web route and the signed print route both feed the SAME `ManualViewModel` (from
 * `getPublicManual`) into the SAME renderer, so the manifest built from either surface's rendered
 * output must be byte-equal. `tests/support/parity-html.ts` builds the same manifest by parsing the
 * actual rendered `.a4-document` HTML, and `diffOutputParity` reports any divergence with a path
 * like `chapter[5].blocks[2].parameters[7].defaultValue`.
 *
 * Normalisation is deterministic: incidental whitespace only. Real words / numbers are never
 * rewritten; content whose order is meaningful is never sorted. Chapter identity is (ordered
 * index) + title — `section.key` is not part of the public output, so it is not compared.
 */

import { richTextToPlainText } from "@/lib/domain/rich-text";
import { BROKER_MIN_LOT_NOTE_ID } from "@/lib/domain/setups";
import { manualIdentity, type ManualViewModel } from "@/lib/manual/view-model";

export type ParityParam = {
  index: number;
  displayName: string;
  technicalName: string;
  paramType: string;
  defaultValue: string;
  safeRange: string;
  orderEffect: string;
};

export type ParityBlock =
  | { kind: "text"; text: string }
  | { kind: "callout"; tone: string; text: string }
  | { kind: "faq"; question: string; answer: string }
  | {
      kind: "steps";
      steps: {
        index: number;
        title: string;
        instruction: string;
        menuPath: string | null;
        image: { alt: string; caption: string } | null;
      }[];
    }
  | { kind: "image"; image: { ref: number; alt: string; caption: string } | null }
  | {
      kind: "parameterTable";
      groups: { name: string; paramCount: number; parameters: ParityParam[] }[];
    }
  | {
      kind: "supportedSetups";
      rows: {
        symbol: string;
        timeframe: string;
        preset: string;
        testedMinimumLot: string;
        supported: string;
      }[];
      note: string;
    }
  | { kind: "placeholder"; text: string };

export type ParityChapter = {
  index: number;
  title: string;
  hasContent: boolean;
  blocks: ParityBlock[];
};

export type ParityManifest = {
  manual: { title: string; publicVersion: string; platform: string; eaVersion: string };
  chapters: ParityChapter[];
};

/** collapse incidental whitespace only — never touch actual words / numbers */
export const normText = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

const rt = (v: unknown): string => {
  try {
    return v && typeof v === "object" ? normText(richTextToPlainText(v as never)) : "";
  } catch {
    return "";
  }
};

/** `img-7` → 7 ; anything else → -1 */
const imageRef = (id: string | null | undefined): number => {
  const m = /^img-(\d+)$/.exec(id ?? "");
  return m ? Number(m[1]) : -1;
};

function blockManifest(
  block: ManualViewModel["sections"][number]["blocks"][number],
  vm: ManualViewModel,
): ParityBlock | null {
  const p = block.payload as Record<string, unknown>;
  switch (block.type) {
    case "text":
      return { kind: "text", text: rt(p.content) };
    case "callout":
      return { kind: "callout", tone: String(p.tone ?? "info"), text: rt(p.content) };
    case "faq":
      return { kind: "faq", question: normText(p.question), answer: rt(p.answer) };
    case "steps": {
      const steps = Array.isArray(p.steps) ? (p.steps as Record<string, unknown>[]) : [];
      return {
        kind: "steps",
        steps: steps.map((s, i) => {
          const img = typeof s.imageAssetId === "string" ? vm.images[s.imageAssetId] : undefined;
          return {
            index: i,
            title: normText(s.title),
            instruction: normText(s.instruction),
            menuPath: s.menuPath ? normText(s.menuPath) : null,
            image: img
              ? { alt: normText(img.altText ?? ""), caption: normText(img.caption ?? "") }
              : null,
          };
        }),
      };
    }
    case "image": {
      const asset = block.imageAssetId ? vm.images[block.imageAssetId] : undefined;
      if (!asset?.signedUrl) return { kind: "image", image: null };
      return {
        kind: "image",
        image: {
          ref: imageRef(block.imageAssetId),
          alt: normText(asset.altText ?? ""),
          // the renderer falls back to the block payload caption when the asset has none
          caption: normText(asset.caption ?? (p.caption as string) ?? ""),
        },
      };
    }
    case "parameterTable": {
      const wanted = vm.parameterGroups.filter((g) => block.parameterGroupIds.includes(g.id));
      const groups = wanted.length ? wanted : vm.parameterGroups;
      return {
        kind: "parameterTable",
        groups: groups.map((g) => ({
          name: normText(g.name),
          paramCount: g.parameters.length,
          parameters: g.parameters.map((prm, i) => ({
            index: i,
            displayName: normText(prm.displayName),
            technicalName: normText(prm.technicalName),
            paramType: normText(prm.paramType),
            defaultValue: normText(prm.defaultValue ?? "—"),
            safeRange: normText(prm.safeRange ?? "—"),
            orderEffect: normText(prm.orderEffect ?? prm.description ?? "—"),
          })),
        })),
      };
    }
    default:
      return null;
  }
}

function supportedSetupsBlock(vm: ManualViewModel): ParityBlock | null {
  if (vm.supportedSetups.length === 0) return null;
  return {
    kind: "supportedSetups",
    rows: vm.supportedSetups.map((s) => ({
      symbol: normText(s.symbol),
      timeframe: normText(s.timeframe),
      preset: normText(s.presetRef ?? "—"),
      testedMinimumLot:
        s.testedMinimumLot === null ? "—" : `${s.testedMinimumLot} (data uji developer)`,
      supported: s.isSupported ? "Ya" : "Tidak",
    })),
    note: normText(BROKER_MIN_LOT_NOTE_ID),
  };
}

/** THE canonical public content model. Feed it the same `vm` the renderer receives. */
export function buildOutputParityManifest(vm: ManualViewModel): ParityManifest {
  const id = manualIdentity(vm);
  const chapters: ParityChapter[] = vm.sections.map((section, index) => {
    const blocks: ParityBlock[] = [];
    for (const b of section.blocks) {
      const m = blockManifest(b, vm);
      if (m) blocks.push(m);
    }
    // the renderer injects the supported-configuration table into `requirements` / `presets`
    const injectSetups = section.key === "requirements" || section.key === "presets";
    if (injectSetups) {
      const setups = supportedSetupsBlock(vm);
      if (setups) blocks.push(setups);
    }
    // empty chapter with no injected table → the renderer shows a single lead placeholder
    if (section.blocks.length === 0 && !injectSetups) {
      blocks.push({
        kind: "placeholder",
        text: "Bab ini telah disiapkan dari template Smartin. Konten akan disusun pada editor (Phase 3).",
      });
    }
    return {
      index,
      title: normText(section.title),
      hasContent: section.blocks.length > 0 || injectSetups,
      blocks,
    };
  });

  return {
    manual: {
      title: normText(id.eaName),
      publicVersion: normText(id.manualVersion),
      platform: normText(id.platform),
      eaVersion: normText(id.eaVersion),
    },
    chapters,
  };
}

// ---------------------------------------------------------------------------
// deterministic diff
// ---------------------------------------------------------------------------

export type ParityDiff = { path: string; web: unknown; pdf: unknown };

/** Deep structural diff. `a` = web/expected, `b` = pdf/actual. Empty array ⇒ parity. */
export function diffOutputParity(a: unknown, b: unknown, path = ""): ParityDiff[] {
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = Array.isArray(a) ? a : [];
    const bb = Array.isArray(b) ? b : [];
    const out: ParityDiff[] = [];
    if (aa.length !== bb.length) out.push({ path: `${path}.length`, web: aa.length, pdf: bb.length });
    for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
      out.push(...diffOutputParity(aa[i], bb[i], `${path}[${i}]`));
    }
    return out;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const out: ParityDiff[] = [];
    for (const k of keys) {
      out.push(
        ...diffOutputParity(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          path ? `${path}.${k}` : k,
        ),
      );
    }
    return out;
  }
  return Object.is(a, b) ? [] : [{ path: path || "(root)", web: a, pdf: b }];
}
