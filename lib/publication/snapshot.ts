/**
 * Phase 6 slice 6 / Phase 7 slice 1 — the immutable publication snapshot (AC-P6-9/10, AC-P7-2).
 *
 * `buildPublishedSnapshot(vm, opts)` is a deterministic, publish-safe PROJECTION of the SAME
 * `ManualViewModel` the builder / preview / review fingerprint use — there is no second content
 * model. It freezes every resolved value the public renderer needs to reproduce the documentation
 * WITHOUT re-reading mutable draft / manual / EA tables.
 *
 * ── snapshot v2 (Phase 7) ─────────────────────────────────────────────────────────────────────
 * v2 is a PUBLICATION-LAYER representation only. `projectReviewContent` / `manualReviewFingerprint`
 * / the submitted + reviewed content hashes are NOT touched. v2 removes every raw database UUID
 * from the public-renderable content and replaces the two reference kinds with deterministic
 * positional indices:
 *   • `content.parameterGroups` is an ordered array (by `position`); a `parameterTable` block gets
 *     `groupRefs: number[]` = indices into that array (was raw `parameterGroupIds` UUIDs).
 *   • images are collected in FIRST-APPEARANCE order while walking the ordered sections → ordered
 *     blocks → (for a `steps` block) ordered steps — never JS object-insertion order of the input
 *     map. An `image` block gets `imageRef: number`; a `steps[n]` with an image gets `imageRef`
 *     (its raw `imageAssetId` UUID removed); `content.images` / the top-level `images` become
 *     arrays in that same order.
 * The top-level `images` array carries the server-only `storageKey` for the future image proxy
 * (Slice 3) and MUST NOT be sent to a client — see `get-public-manual.ts`.
 *
 * `computeSnapshotHash(json)` is `sha256(stableStringify(json))` — key-order-insensitive,
 * content-order-sensitive — reusing the repository's canonical serializer. A v1 json still hashes
 * to its v1 hash; a v2 json hashes to its v2 hash. Re-running it against the stored `render_json`
 * must reproduce `published_snapshots.content_hash` byte-stably.
 */

import { createHash } from "node:crypto";
import { stableStringify } from "@/lib/editor/autosave-queue";
import { projectReviewContent } from "@/lib/reviews/fingerprint";
import type { ManualViewModel } from "@/lib/manual/view-model";

/** SERVER-ONLY. `storageKey` feeds the Slice-3 image proxy; never serialize this to a client. */
export type SnapshotImageMeta = {
  storageKey: string | null;
  altText: string | null;
  caption: string | null;
};

export type BuildSnapshotOptions = {
  templateId: string;
  templateVersion: number;
  publicSlug: string;
  publicVersion: string;
  /** stable storage keys by image asset id (from `image_assets`); NEVER a signed URL */
  imageStorageKeys?: Record<string, string | null>;
};

export type PublishedSnapshotJson = {
  snapshotVersion: 2;
  public: { slug: string; version: string };
  template: { id: string; version: number };
  /** projectReviewContent output, post-processed: no raw UUID in any renderable field */
  content: Record<string, unknown>;
  /** ordered by first block appearance; SERVER-ONLY (carries storageKey) */
  images: SnapshotImageMeta[];
};

/** Keys that must never appear anywhere in a persisted snapshot (spec §8). */
const FORBIDDEN_SNAPSHOT_KEYS = [
  "signedurl",
  "signed_url",
  "token",
  "accesstoken",
  "access_token",
  "apikey",
  "api_key",
  "authorization",
  "secret",
  "password",
  "session",
  "requestid",
  "request_id",
  "servertiming",
  "updatedat",
  "updated_at",
  "rowversion",
  "row_version",
];

type MutBlock = Record<string, unknown>;
type MutSection = { blocks: MutBlock[] };

