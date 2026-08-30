/**
 * Phase 6 slice 6 — the immutable publication snapshot (AC-P6-9 / AC-P6-10).
 *
 * `buildPublishedSnapshot(vm, opts)` is a deterministic, publish-safe PROJECTION of the SAME
 * `ManualViewModel` the builder / preview / review fingerprint use — there is no second content
 * model. It freezes every resolved value Phase 7 needs to reproduce the documentation WITHOUT
 * re-reading mutable draft / manual / EA tables: EA identity + facts, ordered supported setups,
 * ordered parameter groups with fully-resolved parameter definitions, ordered sections + active
 * blocks, structured changelog, and image METADATA (id / storage key / alt / caption) — never a
 * signed URL, token, timestamp, credential, or provider metadata.
 *
 * `computeSnapshotHash(json)` is `sha256(stableStringify(json))` — key-order-insensitive,
 * content-order-sensitive — reusing the repository's canonical serializer. Re-running it against
 * the stored `render_json` must reproduce `published_snapshots.content_hash` byte-stably.
 */

import { createHash } from "node:crypto";
import { stableStringify } from "@/lib/editor/autosave-queue";
import { projectReviewContent } from "@/lib/reviews/fingerprint";
import type { ManualViewModel } from "@/lib/manual/view-model";

export type SnapshotImageMeta = {
  id: string;
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
  snapshotVersion: 1;
  public: { slug: string; version: string };
  template: { id: string; version: number };
  content: Record<string, unknown>;
  images: Record<string, SnapshotImageMeta>;
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

export function buildPublishedSnapshot(
  vm: ManualViewModel,
  opts: BuildSnapshotOptions,
): PublishedSnapshotJson {
  // projectReviewContent already excludes signed URLs / timestamps / row versions / db row ids
  // for setups & parameters, and orders everything deterministically. It is the authoritative
  // resolved-content projection — reuse it wholesale.
  const content = projectReviewContent({ vm });

  const images: Record<string, SnapshotImageMeta> = {};
  for (const key of Object.keys(vm.images).sort()) {
    const img = vm.images[key];
    images[key] = {
      id: img.id,
      storageKey: opts.imageStorageKeys?.[key] ?? null,
      altText: img.altText,
      caption: img.caption,
    };
  }

  return {
    snapshotVersion: 1,
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
 * Returns the offending key paths — empty means clean.
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
