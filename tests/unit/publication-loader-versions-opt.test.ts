/**
 * Phase 8B-8 (perf) — `loadVerifiedPublishedSnapshot` gained a `{ withPublishedVersions }` option.
 * The published-image paths (`getPublicImageDescriptor`, `openPublicImageSource`) call it once PER
 * served image and never read the sibling-versions list, so they now pass `false` and skip that
 * `public_manual_versions` query. The reading page (`getPublicManual`) still needs it.
 *
 * These tests prove:
 *   1. `getPublicManual` still returns published-version metadata (option defaults to true);
 *   2. `getPublicImageDescriptor` resolves WITHOUT the sibling-versions query (one
 *      `public_manual_versions` read, not two);
 *   3. skipping that query does NOT weaken publication-state resolution or snapshot hash
 *      verification — both behave identically with the option on or off.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/publication/snapshot", () => ({
  computeSnapshotHash: (json: Record<string, unknown>) => (json as { __hash?: string }).__hash ?? "NO_HASH",
}));
vi.mock("@/lib/publication/snapshot-view-model", () => ({
  snapshotToViewModel: () => ({ eaProduct: { name: "Demo EA" }, sections: [] }),
}));
vi.mock("@/lib/publication/snapshot-image", () => ({
  snapshotImageDescriptors: () => [
    { storageKey: "org/shot-0.png" },
    { storageKey: "org/shot-1.png" },
  ],
}));

// --- fake service client -----------------------------------------------------
type Canned = {
  publicManual: unknown;
  version: unknown; // the .maybeSingle() version row
  versionList: unknown[]; // the .order() sibling-versions list
  snapshot: unknown; // the published_snapshots row
};
let canned: Canned;
const fromCalls: string[] = [];

function serviceClient() {
  return {
    from(table: string) {
      fromCalls.push(table);
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.order = () => Promise.resolve({ data: canned.versionList, error: null });
      builder.maybeSingle = () => {
        if (table === "public_manuals") return Promise.resolve({ data: canned.publicManual, error: null });
        if (table === "public_manual_versions") return Promise.resolve({ data: canned.version, error: null });
        if (table === "published_snapshots") return Promise.resolve({ data: canned.snapshot, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => serviceClient() }));

const { loadVerifiedPublishedSnapshot, getPublicManual, getPublicImageDescriptor, PublicSnapshotCorruptError } =
  await import("@/lib/publication/get-public-manual");

beforeEach(() => {
  fromCalls.length = 0;
  canned = {
    publicManual: { id: "pm-1" },
    version: {
      public_version: "2.0.0",
      published_snapshot_id: "snap-1",
      publication_state: "PUBLISHED",
      published_at: "2026-02-01T00:00:00Z",
      archived_at: null,
    },
    versionList: [
      { public_version: "2.0.0", published_at: "2026-02-01T00:00:00Z" },
      { public_version: "1.0.0", published_at: "2026-01-01T00:00:00Z" },
    ],
    snapshot: { render_json: { __hash: "HASH_OK" }, content_hash: "HASH_OK" },
  };
});

describe("loadVerifiedPublishedSnapshot — withPublishedVersions option", () => {
  it("default: reads the sibling-versions list (two public_manual_versions queries)", async () => {
    const v = await loadVerifiedPublishedSnapshot("slug", "2.0.0");
    expect(v?.publishedVersions).toEqual([
      { publicVersion: "2.0.0", publishedAt: "2026-02-01T00:00:00Z" },
      { publicVersion: "1.0.0", publishedAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(fromCalls).toEqual(["public_manuals", "public_manual_versions", "published_snapshots", "public_manual_versions"]);
  });

  it("withPublishedVersions:false — skips the list query entirely (one public_manual_versions query)", async () => {
    const v = await loadVerifiedPublishedSnapshot("slug", "2.0.0", { withPublishedVersions: false });
    expect(v?.publishedVersions).toEqual([]);
    expect(fromCalls).toEqual(["public_manuals", "public_manual_versions", "published_snapshots"]);
    expect(fromCalls.filter((t) => t === "public_manual_versions")).toHaveLength(1);
  });

  it("publication-state resolution is unchanged by the option (ARCHIVED still resolves)", async () => {
    canned.version = { ...(canned.version as object), publication_state: "ARCHIVED", archived_at: "2026-03-01T00:00:00Z" };
    const withList = await loadVerifiedPublishedSnapshot("slug", "2.0.0");
    const withoutList = await loadVerifiedPublishedSnapshot("slug", "2.0.0", { withPublishedVersions: false });
    expect(withList?.publicationState).toBe("ARCHIVED");
    expect(withoutList?.publicationState).toBe("ARCHIVED");
    expect(withoutList?.archivedAt).toBe("2026-03-01T00:00:00Z");
  });

  it("snapshot hash verification still fires with the option OFF", async () => {
    canned.snapshot = { render_json: { __hash: "REAL" }, content_hash: "TAMPERED" };
    await expect(loadVerifiedPublishedSnapshot("slug", "2.0.0", { withPublishedVersions: false })).rejects.toBeInstanceOf(
      PublicSnapshotCorruptError,
    );
  });

  it("a missing snapshot row still throws with the option OFF", async () => {
    canned.snapshot = null;
    await expect(loadVerifiedPublishedSnapshot("slug", "2.0.0", { withPublishedVersions: false })).rejects.toBeInstanceOf(
      PublicSnapshotCorruptError,
    );
  });
});

describe("callers wire the option correctly", () => {
  it("getPublicManual keeps the sibling-versions list (default true)", async () => {
    const res = await getPublicManual("slug", "2.0.0");
    expect(res?.publishedVersions.map((v) => v.publicVersion)).toEqual(["2.0.0", "1.0.0"]);
    expect(res?.latestPublishedVersion).toBe("2.0.0");
    expect(fromCalls.filter((t) => t === "public_manual_versions")).toHaveLength(2);
  });

  it("getPublicImageDescriptor resolves an image WITHOUT the sibling-versions query", async () => {
    const d = await getPublicImageDescriptor("slug", "2.0.0", 1);
    expect(d).toEqual({ storageKey: "org/shot-1.png" });
    expect(fromCalls.filter((t) => t === "public_manual_versions")).toHaveLength(1);
  });

  it("getPublicImageDescriptor still enforces hash verification", async () => {
    canned.snapshot = { render_json: { __hash: "REAL" }, content_hash: "TAMPERED" };
    await expect(getPublicImageDescriptor("slug", "2.0.0", 0)).rejects.toBeInstanceOf(PublicSnapshotCorruptError);
  });
});
