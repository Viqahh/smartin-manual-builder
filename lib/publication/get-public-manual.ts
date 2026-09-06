import "server-only";

/**
 * Phase 7 slices 1–3 — the ONLY public read path for a published manual (AC-P7-2, AC-P7-8).
 *
 * Everything here queries EXACTLY three tables — `public_manuals` (global slug → lineage),
 * `public_manual_versions` (the version index), `published_snapshots` (the immutable frozen json) —
 * and, for the image proxy only, the private `manual-images` Storage bucket. It NEVER reads
 * `manuals` / `manual_versions` / `manual_sections` / `manual_blocks` / `image_assets` / EA /
 * review / checklist / audit tables — a published page (and its images) can never be reconstructed
 * from mutable working tables.
 *
 * `loadVerifiedPublishedSnapshot` is the shared internal boundary: it resolves + hash-verifies the
 * raw snapshot and is SERVER-ONLY. `getPublicManual` sanitises it into a `ManualViewModel` (no
 * `render_json` / `storageKey` / `content_hash` / DB id). `getPublicImageDescriptor` resolves one
 * server-only image descriptor (with its private `storageKey`) for the proxy route. Neither raw
 * result ever reaches a client component.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { computeSnapshotHash } from "@/lib/publication/snapshot";
import { snapshotToViewModel } from "@/lib/publication/snapshot-view-model";
import {
  snapshotImageDescriptors,
  type SnapshotImageDescriptor,
} from "@/lib/publication/snapshot-image";
import type { ManualViewModel } from "@/lib/manual/view-model";

export type PublicationState = "PUBLISHED" | "ARCHIVED";

/** publication-safe version row — NO organization_id / public_manual_id / snapshot id / DB uuid */
export type PublicVersion = { publicVersion: string; publishedAt: string };

export type PublicManualResult = {
  vm: ManualViewModel;
  publicationState: PublicationState;
  publishedAt: string;
  archivedAt: string | null;
  publicSlug: string;
  publicVersion: string;
  /** every still-PUBLISHED version of this lineage, newest first (publication chronology) */
  publishedVersions: PublicVersion[];
  /** newest still-PUBLISHED sibling version (for the archived "view latest" link) */
  latestPublishedVersion: string | null;
};

/** Thrown when a stored snapshot fails server-side hash re-verification — the caller maps it to a
 *  generic 500 with NO database detail. */
export class PublicSnapshotCorruptError extends Error {
  constructor(reason: string) {
    super(`published snapshot failed verification: ${reason}`);
    this.name = "PublicSnapshotCorruptError";
  }
}

/** SERVER-ONLY. The raw, hash-verified snapshot + publication metadata. Never return from here to
 *  a client component — that is what `getPublicManual` (sanitised) is for. */
export type VerifiedPublishedSnapshot = {
  renderJson: unknown;
  publicationState: PublicationState;
  publishedAt: string;
  archivedAt: string | null;
  publicSlug: string;
  publicVersion: string;
  publishedVersions: PublicVersion[];
};

/**
 * SERVER-ONLY. The minimum publication identity for the PDF-artifact layer — resolved from the
 * SAME three index tables as `loadVerifiedPublishedSnapshot`, but WITHOUT transferring or hashing
 * `render_json` (a PostgREST json-path select pulls just the EA name for the download filename).
 * `null` for an unknown / never-published route. Carries `organizationId` / `publishedSnapshotId`
 * / `contentHash` — keep it inside server modules.
 */
export type PublishedSnapshotRef = {
  publishedSnapshotId: string;
  organizationId: string;
  contentHash: string;
  publicSlug: string;
  publicVersion: string;
  publicationState: PublicationState;
  publishedAt: string;
  archivedAt: string | null;
  eaName: string;
};

export async function resolvePublishedSnapshotRef(
  slug: string,
  version: string,
): Promise<PublishedSnapshotRef | null> {
  if (!slug || !version) return null;
  const svc = createSupabaseServiceClient();

  const { data: pm } = await svc
    .from("public_manuals")
    .select("id")
    .eq("public_slug", slug)
    .maybeSingle();
  if (!pm) return null;

  const { data: pv } = await svc
    .from("public_manual_versions")
    .select("public_version, published_snapshot_id, publication_state, published_at, archived_at")
    .eq("public_manual_id", pm.id)
    .eq("public_version", version)
    .maybeSingle();
  if (!pv) return null;

  const { data: snap } = await svc
    .from("published_snapshots")
    .select("id, organization_id, content_hash, ea_name:render_json->content->eaProduct->>name")
    .eq("id", pv.published_snapshot_id)
    .maybeSingle();
  if (!snap) throw new PublicSnapshotCorruptError("snapshot row missing");

  return {
    publishedSnapshotId: snap.id as string,
    organizationId: snap.organization_id as string,
    contentHash: snap.content_hash as string,
    publicSlug: slug,
    publicVersion: pv.public_version as string,
    publicationState: pv.publication_state === "ARCHIVED" ? "ARCHIVED" : "PUBLISHED",
    publishedAt: pv.published_at as string,
    archivedAt: (pv.archived_at as string | null) ?? null,
    eaName: (snap.ea_name as string | null) || "Expert Advisor",
  };
}

