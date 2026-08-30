/**
 * Phase 7 slice 1 — pure adapter: a persisted publication snapshot → sanitized `ManualViewModel`.
 *
 * The public route renders published documentation from the IMMUTABLE `published_snapshots.render_json`
 * ONLY (AC-P7-2). This turns that frozen json into the exact `ManualViewModel` shape the one shared
 * `ManualRenderer` consumes — with SYNTHETIC, non-UUID ids so no database identifier reaches the
 * public HTML. It never touches the database and never calls `assembleManualViewModel`.
 *
 * Handles snapshot v2 (positional `groupRefs` / `imageRef`, ordered `content.images` array) and
 * falls back for any legacy v1 row (raw-UUID refs it cannot resolve → the renderer shows every
 * parameter group, which is the pre-Phase-7 behaviour; v1 images still resolve by sorted key).
 */

import { publicImageUrl, snapshotImageDescriptors } from "@/lib/publication/snapshot-image";
import type { ManualViewModel } from "@/lib/manual/view-model";
import type { ManualStatusDb } from "@/lib/supabase/database.types";

export type SnapshotAdapterMeta = {
  slug: string;
  version: string;
  /** the publication lifecycle state of THIS version (drives `manualVersion.status`) */
  status: Extract<ManualStatusDb, "PUBLISHED" | "ARCHIVED">;
};

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown, fallback = ""): string => (typeof x === "string" ? x : fallback);
const orNull = <T>(x: T | undefined | null): T | null => (x == null ? null : x);

/**
 * Strip any lingering raw id from a block payload and restore a synthetic step-image reference.
 * The renderer never reads `imageAssetId` / `groupIds` at payload level, but keeping the payload
 * UUID-free matches the Snapshot-v2 guarantee end to end.
 */
function sanitizePayload(
  p: unknown,
  v2: boolean,
  v1ImageKey: Map<string, string>,
): Record<string, unknown> {
  if (!isObj(p)) return {};
  const c = { ...p };
  delete c.imageAssetId;
  delete c.groupIds;
  if (Array.isArray(c.steps)) {
    c.steps = c.steps.map((s) => {
      if (!isObj(s)) return s;
      const step = { ...s };
      if (v2 && typeof step.imageRef === "number") {
        step.imageAssetId = `img-${step.imageRef}`;
      } else if (!v2 && typeof step.imageAssetId === "string") {
        step.imageAssetId = v1ImageKey.get(step.imageAssetId) ?? null;
      }
      delete step.imageRef;
      return step;
    });
  }
  return c;
}

