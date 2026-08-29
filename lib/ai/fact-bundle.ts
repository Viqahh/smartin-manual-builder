/**
 * Build the allowlisted FactBundle (PRD-AI-003, AC-P4-4). Facts come ONLY from the current
 * Manual Version and its linked EA Version. Every fact has a stable, verifiable reference id.
 *
 * CRITICAL GI-10: each supported configuration is ONE `setup` fact with `symbol` + `timeframe`
 * kept paired. Symbols and timeframes are never flattened into separate lists (that would let
 * a consumer infer an unlisted combination).
 */

import { richTextToPlainText } from "@/lib/domain/rich-text";
import type { ManualViewModel } from "@/lib/manual/view-model";
import type { Fact, FactBundle, TargetField } from "./types";

type Section = ManualViewModel["sections"][number];
type Block = Section["blocks"][number];

export type BlockContext = {
  blockId: string | null;
  blockType: Block["type"] | null;
  targetField: TargetField | null;
};

/** Keys of `ea_versions.requirements` that may become facts, with friendly labels. */
const REQUIREMENT_LABELS: Record<string, string> = {
  accountType: "Jenis akun",
  testingDeposit: "Deposit pengujian (data developer)",
  brokerRequirements: "Persyaratan broker",
  vps: "VPS",
  dll: "Izin DLL",
  webRequest: "Izin WebRequest",
  customIndicators: "Indikator kustom",
  note: "Catatan versi EA",
};

function pushRequirementFacts(facts: Fact[], requirements: Record<string, unknown>) {
  for (const [key, value] of Object.entries(requirements ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    facts.push({
      id: `requirement:${key}`,
      kind: "requirement",
      label: REQUIREMENT_LABELS[key] ?? key,
      value,
      source: "EA Version — Persyaratan",
    });
  }
}

function blockPlainText(block: Block): string {
  const p = block.payload as Record<string, unknown>;
  switch (block.type) {
    case "text":
      return safePlain(p.content);
    case "callout":
      return safePlain(p.content);
    case "faq":
      return [typeof p.question === "string" ? p.question : "", safePlain(p.answer)].filter(Boolean).join("\n");
    case "steps": {
      const steps = Array.isArray(p.steps) ? (p.steps as Record<string, unknown>[]) : [];
      return steps
        .map((s) => [s.title, s.instruction, s.menuPath].filter((x) => typeof x === "string" && x).join(" — "))
        .join("\n");
    }
    case "image":
      return typeof p.caption === "string" ? p.caption : "";
    default:
      return "";
  }
}

function safePlain(v: unknown): string {
  try {
    if (v && typeof v === "object") return richTextToPlainText(v as never);
  } catch {
    /* fall through */
  }
  return "";
}

export function buildFactBundle(
  vm: ManualViewModel,
  section: Section | undefined,
  blockCtx: BlockContext,
): FactBundle {
  const facts: Fact[] = [];

  // --- EA identity ---
  facts.push({ id: "ea:name", kind: "ea", label: "Nama EA", value: vm.eaProduct.name, source: "EA Product" });
  facts.push({ id: "ea:platform", kind: "ea", label: "Platform", value: vm.eaVersion.platform, source: "EA Version" });
  facts.push({ id: "ea:version", kind: "ea", label: "Versi EA", value: vm.eaVersion.version, source: "EA Version" });
  facts.push({
    id: "ea:manualVersion",
    kind: "ea",
    label: "Versi manual",
    value: vm.manualVersion.version,
    source: "Manual Version",
  });

  // --- Supported configurations — GI-10: symbol + timeframe stay paired, one fact per row ---
  for (const s of vm.supportedSetups) {
    facts.push({
      id: `setup:${s.id}`,
      kind: "setup",
      label: `Konfigurasi: ${s.symbol} / ${s.timeframe}`,
      value: {
        symbol: s.symbol,
        timeframe: s.timeframe,
        testedMinimumLot: s.testedMinimumLot,
        presetRef: s.presetRef,
        notes: s.notes,
        isSupported: s.isSupported,
      },
      source: "Supported Configuration",
    });
  }

  // --- EA Version requirements ---
  pushRequirementFacts(facts, vm.eaVersion.requirements ?? {});

  // --- Parameter groups + parameters (linked EA Version only — GI-11) ---
  for (const g of vm.parameterGroups) {
    facts.push({
      id: `parameterGroup:${g.id}`,
      kind: "parameterGroup",
      label: `Grup parameter: ${g.name}`,
      value: { name: g.name },
      source: "EA Version — Parameter",
    });
    for (const p of g.parameters) {
      facts.push({
        id: `parameter:${p.id}`,
        kind: "parameter",
        label: `Parameter: ${p.displayName}`,
        value: {
          group: g.name,
          displayName: p.displayName,
          technicalName: p.technicalName,
          paramType: p.paramType,
          defaultValue: p.defaultValue,
          unit: p.unit,
          safeRange: p.safeRange,
          description: p.description,
          orderEffect: p.orderEffect,
          mutability: p.mutability,
          required: p.required,
        },
        source: "EA Version — Parameter",
      });
    }
  }

  // --- Current chapter ---
  if (section) {
    facts.push({
      id: `chapter:${section.key}`,
      kind: "chapter",
      label: `Bab: ${section.title}`,
      value: { key: section.key, title: section.title },
      source: "Bab manual ini",
    });
  }

  // --- Current block + its allowlisted content ---
  const block =
    blockCtx.blockId && section ? section.blocks.find((b) => b.id === blockCtx.blockId) ?? null : null;
  if (blockCtx.blockType) {
    facts.push({
      id: `block:${blockCtx.blockId ?? "current"}`,
      kind: "block",
      label: `Blok: ${blockCtx.blockType}`,
      value: { type: blockCtx.blockType },
      source: "Blok manual ini",
    });
  }
  if (block) {
    const text = blockPlainText(block);
    if (text) {
      facts.push({
        id: "blockContent:current",
        kind: "blockContent",
        label: "Isi blok saat ini",
        value: text.slice(0, 8000),
        source: "Blok manual ini",
      });
    }
    // --- Image metadata only — NEVER a signed URL or binary ---
    if (block.type === "image" && block.imageAssetId) {
      const img = vm.images[block.imageAssetId];
      facts.push({
        id: `image:${block.imageAssetId}`,
        kind: "image",
        label: "Metadata gambar",
        value: {
          altText: img?.altText ?? null,
          caption: img?.caption ?? null,
        },
        source: "Metadata gambar",
      });
    }
  }

  return { facts };
}