/**
 * Resolve `slug` + `version` → the immutable `published_snapshots` row, re-verify its canonical
 * hash, and return the RAW json. `null` for an unknown slug / unknown version / never-published
 * route; throws `PublicSnapshotCorruptError` on a hash mismatch.
 */
export async function loadVerifiedPublishedSnapshot(
  slug: string,
  version: string,
  // Phase 8B-8 — the sibling-versions list is only used by `getPublicManual` (the reading page).
  // The image-descriptor path (`getPublicImageDescriptor`, `openPublicImageSource`) calls this
  // once per served image and never reads `publishedVersions`, so it opts out of that query.
  opts: { withPublishedVersions?: boolean } = {},
): Promise<VerifiedPublishedSnapshot | null> {
  const { withPublishedVersions = true } = opts;
  if (!slug || !version) return null;
  const svc = createSupabaseServiceClient();

  const { data: pm } = await svc
    .from("public_manuals")
    .select("id")
    .eq("public_slug", slug)
    .maybeSingle();
  if (!pm) return null;

  const { data: pv } = await svc
    .from("public_manual_versions")
    .select("public_version, published_snapshot_id, publication_state, published_at, archived_at")
    .eq("public_manual_id", pm.id)
    .eq("public_version", version)
    .maybeSingle();
  if (!pv) return null;

  const { data: snap } = await svc
    .from("published_snapshots")
    .select("render_json, content_hash")
    .eq("id", pv.published_snapshot_id)
    .maybeSingle();
  if (!snap || snap.render_json == null) {
    throw new PublicSnapshotCorruptError("snapshot row missing");
  }
  if (computeSnapshotHash(snap.render_json as Record<string, unknown>) !== snap.content_hash) {
    throw new PublicSnapshotCorruptError("hash mismatch");
  }

  const state: PublicationState = pv.publication_state === "ARCHIVED" ? "ARCHIVED" : "PUBLISHED";

  let publishedVersions: PublicVersion[] = [];
  if (withPublishedVersions) {
    const { data: pubRows } = await svc
      .from("public_manual_versions")
      .select("public_version, published_at")
      .eq("public_manual_id", pm.id)
      .eq("publication_state", "PUBLISHED")
      .order("published_at", { ascending: false });
    publishedVersions = (pubRows ?? []).map((r) => ({
      publicVersion: r.public_version as string,
      publishedAt: r.published_at as string,
    }));
  }

  return {
    renderJson: snap.render_json,
    publicationState: state,
    publishedAt: pv.published_at,
    archivedAt: pv.archived_at ?? null,
    publicSlug: slug,
    publicVersion: pv.public_version,
    publishedVersions,
  };
}

export async function getPublicManual(
  slug: string,
  version: string,
): Promise<PublicManualResult | null> {
  const verified = await loadVerifiedPublishedSnapshot(slug, version);
  if (!verified) return null;

  const vm = snapshotToViewModel(verified.renderJson, {
    slug: verified.publicSlug,
    version: verified.publicVersion,
    status: verified.publicationState,
  });

  return {
    vm,
    publicationState: verified.publicationState,
    publishedAt: verified.publishedAt,
    archivedAt: verified.archivedAt,
    publicSlug: verified.publicSlug,
    publicVersion: verified.publicVersion,
    publishedVersions: verified.publishedVersions,
    latestPublishedVersion: verified.publishedVersions[0]?.publicVersion ?? null,
  };
}

/**
 * SERVER-ONLY. Resolve one publication image by its deterministic index. Returns `null` for an
 * unknown publication OR an out-of-range index — the image route never touches Storage in either
 * case. The returned descriptor carries the private `storageKey`; keep it inside server modules.
 */
export async function getPublicImageDescriptor(
  slug: string,
  version: string,
  idx: number,
): Promise<SnapshotImageDescriptor | null> {
  const verified = await loadVerifiedPublishedSnapshot(slug, version, { withPublishedVersions: false });
  if (!verified) return null;
  const descriptors = snapshotImageDescriptors(verified.renderJson);
  if (!Number.isInteger(idx) || idx < 0 || idx >= descriptors.length) return null;
  return descriptors[idx];
}
