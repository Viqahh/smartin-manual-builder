/**
 * Phase 8B-8 (perf) — the ACTUAL `SupabaseManualDataSource` image-signing call site.
 *
 * The measured Builder journey used a manual with `assetIds.length === 0`, so the earlier tests
 * only covered `signManualImageUrls` + `listOrgImages`. This drives
 * `loadManualVersionByManualId` with a manual whose blocks (and a step) DO reference image assets
 * and proves the batched signing at the real call site:
 *   - N referenced asset ids → their storage keys resolved → ONE `createSignedUrls(keys, 1800)`;
 *   - never a per-key `createSignedUrl`;
 *   - `vm.images` keyed by ASSET ID, each mapped to its own signed URL;
 *   - a failed/null item affects only that asset;
 *   - 30-minute (1800 s) TTL unchanged.
 *
 * Seam: `vi.mock("server-only")` + `vi.mock("@/lib/supabase/server")` — the same seams the
 * existing `workspace-page-auth` / `list-org-images-batch` specs use. The module is not
 * redesigned for testing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const createSignedUrls = vi.fn();
const createSignedUrl = vi.fn(() => {
  throw new Error("data-source must batch — createSignedUrl (singular) must not be called");
});
const storageFrom = vi.fn(() => ({ createSignedUrls, createSignedUrl }));
const fromTables: string[] = [];

// canned rows per table; every query chain method is a no-op that returns the same builder, and
// `.single()` / `.maybeSingle()` / `await` all resolve `{ data: canned[table], error: null }`.
let canned: Record<string, unknown>;

function builderFor(table: string) {
  const resolve = () => Promise.resolve({ data: canned[table] ?? null, error: null });
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = () => b;
  b.single = resolve;
  b.maybeSingle = resolve;
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => resolve().then(res, rej);
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      fromTables.push(table);
      return builderFor(table);
    },
    storage: { from: storageFrom },
  }),
}));

const { SupabaseManualDataSource } = await import("@/features/manuals/data-source");

const block = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  block_type: "text",
  payload: {},
  position: 0,
  image_asset_id: null,
  parameter_group_ids: [],
  row_version: 1,
  deleted_at: null,
  ...over,
});

beforeEach(() => {
  fromTables.length = 0;
  createSignedUrls.mockReset();
  createSignedUrl.mockClear();
  storageFrom.mockClear();
  canned = {
    manuals: { id: "manual-1", locale: "id", ea_product_id: "eap-1", organization_id: "org-1" },
    manual_versions: {
      id: "mv-1",
      version: "1.0.0",
      status: "DRAFT",
      row_version: 1,
      updated_at: "2026-01-01T00:00:00Z",
      ea_version_id: "eav-1",
    },
    ea_products: { id: "eap-1", name: "Demo EA", slug: "demo-ea", description: "", owner_id: null },
    ea_versions: {
      id: "eav-1",
      version: "1.0.0",
      platform: "MT5",
      release_date: null,
      requirements: {},
      support: {},
    },
    organizations: { id: "org-1", name: "Org One" },
    ea_version_setups: [],
    parameter_groups: [],
    changelog_entries: [],
    manual_sections: [
      {
        id: "sec-1",
        section_key: "installation",
        title: "Instalasi",
        required: true,
        is_custom: false,
        position: 0,
        completion_state: "incomplete",
        row_version: 1,
        manual_blocks: [
          block("b-1", { block_type: "image", image_asset_id: "asset-1" }),
          block("b-2", { block_type: "image", image_asset_id: "asset-2" }),
          block("b-3", {
            block_type: "steps",
            payload: { steps: [{ imageAssetId: "asset-3" }, { imageAssetId: "asset-3" }] }, // dup on purpose
          }),
        ],
      },
    ],
    // returned in this order for `.in("id", [...])`
    image_assets: [
      { id: "asset-1", storage_key: "org-1/a1.png", alt_text: "one", caption: null },
      { id: "asset-2", storage_key: "org-1/a2.png", alt_text: null, caption: "two" },
      { id: "asset-3", storage_key: "org-1/a3.png", alt_text: "three", caption: null },
    ],
  };
});

describe("SupabaseManualDataSource — referenced-image signing (batched)", () => {
  it("signs every referenced asset in ONE createSignedUrls call at a 1800s TTL — no per-key createSignedUrl", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "org-1/a1.png", signedUrl: "u1" },
        { path: "org-1/a2.png", signedUrl: "u2" },
        { path: "org-1/a3.png", signedUrl: "u3" },
      ],
      error: null,
    });

    const vm = await new SupabaseManualDataSource("org-1").loadManualVersionByManualId("manual-1");

    expect(fromTables).toContain("image_assets"); // the descriptor fetch still happens
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(["org-1/a1.png", "org-1/a2.png", "org-1/a3.png"], 1800);
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(storageFrom).toHaveBeenCalledWith("manual-images");

    // vm.images keyed by ASSET ID, each carrying its OWN url
    expect(vm!.images).toEqual({
      "asset-1": { id: "asset-1", altText: "one", caption: null, signedUrl: "u1" },
      "asset-2": { id: "asset-2", altText: null, caption: "two", signedUrl: "u2" },
      "asset-3": { id: "asset-3", altText: "three", caption: null, signedUrl: "u3" },
    });
  });

  it("a failed/null signed item only nulls THAT asset's url", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "org-1/a1.png", signedUrl: "u1" },
        { path: "org-1/a2.png", signedUrl: null, error: { message: "missing" } },
        { path: "org-1/a3.png", signedUrl: "u3" },
      ],
      error: null,
    });

    const vm = await new SupabaseManualDataSource("org-1").loadManualVersionByManualId("manual-1");

    expect(vm!.images["asset-1"].signedUrl).toBe("u1");
    expect(vm!.images["asset-2"].signedUrl).toBeNull(); // isolated failure
    expect(vm!.images["asset-3"].signedUrl).toBe("u3");
  });

  it("a manual referencing NO image assets signs nothing", async () => {
    (canned.manual_sections as { manual_blocks: unknown[] }[])[0].manual_blocks = [block("b-1")];
    const vm = await new SupabaseManualDataSource("org-1").loadManualVersionByManualId("manual-1");
    expect(createSignedUrls).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(vm!.images).toEqual({});
  });
});