export function snapshotToViewModel(
  renderJson: unknown,
  meta: SnapshotAdapterMeta,
): ManualViewModel {
  const root = isObj(renderJson) ? renderJson : {};
  const v2 = root.snapshotVersion === 2;
  const content = isObj(root.content) ? root.content : {};

  const cm = isObj(content.manual) ? content.manual : {};
  const cv = isObj(content.manualVersion) ? content.manualVersion : {};
  const cp = isObj(content.eaProduct) ? content.eaProduct : {};
  const ce = isObj(content.eaVersion) ? content.eaVersion : {};
  const co = isObj(content.organization) ? content.organization : {};

  const parameterGroups: ManualViewModel["parameterGroups"] = arr(content.parameterGroups).map(
    (g, gi) => {
      const gg = isObj(g) ? g : {};
      return {
        id: `pg-${gi}`,
        name: str(gg.name),
        position: typeof gg.position === "number" ? gg.position : gi,
        parameters: arr(gg.parameters).map((p, pi) => {
          const pp = isObj(p) ? p : {};
          return {
            id: `par-${gi}-${pi}`,
            displayName: str(pp.displayName),
            technicalName: str(pp.technicalName),
            paramType: (pp.paramType ?? "string") as ManualViewModel["parameterGroups"][number]["parameters"][number]["paramType"],
            defaultValue: orNull(pp.defaultValue as string | null),
            unit: orNull(pp.unit as string | null),
            safeRange: orNull(pp.safeRange as string | null),
            description: orNull(pp.description as string | null),
            orderEffect: orNull(pp.orderEffect as string | null),
            mutability: (pp.mutability ?? "before_start") as ManualViewModel["parameterGroups"][number]["parameters"][number]["mutability"],
            required: pp.required === true,
            position: typeof pp.position === "number" ? pp.position : pi,
          };
        }),
      };
    },
  );

  // images: THE canonical ordered descriptor list (shared with the /image/[idx] proxy route).
  // A public image's `signedUrl` is a SAME-ORIGIN proxy path — never a Supabase signed URL, never
  // the private `storageKey`. A descriptor with no `storageKey` gets `null` so the renderer shows
  // its accessible "[gambar belum tersedia]" placeholder instead of a broken <img>.
  const images: ManualViewModel["images"] = {};
  const v1ImageKey = new Map<string, string>();
  snapshotImageDescriptors(renderJson).forEach((d, i) => {
    if (d.sourceKey) v1ImageKey.set(d.sourceKey, `img-${i}`);
    images[`img-${i}`] = {
      id: `img-${i}`,
      altText: d.altText,
      caption: d.caption,
      signedUrl: d.storageKey ? publicImageUrl(meta.slug, meta.version, i) : null,
    };
  });

  const sections: ManualViewModel["sections"] = arr(content.sections).map((sec, si) => {
    const ss = isObj(sec) ? sec : {};
    return {
      id: `sec-${str(ss.key, String(si))}`,
      key: str(ss.key, `section-${si}`),
      title: str(ss.title),
      required: ss.required === true,
      isCustom: ss.isCustom === true,
      position: typeof ss.position === "number" ? ss.position : si,
      completionState: "complete",
      rowVersion: 0,
      blocks: arr(ss.blocks).map((b, bi) => {
        const bb = isObj(b) ? b : {};
        let parameterGroupIds: string[] = [];
        let imageAssetId: string | null = null;
        if (v2) {
          if (Array.isArray(bb.groupRefs)) {
            parameterGroupIds = bb.groupRefs
              .filter((r): r is number => typeof r === "number")
              .map((r) => `pg-${r}`);
          }
          if (typeof bb.imageRef === "number") imageAssetId = `img-${bb.imageRef}`;
        } else if (typeof bb.imageAssetId === "string") {
          // v1: block parameterGroupIds are raw UUIDs with no map back to the id-less group array —
          // leave empty so the renderer shows every group (pre-Phase-7 behaviour).
          imageAssetId = v1ImageKey.get(bb.imageAssetId) ?? null;
        }
        return {
          id: `blk-${si}-${bi}`,
          type: (bb.type ?? "text") as ManualViewModel["sections"][number]["blocks"][number]["type"],
          payload: sanitizePayload(bb.payload, v2, v1ImageKey),
          position: typeof bb.position === "number" ? bb.position : bi,
          imageAssetId,
          parameterGroupIds,
          rowVersion: 0,
        };
      }),
    };
  });

  const supportedSetups: ManualViewModel["supportedSetups"] = arr(content.supportedSetups).map(
    (s, i) => {
      const sv = isObj(s) ? s : {};
      return {
        id: `set-${i}`,
        symbol: str(sv.symbol),
        timeframe: (sv.timeframe ?? "M15") as ManualViewModel["supportedSetups"][number]["timeframe"],
        presetRef: orNull(sv.presetRef as string | null),
        testedMinimumLot: typeof sv.testedMinimumLot === "number" ? sv.testedMinimumLot : null,
        notes: orNull(sv.notes as string | null),
        isSupported: sv.isSupported !== false,
        position: typeof sv.position === "number" ? sv.position : i,
      };
    },
  );

  const changelog: ManualViewModel["changelog"] = arr(content.changelog).map((c, i) => {
    const cc = isObj(c) ? c : {};
    return {
      id: `cl-${i}`,
      position: typeof cc.position === "number" ? cc.position : i,
      entryType: (cc.entryType ?? "CHANGED") as NonNullable<ManualViewModel["changelog"]>[number]["entryType"],
      body: str(cc.body),
      sourceEaVersionId: null,
      isFeatureChange: cc.isFeatureChange === true,
      openPositionImpact: orNull(cc.openPositionImpact as string | null),
    };
  });

  return {
    manual: { id: "", locale: str(cm.locale, "id") },
    manualVersion: {
      id: "",
      version: str(cv.version, meta.version),
      status: meta.status,
      rowVersion: 0,
      updatedAt: "",
    },
    eaProduct: {
      id: "",
      name: str(cp.name),
      slug: str(cp.slug, meta.slug),
      description: str(cp.description),
    },
    eaVersion: {
      id: "",
      version: str(ce.version),
      platform: ce.platform === "MT4" ? "MT4" : "MT5",
      releaseDate: orNull(ce.releaseDate as string | null),
      requirements: isObj(ce.requirements) ? ce.requirements : {},
      support: isObj(ce.support) ? ce.support : {},
    },
    organization: { id: "", name: str(co.name) },
    developer: typeof content.developer === "string" && content.developer ? { name: content.developer } : null,
    supportedSetups,
    sections,
    parameterGroups,
    images,
    changelog,
  };
}