export function buildPublishedSnapshot(
  vm: ManualViewModel,
  opts: BuildSnapshotOptions,
): PublishedSnapshotJson {
  // projectReviewContent already excludes signed URLs / timestamps / row versions / db row ids
  // for setups & parameters, and orders sections / blocks / groups deterministically. It returns a
  // fresh object every call; the ONLY shared references are the block `payload`s (cloned below).
  const content = projectReviewContent({ vm });

  // v2 carries NO internal database identity: the public renderer never uses these ids and the
  // snapshot→ViewModel adapter discards them. Dropping them here keeps the snapshot UUID-free by
  // construction (spec §15). Content identity is preserved by value (names, versions, keys).
  for (const k of ["manual", "manualVersion", "eaProduct", "eaVersion", "organization"] as const) {
    const node = content[k];
    if (node && typeof node === "object") delete (node as Record<string, unknown>).id;
  }
  for (const c of (content.changelog ?? []) as Record<string, unknown>[]) {
    delete c.sourceEaVersionId; // raw EA-version UUID — no public meaning
  }

  const sections = (content.sections ?? []) as MutSection[];

  // raw group UUID -> index into the ordered `content.parameterGroups` array (same order:
  // projectReviewContent sorts parameterGroups by `position`, exactly as we do here).
  const groupOrder = [...vm.parameterGroups].sort((a, b) => a.position - b.position);
  const groupIndex = new Map(groupOrder.map((g, i) => [g.id, i]));

  // image order = first appearance walking ordered sections -> ordered blocks -> (steps) ordered
  // steps; then any orphan uploaded asset (never referenced by a block) in sorted-key order so the
  // array is still total and fully deterministic regardless of vm.images key insertion order.
  const imageOrder: string[] = [];
  const pushImg = (aid: unknown) => {
    if (typeof aid === "string" && aid && !imageOrder.includes(aid)) imageOrder.push(aid);
  };
  for (const sec of sections) {
    for (const b of sec.blocks) {
      pushImg(b.imageAssetId);
      if (b.type === "steps") {
        const steps = (b.payload as Record<string, unknown> | undefined)?.steps;
        if (Array.isArray(steps)) for (const s of steps) pushImg((s as Record<string, unknown>)?.imageAssetId);
      }
    }
  }
  for (const aid of Object.keys(vm.images).sort()) {
    if (!imageOrder.includes(aid)) imageOrder.push(aid);
  }
  const imageIndex = new Map(imageOrder.map((aid, i) => [aid, i]));

  // rewrite every block: clone the payload, strip raw UUIDs, attach positional refs.
  for (const sec of sections) {
    for (const b of sec.blocks) {
      const payload = { ...(b.payload as Record<string, unknown>) };

      if (b.type === "parameterTable") {
        const raw = (b.parameterGroupIds as string[] | undefined) ?? [];
        const refs = raw
          .map((id) => groupIndex.get(id))
          .filter((n): n is number => typeof n === "number");
        b.groupRefs = refs;
        if (Array.isArray(payload.groupIds)) payload.groupIds = refs;
      }

      if (b.type === "image") {
        const aid = b.imageAssetId as string | null;
        b.imageRef = aid != null ? imageIndex.get(aid) ?? null : null;
      }

      // steps block: rewrite each step's raw `imageAssetId` UUID -> positional `imageRef`.
      if (b.type === "steps" && Array.isArray(payload.steps)) {
        payload.steps = (payload.steps as Record<string, unknown>[]).map((s) => {
          if (s && typeof s === "object" && typeof s.imageAssetId === "string") {
            const { imageAssetId, ...rest } = s;
            return { ...rest, imageRef: imageIndex.get(imageAssetId) ?? null };
          }
          return s;
        });
      }

      // no raw asset UUID survives in a payload; parameterTable keeps `groupIds` as numeric refs.
      delete payload.imageAssetId;
      if (b.type !== "parameterTable") delete payload.groupIds;

      b.payload = payload;
      delete b.parameterGroupIds;
      delete b.imageAssetId;
    }
  }

  // content.images: ordered, PUBLIC-safe (alt + caption only — no storage key)
  const rawImages = (content.images ?? {}) as Record<
    string,
    { altText: string | null; caption: string | null }
  >;
  content.images = imageOrder.map((aid) => ({
    altText: rawImages[aid]?.altText ?? vm.images[aid]?.altText ?? null,
    caption: rawImages[aid]?.caption ?? vm.images[aid]?.caption ?? null,
  }));

  // top-level SERVER-ONLY image array, SAME order — carries storageKey for the Slice-3 proxy.
  const images: SnapshotImageMeta[] = imageOrder.map((aid) => ({
    storageKey: opts.imageStorageKeys?.[aid] ?? null,
    altText: vm.images[aid]?.altText ?? rawImages[aid]?.altText ?? null,
    caption: vm.images[aid]?.caption ?? rawImages[aid]?.caption ?? null,
  }));

  return {
    snapshotVersion: 2,
    public: { slug: opts.publicSlug, version: opts.publicVersion },
    template: { id: opts.templateId, version: opts.templateVersion },
    content,
    images,
  };
}

/** sha256 hex of the canonical serialization (key-order-insensitive, content-order-sensitive). */
export function computeSnapshotHash(json: PublishedSnapshotJson | Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(json), "utf8").digest("hex");
}

/**
 * Recursively scan a would-be / stored snapshot for volatile or secret keys (spec §8 leak scan).
 * Returns the offending key paths — empty means clean. `storageKey` is intentionally NOT in the
 * forbidden set: it is a legitimate server-only field in the top-level `images` array.
 */
export function scanSnapshotForLeaks(json: unknown): string[] {
  const hits: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (FORBIDDEN_SNAPSHOT_KEYS.includes(k.toLowerCase().replace(/[^a-z_]/g, ""))) {
          hits.push(path ? `${path}.${k}` : k);
        }
        walk(v, path ? `${path}.${k}` : k);
      }
    }
  };
  walk(json, "");
  return hits;
}
