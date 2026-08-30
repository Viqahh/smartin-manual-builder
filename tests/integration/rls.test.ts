/**
 * LIVE Supabase integration suite (spec §9, AC-P2-21). BLOCKED BY EXTERNAL CREDENTIALS in this
 * environment — the schema has not been applied to any project — so every group is skipped via
 * `describe.skipIf(...)` on ALL of its prerequisites. No test silently `return`s.
 *
 * Prerequisites (docs/PHASE_2.md §14):
 *   SUPABASE_TEST_URL        project URL
 *   SUPABASE_TEST_ANON_KEY   sb_publishable_ / anon key
 *   SUPABASE_SECRET_KEY      sb_secret_ / service-role key   (groups that need a raw-DDL fixture)
 * ...and `supabase/migrations` + `supabase/seed.sql` applied.
 *
 * Seeded identities (supabase/seed.sql), password "demo-password-123":
 *   developer@smartin.demo   DEVELOPER + TECHNICAL_REVIEWER   org A  (multi-role fixture)
 *   admin@smartin.demo       ADMIN                            org A
 *   reviewer@smartin.demo    TECHNICAL_REVIEWER               org A
 *   compliance@smartin.demo  COMPLIANCE_REVIEWER              org A
 *   outsider@smartin.demo    ADMIN                            org B
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { REVIEW_QUEUE_STATUS } from "@/features/reviews/queue-contract";
import { computeSnapshotHash } from "@/lib/publication/snapshot";
import { snapshotImageDescriptors, mimeForStorageKey } from "@/lib/publication/snapshot-image";
import { snapshotToViewModel } from "@/lib/publication/snapshot-view-model";
import { createHash } from "node:crypto";

const URL = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;

// node 20's global fetch (undici) can wedge a pooled connection after a PL/pgSQL RAISE, leaving a
// later request hanging with no timeout — vitest's per-test timeout then can't abort it. Bound
// every Supabase HTTP call so a stuck request rejects instead of stalling the whole run.
const boundFetch: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(25_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input as RequestInfo, { ...(init ?? {}), signal });
};

const HAS_API = Boolean(URL && ANON);
const HAS_SERVICE = Boolean(URL && ANON && SECRET);

const PW = "demo-password-123";
const ORG_A = "a0000000-0000-4000-8000-00000000000a";
const ORG_B = "b0000000-0000-4000-8000-00000000000b";
const VMAX_PRODUCT = "d0000000-0000-4000-8000-00000000000d";
const VMAX_EA_VERSION = "e0000000-0000-4000-8000-00000000000e";
const VMAX_MV = "20000000-0000-4000-8000-000000000020";
const VMAX_GROUP = "f0000000-0000-4000-8000-00000000000f";
const SYSTEM_TEMPLATE = "a1a1a1a1-1111-4111-8111-000000000001";

// 1x1 transparent PNG
const PNG_1x1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

// 1x1 transparent GIF89a — a distinct second object (different bytes AND different MIME)
const GIF_1x1 = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);
const sha256 = (u8: Uint8Array) => createHash("sha256").update(u8).digest("hex");

// Memoised per email: one authenticated client per identity for the whole process. The suite
// otherwise issues ~27 sign-ins per run, and two back-to-back runs trip Supabase Auth's
// per-IP rate limit for /token (causing supabase-js to retry-with-backoff and stall). Tests
// only READ with these clients (no signOut / setSession — asserted), so sharing is safe.
const _clients = new Map<string, Promise<SupabaseClient>>();
async function signIn(email: string): Promise<SupabaseClient> {
  let p = _clients.get(email);
  if (!p) {
    p = (async () => {
      const c = createClient(URL!, ANON!, { global: { fetch: boundFetch } });
      const { error } = await c.auth.signInWithPassword({ email, password: PW });
      if (error) throw error;
      return c;
    })();
    _clients.set(email, p);
  }
  return p;
}
const service = () => createClient(URL!, SECRET!, { auth: { persistSession: false }, global: { fetch: boundFetch } });

const ALL_MUTATING_RPCS: [string, Record<string, unknown>][] = [
  ["create_ea_version_with_setups", {
    p_org: ORG_A, p_ea_product_id: VMAX_PRODUCT, p_version: "9.9.9", p_platform: "MT5",
    p_release_date: "2026-01-01", p_requirements: {}, p_support: {},
    p_setups: [{ symbol: "XAUUSD", timeframe: "M15", position: 0 }], p_copy_params_from: null,
  }],
  ["replace_ea_version_setups", {
    p_org: ORG_A, p_ea_version_id: VMAX_EA_VERSION,
    p_setups: [{ symbol: "EURUSD", timeframe: "H1", position: 0 }],
  }],
  ["create_manual_with_version", {
    p_org: ORG_A, p_ea_product_id: VMAX_PRODUCT, p_ea_version_id: VMAX_EA_VERSION,
    p_manual_version: "9.9.9", p_template_id: SYSTEM_TEMPLATE, p_locale: "id",
  }],
  ["create_product_version_manual", {
    p_org: ORG_A, p_owner: "11111111-1111-4111-8111-111111111111", p_product_name: "X", p_product_slug: "x-attack",
    p_product_description: "", p_version: "1.0.0", p_platform: "MT5", p_release_date: "2026-01-01",
    p_requirements: {}, p_support: {}, p_setups: [{ symbol: "XAUUSD", timeframe: "M15", position: 0 }],
    p_manual_version: "1.0.0", p_template_id: SYSTEM_TEMPLATE, p_locale: "id",
  }],
  ["reorder_manual_blocks", { p_section_id: VMAX_MV, p_ordered_ids: [] }],
  ["reorder_parameter_groups", { p_ea_version_id: VMAX_EA_VERSION, p_ordered_ids: [VMAX_GROUP] }],
  ["reorder_ea_parameters", { p_group_id: VMAX_GROUP, p_ordered_ids: [] }],
];

// ---------------------------------------------------------------------------
describe.skipIf(!HAS_API)("Finding 1 — anonymous client cannot invoke ANY mutating RPC", () => {
  it("every mutating public RPC is denied to an unauthenticated (anon) caller", async () => {
    const anon = createClient(URL!, ANON!, { global: { fetch: boundFetch } }); // no sign-in
    for (const [name, args] of ALL_MUTATING_RPCS) {
      const { error } = await anon.rpc(name, args);
      expect(error, `${name} should reject an anonymous caller`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!HAS_API)("Finding 4 — reviewer roles are read-only for content; cannot invoke create RPCs", () => {
  let technical: SupabaseClient;
  let compliance: SupabaseClient;

  beforeAll(async () => {
    technical = await signIn("reviewer@smartin.demo");
    compliance = await signIn("compliance@smartin.demo");
  });

  it("both reviewers CAN read manual content", async () => {
    for (const c of [technical, compliance]) {
      const { data } = await c.from("manual_sections").select("id").eq("manual_version_id", VMAX_MV);
      expect((data ?? []).length).toBeGreaterThan(0);
    }
  });

  it("neither reviewer can UPDATE manual_sections directly", async () => {
    for (const c of [technical, compliance]) {
      const { data } = await c.from("manual_sections").update({ title: "x" }).eq("manual_version_id", VMAX_MV).select("id");
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("neither reviewer can INSERT/UPDATE ea_parameters directly", async () => {
    for (const c of [technical, compliance]) {
      const ins = await c.from("ea_parameters").insert({
        organization_id: ORG_A, parameter_group_id: VMAX_GROUP, display_name: "x",
        technical_name: "Sneaky", param_type: "int", position: 99,
      });
      expect(ins.error).toBeTruthy();
      const upd = await c.from("ea_parameters").update({ default_value: "9" }).eq("parameter_group_id", VMAX_GROUP).select("id");
      expect(upd.data ?? []).toHaveLength(0);
    }
  });

  it("neither reviewer can invoke create_ea_version_with_setups / create_manual_with_version / create_product_version_manual", async () => {
    for (const c of [technical, compliance]) {
      for (const name of ["create_ea_version_with_setups", "create_manual_with_version", "create_product_version_manual"]) {
        const args = ALL_MUTATING_RPCS.find(([n]) => n === name)![1];
        const { error } = await c.rpc(name, args);
        expect(error, `${name} should reject a reviewer`).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!HAS_API)("Finding 4 — DEVELOPER cannot perform admin-only mutations", () => {
  let dev: SupabaseClient;
  beforeAll(async () => {
    dev = await signIn("developer@smartin.demo");
  });

  it("DEVELOPER cannot insert a membership", async () => {
    const { error } = await dev.from("memberships").insert({
      organization_id: ORG_A, user_id: "11111111-1111-4111-8111-111111111111", role: "ADMIN",
    });
    expect(error).toBeTruthy();
  });

  it("DEVELOPER cannot write a template section", async () => {
    const { error } = await dev.from("manual_template_sections").insert({
      template_id: SYSTEM_TEMPLATE, section_key: "sneaky", title: "x", position: 99,
    });
    expect(error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!HAS_API)("Finding 8 — multi-role fixture (DEVELOPER + TECHNICAL_REVIEWER)", () => {
  let dev: SupabaseClient;
  beforeAll(async () => {
    dev = await signIn("developer@smartin.demo");
  });

  it("roles aggregate: the user holds both roles in org A", async () => {
    const { data: authData, error: authError } = await dev.auth.getUser();

expect(authError).toBeNull();
expect(authData.user).toBeTruthy();

const { data, error } = await dev
  .from("memberships")
  .select("role")
  .eq("organization_id", ORG_A)
  .eq("user_id", authData.user!.id);

expect(error).toBeNull();

const roles = new Set((data ?? []).map((r) => r.role));
    expect(roles.has("DEVELOPER")).toBe(true);
    expect(roles.has("TECHNICAL_REVIEWER")).toBe(true);
    expect(roles.has("ADMIN")).toBe(false);
  });

  it("author capability is retained (can create an EA product)", async () => {
    const { data, error } = await dev
      .from("ea_products")
      .insert({ organization_id: ORG_A, name: "Multirole Probe", slug: "multirole-probe" })
      .select("id")
      .single();
    expect(error).toBeNull();
    if (data) {
      const del = await service().from("ea_products").delete().eq("id", data.id).select("id");
      expect(del.error, "cleanup: delete probe ea_product").toBeNull();
    }
  });

  it("admin capability is NOT gained (cannot insert a membership)", async () => {
    const { error } = await dev.from("memberships").insert({
      organization_id: ORG_A, user_id: "33333333-3333-4333-8333-333333333333", role: "ADMIN",
    });
    expect(error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!HAS_API)("cross-org isolation (spec §27, AC-P2-21)", () => {
  let outsider: SupabaseClient;
  let dev: SupabaseClient;
  beforeAll(async () => {
    outsider = await signIn("outsider@smartin.demo");
    dev = await signIn("developer@smartin.demo");
  });

  it("org B user reads none of org A's content", async () => {
    for (const t of [
      "ea_products", "ea_versions", "ea_version_setups", "parameter_groups", "ea_parameters",
      "manuals", "manual_versions", "manual_sections", "manual_blocks", "image_assets",
    ]) {
      const { data } = await outsider.from(t).select("id").eq("organization_id", ORG_A);
      expect(data ?? [], t).toHaveLength(0);
    }
  });

  it("org B user cannot mutate org A's EA product", async () => {
    await outsider.from("ea_products").update({ description: "hijacked" }).eq("id", VMAX_PRODUCT).select("id");
    const { data } = await dev.from("ea_products").select("description").eq("id", VMAX_PRODUCT).single();
    expect(data?.description).not.toBe("hijacked");
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!HAS_API)("Finding 2 — same-org relational integrity (composite FKs)", () => {
  let devA: SupabaseClient;
  let bProductId: string | null = null;
  let bVersionId: string | null = null;

  beforeAll(async () => {
    devA = await signIn("developer@smartin.demo");

    const suffix = crypto.randomUUID().slice(0, 8);

    const p = await service()
      .from("ea_products")
      .insert({
        organization_id: ORG_B,
        name: `B Product ${suffix}`,
        slug: `b-product-int-${suffix}`,
      })
      .select("id")
      .single();

    if (p.error || !p.data) {
      throw new Error(
        `Failed to create Org B product fixture: ${p.error?.message ?? "no data"}`
      );
    }

    bProductId = p.data.id;

    const v = await service()
      .from("ea_versions")
      .insert({
        organization_id: ORG_B,
        ea_product_id: bProductId,
        version: "1.0.0",
        platform: "MT5",
      })
      .select("id")
      .single();

    if (v.error || !v.data) {
      throw new Error(
        `Failed to create Org B version fixture: ${v.error?.message ?? "no data"}`
      );
    }

    bVersionId = v.data.id;
  });

  afterAll(async () => {
    if (bProductId) {
      const del = await service().from("ea_products").delete().eq("id", bProductId).select("id");
      expect(del.error, "cleanup: delete Org B ea_product").toBeNull();
    }
  });

  it("Org A developer cannot insert an ea_version (org=A) that references an Org B product UUID", async () => {
    expect(bProductId).toBeTruthy();

    const { error } = await devA.from("ea_versions").insert({
      organization_id: ORG_A,
      ea_product_id: bProductId!,
      version: "2.0.0",
      platform: "MT5",
    });

    expect(error).toBeTruthy();
  });

  it("Org A developer cannot insert a parameter_group (org=A) referencing an Org B ea_version UUID", async () => {
    expect(bVersionId).toBeTruthy();

    const { error } = await devA.from("parameter_groups").insert({
      organization_id: ORG_A,
      ea_version_id: bVersionId!,
      name: "x",
      position: 0,
    });

    expect(error).toBeTruthy();
  });

  it("cannot UPDATE an Org A ea_version to point at an Org B product", async () => {
    expect(bProductId).toBeTruthy();

    const { data } = await devA
      .from("ea_versions")
      .update({ ea_product_id: bProductId! })
      .eq("id", VMAX_EA_VERSION)
      .select("id");

    expect(data ?? []).toHaveLength(0);

    const { data: check } = await service()
      .from("ea_versions")
      .select("ea_product_id")
      .eq("id", VMAX_EA_VERSION)
      .single();

    expect(check?.ea_product_id).toBe(VMAX_PRODUCT);
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!HAS_SERVICE)("Finding 5 — cross-org copy_parameter_definitions attack", () => {
  let outsider: SupabaseClient;
  let bProductId: string | null = null;

  beforeAll(async () => {
    outsider = await signIn("outsider@smartin.demo");

    const suffix = crypto.randomUUID().slice(0, 8);

    const p = await service()
      .from("ea_products")
      .insert({
        organization_id: ORG_B,
        name: `B Copy Target ${suffix}`,
        slug: `b-copy-target-${suffix}`,
      })
      .select("id")
      .single();

    if (p.error || !p.data) {
      throw new Error(
        `Failed to create copy target fixture: ${p.error?.message ?? "no data"}`
      );
    }

    bProductId = p.data.id;
  });

  afterAll(async () => {
    if (bProductId) {
      const del = await service().from("ea_products").delete().eq("id", bProductId).select("id");
      expect(del.error, "cleanup: delete Org B ea_product").toBeNull();
    }
  });

  it("Org B admin cannot create a B EA version that copies parameter definitions from an Org A EA version", async () => {
    expect(bProductId).toBeTruthy();

    const { error } = await outsider.rpc("create_ea_version_with_setups", {
      p_org: ORG_B,
      p_ea_product_id: bProductId!,
      p_version: "1.2.3",
      p_platform: "MT5",
      p_release_date: "2026-01-01",
      p_requirements: {},
      p_support: {},
      p_setups: [
        {
          symbol: "XAUUSD",
          timeframe: "M15",
          position: 0,
        },
      ],
      p_copy_params_from: VMAX_EA_VERSION,
    });

    expect(error).toBeTruthy();

    const { data: versions } = await service()
      .from("ea_versions")
      .select("id")
      .eq("ea_product_id", bProductId!)
      .eq("version", "1.2.3");

    expect(versions ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!HAS_SERVICE)("Finding 6 — reorder RPCs reject malformed id lists and roll back", () => {
  const svc = () => service();
  let sectionId: string;
  const ids: string[] = [];

  beforeAll(async () => {
    const s = await svc().from("manual_sections").select("id").eq("manual_version_id", VMAX_MV).eq("section_key", "overview").single();
    sectionId = s.data!.id;
    for (let i = 0; i < 3; i++) {
      const b = await svc().from("manual_blocks").insert({
        organization_id: ORG_A, manual_section_id: sectionId, block_type: "text",
        payload: { type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: [`p${i}`] } },
        position: i,
      }).select("id").single();
      ids.push(b.data!.id);
    }
  });

  const currentOrder = async () => {
    const { data } = await svc().from("manual_blocks").select("id").eq("manual_section_id", sectionId).is("deleted_at", null).order("position");
    return (data ?? []).map((r) => r.id as string);
  };

  it("rejects a duplicated id, an omitted id, a foreign id, and an extra id — order preserved each time", async () => {
    const foreign = "00000000-0000-4000-8000-0000000000ff";
    for (const bad of [
      [ids[0], ids[0], ids[1]], // duplicate
      [ids[0], ids[1]], // omitted
      [ids[0], ids[1], foreign], // foreign
      [ids[0], ids[1], ids[2], foreign], // extra
    ]) {
      const before = await currentOrder();
      const { error } = await svc().rpc("reorder_manual_blocks", { p_section_id: sectionId, p_ordered_ids: bad });
      expect(error, JSON.stringify(bad)).toBeTruthy();
      expect(await currentOrder(), "order must be unchanged after a rejected reorder").toEqual(before);
    }
  });

  it("accepts a valid permutation", async () => {
    const rev = [ids[2], ids[0], ids[1]];
    const { error } = await svc().rpc("reorder_manual_blocks", { p_section_id: sectionId, p_ordered_ids: rev });
    expect(error).toBeNull();
    expect(await currentOrder()).toEqual(rev);
  });

  it("cleanup", async () => {
    const del = await svc().from("manual_blocks").delete().in("id", ids).select("id");
    expect(del.error, "cleanup: delete reorder-fixture blocks").toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!HAS_SERVICE)("Finding 5 — block CRUD round-trip (AC-P2-15/16/17)", () => {
  const svc = () => service();
  let sectionId: string;

  beforeAll(async () => {
    const s = await svc().from("manual_sections").select("id").eq("manual_version_id", VMAX_MV).eq("section_key", "faq").single();
    sectionId = s.data!.id;
  });

  it("create -> update -> reorder -> soft-delete -> restore", async () => {
    const doc = (p: string) => ({ type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: [p] } });
    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const b = await svc().from("manual_blocks").insert({
        organization_id: ORG_A, manual_section_id: sectionId, block_type: "text", payload: doc(`b${i}`), position: i,
      }).select("id, row_version").single();
      created.push(b.data!.id);
    }
    // update (row_version bumps)
    const before = await svc().from("manual_blocks").select("row_version").eq("id", created[0]).single();
    await svc().from("manual_blocks").update({ payload: doc("edited") }).eq("id", created[0]);
    const after = await svc().from("manual_blocks").select("row_version, payload").eq("id", created[0]).single();
    expect(Number(after.data!.row_version)).toBeGreaterThan(Number(before.data!.row_version));

    // transactional reorder
    const rev = [created[2], created[1], created[0]];
    await svc().rpc("reorder_manual_blocks", { p_section_id: sectionId, p_ordered_ids: rev });
    const ordered = await svc().from("manual_blocks").select("id, position").eq("manual_section_id", sectionId).is("deleted_at", null).order("position");
    expect((ordered.data ?? []).map((r) => r.id)).toEqual(rev);
    expect((ordered.data ?? []).map((r) => r.position)).toEqual([0, 1, 2]);

    // soft delete + restore
    await svc().from("manual_blocks").update({ deleted_at: new Date().toISOString() }).eq("id", created[0]);
    let live = await svc().from("manual_blocks").select("id").eq("manual_section_id", sectionId).is("deleted_at", null);
    expect((live.data ?? []).length).toBe(2);
    await svc().from("manual_blocks").update({ deleted_at: null, position: 99 }).eq("id", created[0]);
    live = await svc().from("manual_blocks").select("id").eq("manual_section_id", sectionId).is("deleted_at", null);
    expect((live.data ?? []).length).toBe(3);

    const cl = await svc().from("manual_blocks").delete().in("id", created).select("id");
    expect(cl.error, "cleanup: delete block-CRUD fixture blocks").toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!HAS_SERVICE)("private image access (AC-P2-19)", () => {
  const svc = () => service();
  let assetId: string;
  let storageKey: string;
  let devA: SupabaseClient;
  let outsider: SupabaseClient;

  beforeAll(async () => {
    devA = await signIn("developer@smartin.demo");
    outsider = await signIn("outsider@smartin.demo");
    assetId = crypto.randomUUID();
    storageKey = `${ORG_A}/${assetId}.png`;
    await svc().from("image_assets").insert({
      id: assetId, organization_id: ORG_A, storage_key: storageKey,
      mime_type: "image/png", byte_size: PNG_1x1.byteLength, width: 1, height: 1, scan_status: "pending",
    });
    await svc().storage.from("manual-images").upload(storageKey, PNG_1x1, { contentType: "image/png", upsert: true });
  });

  it("a member of the owning org can sign a URL", async () => {
    const { data, error } = await devA.storage.from("manual-images").createSignedUrl(storageKey, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();
  });

  it("a member of another org cannot sign a URL", async () => {
    const { error } = await outsider.storage.from("manual-images").createSignedUrl(storageKey, 60);
    expect(error).toBeTruthy();
  });

  it("the object is not publicly reachable without a signed URL", async () => {
    const pub = svc().storage.from("manual-images").getPublicUrl(storageKey).data.publicUrl;
    const res = await fetch(pub);
    expect(res.ok).toBe(false); // private bucket
  });

  it("a signed URL expires", async () => {
    const { data } = await devA.storage.from("manual-images").createSignedUrl(storageKey, 1);
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(data!.signedUrl);
    expect(res.ok).toBe(false);
  });

  it("cleanup", async () => {
    await svc().storage.from("manual-images").remove([storageKey]);
    const del = await svc().from("image_assets").delete().eq("id", assetId).select("id");
    expect(del.error, "cleanup: delete private-image fixture asset").toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!HAS_SERVICE)("template instantiation records template_id + version (finding 3, AC-P2-26)", () => {
  it("create_manual_with_version instantiates exactly the template's section set and records both", async () => {
    const svc = service();
    const { data } = await svc.rpc("create_manual_with_version", {
      p_org: ORG_A, p_ea_product_id: VMAX_PRODUCT, p_ea_version_id: VMAX_EA_VERSION,
      p_manual_version: "7.7.7", p_template_id: SYSTEM_TEMPLATE, p_locale: "id",
    });
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.template_version).toBe(1);

    const mv = await svc.from("manual_versions").select("template_id, template_version").eq("id", row.manual_version_id).single();
    expect(mv.data!.template_id).toBe(SYSTEM_TEMPLATE);
    expect(mv.data!.template_version).toBe(1);

    const tplSecs = await svc.from("manual_template_sections").select("section_key").eq("template_id", SYSTEM_TEMPLATE);
    const mvSecs = await svc.from("manual_sections").select("section_key").eq("manual_version_id", row.manual_version_id);
    expect(new Set((mvSecs.data ?? []).map((s) => s.section_key))).toEqual(new Set((tplSecs.data ?? []).map((s) => s.section_key)));

    const cl = await svc.from("manuals").delete().eq("id", row.manual_id).select("id");
    expect(cl.error, "cleanup: delete template-instantiation fixture manual").toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!HAS_SERVICE)("parameter ownership propagation (AC-P2-18b)", () => {
  it("editing an ea_parameter is visible to every manual version linked to that EA version", async () => {
    const svc = service();
    const { data } = await svc.rpc("create_manual_with_version", {
      p_org: ORG_A, p_ea_product_id: VMAX_PRODUCT, p_ea_version_id: VMAX_EA_VERSION,
      p_manual_version: "1.0.1", p_template_id: SYSTEM_TEMPLATE, p_locale: "id",
    });
    const row = Array.isArray(data) ? data[0] : data;
    await svc.from("ea_parameters").update({ default_value: "0.02" }).eq("parameter_group_id", VMAX_GROUP).eq("technical_name", "FixedLot");

    const p = await svc.from("ea_parameters").select("default_value").eq("parameter_group_id", VMAX_GROUP).eq("technical_name", "FixedLot").single();
    expect(p.data!.default_value).toBe("0.02"); // one row, shared by MV 1.0.0 and 1.0.1 — no per-manual copy

    const cl = await svc.from("manuals").delete().eq("id", row.manual_id).select("id");
    expect(cl.error, "cleanup: delete param-propagation fixture manual").toBeNull();
    await svc.from("ea_parameters").update({ default_value: "0.01" }).eq("parameter_group_id", VMAX_GROUP).eq("technical_name", "FixedLot");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — document editor server behaviour.
//
// Both groups are FULLY SELF-CONTAINED: they build their own fixtures with
// randomised names, assert every setup step explicitly (error === null AND
// data truthy) before dereferencing anything, verify behaviour from the DB,
// and clean up everything they created in an afterAll — even if an assertion
// throws. They never depend on rows from another group or on execution order.
// ---------------------------------------------------------------------------

const rnd = () => Math.random().toString(36).slice(2, 10);

/** Assert a Supabase result succeeded, then return its (non-null) data. */
function must<T>(res: { data: T | null; error: unknown }, label: string): T {
  expect(res.error, `${label}: expected no error`).toBeNull();
  expect(res.data, `${label}: expected data`).toBeTruthy();
  return res.data as T;
}

describe.skipIf(!HAS_SERVICE)("Phase 3 — chapter management (AC-P3-5 / AC-P3-6)", () => {
  const createdManualIds: string[] = [];

  afterAll(async () => {
    if (!HAS_SERVICE) return;
    const svc = service();
    for (const id of createdManualIds) {
      const del = await svc.from("manuals").delete().eq("id", id).select("id");
      expect(del.error, `cleanup: delete chapter-mgmt fixture manual ${id}`).toBeNull();
    }
  });

  it("custom chapter: add -> reorder (RPC) -> rename; canonical rename & required delete denied; delete", async () => {
    const svc = service();

    // --- fixture: our own fresh Manual on the seed VMax EA Version (valid semver -> no collision) ---
    const mk = await svc.rpc("create_manual_with_version", {
      p_org: ORG_A,
      p_ea_product_id: VMAX_PRODUCT,
      p_ea_version_id: VMAX_EA_VERSION,
      p_manual_version: "1.0.0",
      p_template_id: SYSTEM_TEMPLATE,
      p_locale: "id",
    });
    expect(mk.error, "create_manual_with_version").toBeNull();
    const mkRow = (Array.isArray(mk.data) ? mk.data[0] : mk.data) as
      | { manual_id: string; manual_version_id: string }
      | null
      | undefined;
    expect(mkRow, "create_manual_with_version returned a row").toBeTruthy();
    const manualId = mkRow!.manual_id;
    const mvId = mkRow!.manual_version_id;
    expect(mvId, "manual_version_id").toBeTruthy();
    createdManualIds.push(manualId);

    // sections were instantiated from the system template
    const baseSecs = must(
      await svc
        .from("manual_sections")
        .select("id, section_key, position, is_custom, required")
        .eq("manual_version_id", mvId)
        .order("position"),
      "load instantiated sections",
    ) as { id: string; section_key: string; position: number; is_custom: boolean; required: boolean }[];
    expect(baseSecs.length).toBeGreaterThan(10);
    expect(baseSecs.some((s) => s.section_key === "cover" && s.required && !s.is_custom)).toBe(true);

    // --- add a custom chapter (author-path insert; RLS allows can_author) ---
    const custom = must(
      await svc
        .from("manual_sections")
        .insert({
          organization_id: ORG_A,
          manual_version_id: mvId,
          section_key: `custom-${rnd()}`,
          title: `Bab Kustom ${rnd()}`,
          required: false,
          is_custom: true,
          position: Math.max(...baseSecs.map((s) => s.position)) + 1,
        })
        .select("id, position")
        .single(),
      "insert custom chapter",
    ) as { id: string; position: number };

    // --- reorder via the DEPLOYED Phase 3 RPC (fails loudly if migration 800 is not on this project) ---
    const ordered = must(
      await svc.from("manual_sections").select("id").eq("manual_version_id", mvId).order("position"),
      "load sections incl. custom",
    ) as { id: string }[];
    const ids = ordered.map((s) => s.id);
    const target = [ids[0], ids[ids.length - 1], ...ids.slice(1, -1)]; // move the custom chapter to index 1
    const re = await svc.rpc("reorder_manual_sections", { p_manual_version_id: mvId, p_ordered_ids: target });
    if (re.error) {
      const err = re.error as { code?: string; message?: string };
      const msg = String(err.message ?? re.error);
      if (err.code === "PGRST202" || /reorder_manual_sections|schema cache|could not find|does not exist/i.test(msg)) {
        expect.fail(
          "reorder_manual_sections RPC is NOT deployed to this project. Apply " +
            "supabase/migrations/20260901000800_phase3_section_management.sql to Supabase DEV. " +
            `(${msg})`,
        );
      }
    }
    expect(re.error, "reorder_manual_sections").toBeNull();

    // verify persistence from the DB: positions contiguous 0..n-1, order == requested
    const after = must(
      await svc.from("manual_sections").select("id, position").eq("manual_version_id", mvId).order("position"),
      "reload sections after reorder",
    ) as { id: string; position: number }[];
    expect(after.map((s) => s.position)).toEqual([...Array(after.length).keys()]);
    expect(after.map((s) => s.id)).toEqual(target);

    // --- rename the custom chapter (allowed) ---
    const renamed = must(
      await svc.from("manual_sections").update({ title: "Bab Kustom v2" }).eq("id", custom.id).select("title").single(),
      "rename custom chapter",
    ) as { title: string };
    expect(renamed.title).toBe("Bab Kustom v2");

    // --- a canonical (non-custom) chapter cannot be renamed (guard_section_title_immutable) ---
    const renCanon = await svc
      .from("manual_sections")
      .update({ title: "Judul bawaan diubah" })
      .eq("manual_version_id", mvId)
      .eq("section_key", "cover")
      .select("id");
    expect(renCanon.error, "canonical chapter rename must be rejected").toBeTruthy();

    // --- a required canonical chapter cannot be deleted (guard_required_section_delete, Phase 2) ---
    const delCanon = await svc
      .from("manual_sections")
      .delete()
      .eq("manual_version_id", mvId)
      .eq("section_key", "cover")
      .select("id");
    expect(delCanon.error, "required canonical chapter delete must be rejected").toBeTruthy();

    // --- delete the custom chapter (allowed) and confirm it is gone ---
    const delCustom = await svc.from("manual_sections").delete().eq("id", custom.id).select("id");
    expect(delCustom.error, "delete custom chapter").toBeNull();
    const remaining = must(
      await svc.from("manual_sections").select("id").eq("manual_version_id", mvId),
      "reload after custom delete",
    ) as { id: string }[];
    expect(remaining.some((s) => s.id === custom.id)).toBe(false);

    // the whole Manual (versions/sections/blocks) is removed in afterAll
  });
});

// ---------------------------------------------------------------------------
// AC-P3-5 — after a custom chapter is deleted from the MIDDLE of the list, the
// surviving sections must be compacted back to contiguous, unique 0..n-1
// positions with their visible order unchanged. `deleteCustomSection` (the
// server action) does exactly what this test does: DELETE the row, then feed the
// survivors' current order into the SAME transactional reorder RPC used for
// drag-reorder. This exercises that DB sequence directly against DEV.
// ---------------------------------------------------------------------------
describe.skipIf(!HAS_SERVICE)("Phase 3 — custom chapter delete recompacts positions atomically (AC-P3-5)", () => {
  // Exercises public.delete_custom_manual_section — the ONE-transaction delete + re-pack the
  // deleteCustomSection server action now calls. Bare manual_version (raw insert -> no template
  // sections auto-instantiated) filled with custom sections; every row here is deletable, so
  // afterAll (which ASSERTS success) leaves DEV exactly as it found it.
  let manualId = "";

  afterAll(async () => {
    if (!HAS_SERVICE || !manualId) return;
    const del = await service().from("manuals").delete().eq("id", manualId).select("id");
    expect(del.error, "AC-P3-5 fixture cleanup must succeed").toBeNull();
  });

  const loadOrder = async (mvId: string) =>
    (must(
      await service().from("manual_sections").select("id, section_key, position, is_custom").eq("manual_version_id", mvId).order("position"),
      "load section order",
    ) as { id: string; section_key: string; position: number; is_custom: boolean }[]);

  async function addSection(mvId: string, title: string, position: number) {
    return must(
      await service()
        .from("manual_sections")
        .insert({ organization_id: ORG_A, manual_version_id: mvId, section_key: `custom-${rnd()}`, title, required: false, is_custom: true, position })
        .select("id")
        .single(),
      `insert section "${title}"`,
    ) as { id: string };
  }

  /** Call the atomic RPC and return its survivor rows (id, position, row_version). */
  async function deleteAtomic(sectionId: string) {
    const res = await service().rpc("delete_custom_manual_section", { p_section_id: sectionId });
    expect(res.error, `delete_custom_manual_section(${sectionId})`).toBeNull();
    return (res.data ?? []) as { id: string; position: number; row_version: number }[];
  }

  it("A-G: add custom mid-list -> atomic delete -> contiguous, order preserved, persists, repeatable, canonical still protected", async () => {
    const svc = service();

    const manual = must(
      await svc.from("manuals").insert({ organization_id: ORG_A, ea_product_id: VMAX_PRODUCT, template_id: SYSTEM_TEMPLATE, locale: "id" }).select("id").single(),
      "insert manuals",
    ) as { id: string };
    manualId = manual.id;
    const mv = must(
      await svc
        .from("manual_versions")
        .insert({ organization_id: ORG_A, manual_id: manual.id, ea_version_id: VMAX_EA_VERSION, version: "1.0.0", template_id: SYSTEM_TEMPLATE, template_version: 1 })
        .select("id")
        .single(),
      "insert manual_versions",
    ) as { id: string };
    const mvId = mv.id;

    for (let i = 0; i < 6; i++) await addSection(mvId, `Bab ${i}`, i);
    expect((await loadOrder(mvId)).map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);

    // --- A. add another custom section, move it into the MIDDLE ---
    const custom = await addSection(mvId, `Bab Kustom ${rnd()}`, 6);
    const mid = 3;
    const desired = (await loadOrder(mvId)).map((s) => s.id).filter((id) => id !== custom.id);
    desired.splice(mid, 0, custom.id);
    expect((await svc.rpc("reorder_manual_sections", { p_manual_version_id: mvId, p_ordered_ids: desired })).error).toBeNull();
    const placed = await loadOrder(mvId);
    expect(placed.map((s) => s.id)).toEqual(desired);
    expect(placed[mid].id).toBe(custom.id);
    const orderWithoutCustom = placed.filter((s) => s.id !== custom.id).map((s) => s.id);

    // --- B. one atomic RPC: delete + re-pack ---
    const survivors = await deleteAtomic(custom.id);

    // the RPC return contract: id + position + row_version, contiguous, in order
    expect(survivors.map((s) => s.position)).toEqual([...Array(survivors.length).keys()]);
    expect(survivors.map((s) => s.id)).toEqual(orderWithoutCustom);
    expect(survivors.every((s) => typeof s.row_version === "number" && s.row_version >= 1)).toBe(true);

    // --- C. DB positions contiguous 0..n-1 AND unique ---
    const after = await loadOrder(mvId);
    const positions = after.map((s) => s.position);
    expect(positions).toEqual([...Array(after.length).keys()]);
    expect(new Set(positions).size).toBe(positions.length);
    expect(after.length).toBe(placed.length - 1);

    // --- D. survivor order unchanged; deleted chapter gone ---
    expect(after.map((s) => s.id)).toEqual(orderWithoutCustom);
    expect(after.some((s) => s.id === custom.id)).toBe(false);

    // --- E. fresh reload -> same contiguous order ---
    const reload = await loadOrder(mvId);
    expect(reload.map((s) => s.id)).toEqual(orderWithoutCustom);
    expect(reload.map((s) => s.position)).toEqual([...Array(reload.length).keys()]);

    // --- F. repeated add/delete cycles never leave a gap ---
    for (let cycle = 0; cycle < 3; cycle++) {
      const c = await addSection(mvId, `Siklus ${cycle}`, (await loadOrder(mvId)).length);
      const rest = (await loadOrder(mvId)).map((s) => s.id).filter((id) => id !== c.id);
      rest.splice(2, 0, c.id);
      expect((await svc.rpc("reorder_manual_sections", { p_manual_version_id: mvId, p_ordered_ids: rest })).error).toBeNull();
      const surv = await deleteAtomic(c.id);
      expect(surv.map((s) => s.position), `cycle ${cycle}: RPC returns contiguous`).toEqual([...Array(surv.length).keys()]);
      expect((await loadOrder(mvId)).map((s) => s.position), `cycle ${cycle}: DB contiguous`).toEqual([...Array(surv.length).keys()]);
    }
    const end = await loadOrder(mvId);
    expect(end.map((s) => s.id)).toEqual(orderWithoutCustom);
    expect(end.map((s) => s.position)).toEqual([...Array(end.length).keys()]);

    // --- G. the RPC refuses a required canonical chapter (seed VMax manual, no mutation) ---
    const cover = must(
      await svc.from("manual_sections").select("id, required, is_custom").eq("manual_version_id", VMAX_MV).eq("section_key", "cover").single(),
      "seed cover section",
    ) as { id: string; required: boolean; is_custom: boolean };
    const refused = await svc.rpc("delete_custom_manual_section", { p_section_id: cover.id });
    expect(refused.error, "delete_custom_manual_section must refuse a canonical chapter").toBeTruthy();
    const coverStill = must(
      await svc.from("manual_sections").select("id, required, is_custom").eq("id", cover.id).single(),
      "cover still present",
    ) as { id: string; required: boolean; is_custom: boolean };
    expect(coverStill.required && !coverStill.is_custom).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-P2-14 (corrected) — app.guard_required_section_delete must REJECT a direct
// delete of a required canonical chapter, but must NOT block the FK cascade that
// removes child sections when an authorised parent (manual_version / manual) is
// deleted. Fixed in 20260901000900 via pg_trigger_depth().
// ---------------------------------------------------------------------------
describe.skipIf(!HAS_SERVICE)("Phase 3 — cascade-aware required-section delete guard (AC-P2-14)", () => {
  const createdManualIds: string[] = [];

  afterAll(async () => {
    if (!HAS_SERVICE) return;
    // Whatever is still around gets deleted, and the delete MUST succeed now.
    for (const id of createdManualIds) {
      const del = await service().from("manuals").delete().eq("id", id).select("id");
      expect(del.error, `cascade-guard fixture cleanup (${id}) must succeed`).toBeNull();
    }
  });

  /** A real Manual + Version with template-instantiated (required, canonical) sections. */
  async function makeManualWithTemplateSections(version: string) {
    const svc = service();
    const mk = await svc.rpc("create_manual_with_version", {
      p_org: ORG_A,
      p_ea_product_id: VMAX_PRODUCT,
      p_ea_version_id: VMAX_EA_VERSION,
      p_manual_version: version,
      p_template_id: SYSTEM_TEMPLATE,
      p_locale: "id",
    });
    expect(mk.error, `create_manual_with_version ${version}`).toBeNull();
    const row = (Array.isArray(mk.data) ? mk.data[0] : mk.data) as { manual_id: string; manual_version_id: string };
    expect(row?.manual_id, "manual row").toBeTruthy();
    createdManualIds.push(row.manual_id);
    return row;
  }

  it("A: DELETE a required canonical section directly -> rejected", async () => {
    const svc = service();
    const { manual_version_id } = await makeManualWithTemplateSections("1.0.0");
    const del = await svc.from("manual_sections").delete().eq("manual_version_id", manual_version_id).eq("section_key", "cover").select("id");
    expect(del.error, "direct delete of required canonical section must be rejected").toBeTruthy();
    expect(String((del.error as { message?: string })?.message ?? "")).toMatch(/Bab wajib tidak dapat dihapus/);
    const still = must(
      await svc.from("manual_sections").select("id").eq("manual_version_id", manual_version_id).eq("section_key", "cover"),
      "cover still present",
    ) as { id: string }[];
    expect(still.length).toBe(1);
  });

  it("B: DELETE a custom / non-required section directly -> allowed", async () => {
    const svc = service();
    const { manual_version_id } = await makeManualWithTemplateSections("1.0.1");
    const n = must(await svc.from("manual_sections").select("id").eq("manual_version_id", manual_version_id), "sections").length;
    const custom = must(
      await svc
        .from("manual_sections")
        .insert({ organization_id: ORG_A, manual_version_id, section_key: `custom-${rnd()}`, title: `Kustom ${rnd()}`, required: false, is_custom: true, position: n })
        .select("id")
        .single(),
      "insert custom section",
    ) as { id: string };
    const del = await svc.from("manual_sections").delete().eq("id", custom.id).select("id");
    expect(del.error, "direct delete of a custom section must be allowed").toBeNull();
    expect((del.data as { id: string }[]).length).toBe(1);
  });

  it("C: DELETE the parent manual_version -> required canonical child sections cascade away", async () => {
    const svc = service();
    const { manual_version_id } = await makeManualWithTemplateSections("7.7.7");
    const before = must(
      await svc.from("manual_sections").select("id").eq("manual_version_id", manual_version_id),
      "sections before",
    ) as { id: string }[];
    expect(before.length).toBeGreaterThan(10);

    const del = await svc.from("manual_versions").delete().eq("id", manual_version_id).select("id");
    expect(del.error, "authorised parent manual_version delete must NOT be blocked by the section guard").toBeNull();

    // E (partial): no orphan sections remain
    const after = must(
      await svc.from("manual_sections").select("id").eq("manual_version_id", manual_version_id),
      "sections after",
    ) as { id: string }[];
    expect(after.length).toBe(0);
  });

  it("D + E: DELETE the parent manual -> manual_versions + all sections cascade, no orphans", async () => {
    const svc = service();
    const { manual_id, manual_version_id } = await makeManualWithTemplateSections("1.0.0");
    const del = await svc.from("manuals").delete().eq("id", manual_id).select("id");
    expect(del.error, "authorised parent manual delete must cascade through required sections").toBeNull();

    expect((must(await svc.from("manual_versions").select("id").eq("id", manual_version_id), "mv gone") as unknown[]).length).toBe(0);
    expect((must(await svc.from("manual_sections").select("id").eq("manual_version_id", manual_version_id), "sections gone") as unknown[]).length).toBe(0);
    // the id is consumed; nothing to clean in afterAll for this one
    createdManualIds.splice(createdManualIds.indexOf(manual_id), 1);
  });

  it("F: an UNAUTHORISED parent delete is still rejected (reviewer cannot delete a manual)", async () => {
    const { manual_id } = await makeManualWithTemplateSections("1.0.1");
    const reviewer = await signIn("reviewer@smartin.demo"); // TECHNICAL_REVIEWER, org A
    const del = await reviewer.from("manuals").delete().eq("id", manual_id).select("id");
    // RLS: no DELETE policy for a reviewer -> 0 rows affected, row still there (not a thrown error)
    expect((del.data ?? []).length, "reviewer must not delete a manual").toBe(0);
    const still = must(await service().from("manuals").select("id").eq("id", manual_id), "manual still present") as { id: string }[];
    expect(still.length).toBe(1);
  });
});

describe.skipIf(!HAS_SERVICE)("Phase 3 — parameterTable block rejects a foreign-org EA-Version group (AC-P3-8 / GI-11)", () => {
  const cleanup: { table: "manual_blocks" | "parameter_groups" | "ea_versions" | "ea_products"; id: string }[] = [];

  afterAll(async () => {
    if (!HAS_SERVICE) return;
    const svc = service();
    const order: (typeof cleanup)[number]["table"][] = ["manual_blocks", "parameter_groups", "ea_versions", "ea_products"];
    for (const table of order) {
      for (const c of cleanup.filter((x) => x.table === table)) {
        const del = await svc.from(table).delete().eq("id", c.id).select("id");
        expect(del.error, `cleanup: delete ${table} ${c.id}`).toBeNull();
      }
    }
  });

  it("an Org A parameterTable block referencing an Org B parameter group is rejected and not stored", async () => {
    const svc = service();
    const dev = await signIn("developer@smartin.demo");
    const tag = rnd();

    // --- Org B fixture: product -> version -> parameter group (service client bypasses RLS) ---
    const bProduct = must(
      await svc
        .from("ea_products")
        .insert({ organization_id: ORG_B, name: `Foreign EA ${tag}`, slug: `foreign-ea-${tag}` })
        .select("id")
        .single(),
      "Org B ea_products",
    ) as { id: string };
    cleanup.push({ table: "ea_products", id: bProduct.id });

    const bVersion = must(
      await svc
        .from("ea_versions")
        .insert({ organization_id: ORG_B, ea_product_id: bProduct.id, version: "1.0.0", platform: "MT5" })
        .select("id")
        .single(),
      "Org B ea_versions",
    ) as { id: string };
    cleanup.push({ table: "ea_versions", id: bVersion.id });

    const bGroup = must(
      await svc
        .from("parameter_groups")
        .insert({ organization_id: ORG_B, ea_version_id: bVersion.id, name: `Foreign Group ${tag}`, position: 0 })
        .select("id")
        .single(),
      "Org B parameter_groups",
    ) as { id: string };
    cleanup.push({ table: "parameter_groups", id: bGroup.id });

    // --- Org A: a real section of the seed VMax Manual Version (linked to an Org A EA Version) ---
    const sec = must(
      await dev
        .from("manual_sections")
        .select("id, organization_id")
        .eq("manual_version_id", VMAX_MV)
        .eq("section_key", "parameters")
        .single(),
      "Org A 'parameters' section",
    ) as { id: string; organization_id: string };
    expect(sec.organization_id).toBe(ORG_A);

    // --- attempt: parameterTable block in Org A referencing the Org B group ---
    const attempt = await dev
      .from("manual_blocks")
      .insert({
        organization_id: ORG_A,
        manual_section_id: sec.id,
        block_type: "parameterTable",
        payload: { type: "parameterTable", schemaVersion: 1, groupIds: [bGroup.id] },
        position: 100000,
        parameter_group_ids: [bGroup.id],
      })
      .select("id");
    // guard_parameter_table_ownership: the group is neither in the linked EA Version nor in Org A
    expect(attempt.error, "cross-org parameterTable block must be rejected").toBeTruthy();

    // --- and nothing was stored ---
    const stored = must(
      await svc
        .from("manual_blocks")
        .select("id")
        .eq("manual_section_id", sec.id)
        .eq("block_type", "parameterTable")
        .contains("parameter_group_ids", [bGroup.id]),
      "verify no block was stored",
    ) as { id: string }[];
    expect(stored.length, "no invalid parameterTable block persisted").toBe(0);
    for (const s of stored) cleanup.push({ table: "manual_blocks", id: s.id }); // defensive cleanup if any slipped through
  });
});

// ---------------------------------------------------------------------------
// AC-P3-8 (positive) — a parameterTable block stores only the EA-Version GROUP
// id. Parameter definitions live once on ea_parameters; editing one there must
// propagate to EVERY Manual Version that references the group, with NO manual-
// local copy and NO block-payload rewrite. Verified across two Manual Versions
// on one EA Version.
// ---------------------------------------------------------------------------
describe.skipIf(!HAS_SERVICE)("Phase 3 — parameter definition edits propagate to every referencing Manual Version (AC-P3-8)", () => {
  // Uses the SHARED seed VMax EA Version (one EA Version, many Manual Versions). Only creates
  // two parameterTable blocks (freely deletable) and mutates ONE ea_parameters row, both
  // undone in afterAll — so nothing undeleteable is created on DEV.
  const createdManualIds: string[] = [];
  const GROUP = VMAX_GROUP;
  const original = { id: "", display_name: "", default_value: null as string | null };

  afterAll(async () => {
    if (!HAS_SERVICE) return;
    const svc = service();
    for (const id of createdManualIds) {
      const del = await svc.from("manuals").delete().eq("id", id).select("id");
      expect(del.error, `cleanup: delete propagation fixture manual ${id}`).toBeNull();
    }
    if (original.id) {
      const rst = await svc
        .from("ea_parameters")
        .update({ display_name: original.display_name, default_value: original.default_value })
        .eq("id", original.id)
        .select("id");
      expect(rst.error, "cleanup: restore FixedLot definition").toBeNull();
    }
  });

  /** A self-contained Manual Version on the seed VMax EA Version + one section to host a block. */
  async function makeManualVersionOnVMax(version: string) {
    const svc = service();
    const manual = must(
      await svc
        .from("manuals")
        .insert({ organization_id: ORG_A, ea_product_id: VMAX_PRODUCT, template_id: SYSTEM_TEMPLATE, locale: "id" })
        .select("id")
        .single(),
      "insert manuals",
    ) as { id: string };
    createdManualIds.push(manual.id);
    const mv = must(
      await svc
        .from("manual_versions")
        .insert({
          organization_id: ORG_A,
          manual_id: manual.id,
          ea_version_id: VMAX_EA_VERSION,
          version,
          template_id: SYSTEM_TEMPLATE,
          template_version: 1,
        })
        .select("id, ea_version_id")
        .single(),
      "insert manual_versions",
    ) as { id: string; ea_version_id: string };
    const sec = must(
      await svc
        .from("manual_sections")
        .insert({
          organization_id: ORG_A,
          manual_version_id: mv.id,
          section_key: `parameters-${rnd()}`,
          title: "Referensi Parameter",
          required: false,
          is_custom: true,
          position: 0,
        })
        .select("id")
        .single(),
      "insert section",
    ) as { id: string };
    return { manualId: manual.id, mvId: mv.id, sectionId: sec.id, eaVersionId: mv.ea_version_id };
  }

  /** What a manual "renders" for its parameterTable: its block payload + the live group/parameter rows for its EA Version. */
  async function renderParams(mvId: string, blockId: string) {
    const svc = service();
    const mv = must(
      await svc.from("manual_versions").select("id, ea_version_id").eq("id", mvId).single(),
      "load manual_version",
    ) as { id: string; ea_version_id: string };
    const block = must(
      await svc.from("manual_blocks").select("id, payload, parameter_group_ids, row_version").eq("id", blockId).single(),
      "load parameterTable block",
    ) as { id: string; payload: { groupIds: string[] }; parameter_group_ids: string[]; row_version: number };
    const groups = must(
      await svc
        .from("parameter_groups")
        .select("id, name, ea_parameters(id, display_name, default_value, technical_name)")
        .eq("ea_version_id", mv.ea_version_id)
        .order("position"),
      "resolve groups for EA version",
    ) as { id: string; name: string; ea_parameters: { id: string; display_name: string; default_value: string | null; technical_name: string }[] }[];
    const fixedLot = groups.flatMap((g) => g.ea_parameters).find((p) => p.technical_name === "FixedLot")!;
    return { block, groups, fixedLot };
  }

  it("edit ea_parameters once -> both Manual Versions render the new value; no copy, no block-payload rewrite", async () => {
    const svc = service();

    // --- two DISTINCT, self-contained Manual Versions on the ONE seed EA Version ---
    const A = await makeManualVersionOnVMax("1.0.0");
    const B = await makeManualVersionOnVMax("2.0.0");
    expect(A.mvId).not.toBe(B.mvId);
    expect(A.eaVersionId).toBe(B.eaVersionId);
    const mvs = [{ id: A.mvId }, { id: B.mvId }];

    // --- a parameterTable block in each, both referencing the SAME EA-Version group ---
    const blockIds: string[] = [];
    for (const f of [A, B]) {
      const blk = must(
        await svc
          .from("manual_blocks")
          .insert({
            organization_id: ORG_A,
            manual_section_id: f.sectionId,
            block_type: "parameterTable",
            payload: { type: "parameterTable", schemaVersion: 1, groupIds: [GROUP] },
            position: 0,
            parameter_group_ids: [GROUP],
          })
          .select("id")
          .single(),
        "insert parameterTable block",
      ) as { id: string };
      blockIds.push(blk.id);
    }
    const [blkA, blkB] = blockIds;

    // capture the ORIGINAL FixedLot definition so afterAll can restore it
    const fl0 = must(
      await svc
        .from("ea_parameters")
        .select("id, display_name, default_value")
        .eq("parameter_group_id", GROUP)
        .eq("technical_name", "FixedLot")
        .single(),
      "load FixedLot",
    ) as { id: string; display_name: string; default_value: string | null };
    original.id = fl0.id;
    original.display_name = fl0.display_name;
    original.default_value = fl0.default_value;

    // --- 1. render both: both reference the SAME group id and show the OLD definition ---
    const a0 = await renderParams(mvs[0].id, blkA);
    const b0 = await renderParams(mvs[1].id, blkB);
    for (const r of [a0, b0]) {
      expect(r.block.payload.groupIds).toEqual([GROUP]);
      expect(r.groups.some((g) => g.id === GROUP)).toBe(true);
      expect(r.fixedLot.display_name).toBe(fl0.display_name);
      expect(r.fixedLot.default_value).toBe(fl0.default_value);
    }
    const payloadA = JSON.stringify(a0.block.payload);
    const payloadB = JSON.stringify(b0.block.payload);
    const rvA = a0.block.row_version;
    const rvB = b0.block.row_version;

    // --- 2/3. edit the parameter definition ONCE via the legitimate parameter-management path ---
    const NEW_NAME = "Fixed Lot (uji propagasi)";
    const NEW_DEFAULT = "0.09";
    const upd = await svc
      .from("ea_parameters")
      .update({ display_name: NEW_NAME, default_value: NEW_DEFAULT })
      .eq("id", fl0.id)
      .select("display_name, default_value")
      .single();
    expect(upd.error, "edit ea_parameters").toBeNull();
    expect(upd.data).toMatchObject({ display_name: NEW_NAME, default_value: NEW_DEFAULT });

    // --- 4/5. re-render A and B: BOTH show the new definition ---
    const a1 = await renderParams(mvs[0].id, blkA);
    const b1 = await renderParams(mvs[1].id, blkB);
    for (const r of [a1, b1]) {
      expect(r.fixedLot.display_name).toBe(NEW_NAME);
      expect(r.fixedLot.default_value).toBe(NEW_DEFAULT);
      expect(r.block.payload.groupIds).toEqual([GROUP]); // still the SAME EA-Version group id
    }

    // --- no manual-local copy, no block-payload rewrite ---
    expect(JSON.stringify(a1.block.payload), "block A payload unchanged").toBe(payloadA);
    expect(JSON.stringify(b1.block.payload), "block B payload unchanged").toBe(payloadB);
    expect(a1.block.row_version, "block A row_version unchanged").toBe(rvA);
    expect(b1.block.row_version, "block B row_version unchanged").toBe(rvB);

    // exactly ONE FixedLot row for the group — definitions are not copied per manual
    const flRows = must(
      await svc.from("ea_parameters").select("id").eq("parameter_group_id", GROUP).eq("technical_name", "FixedLot"),
      "count FixedLot rows",
    ) as { id: string }[];
    expect(flRows.length).toBe(1);

    // --- restore (belt & braces; afterAll also restores) ---
    await svc
      .from("ea_parameters")
      .update({ display_name: fl0.display_name, default_value: fl0.default_value })
      .eq("id", fl0.id);
    const restored = must(
      await svc.from("ea_parameters").select("display_name, default_value").eq("id", fl0.id).single(),
      "verify restore",
    ) as { display_name: string; default_value: string | null };
    expect(restored.display_name).toBe(fl0.display_name);
    expect(restored.default_value).toBe(fl0.default_value);
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — ai_revisions RLS + idempotency (spec §21, §22, §31, AC-P4-9/10)
//
// read  = any active member of the org           (reviewers included, read-only)
// write = app.can_author(org) AND actor_id = uid  (DEVELOPER / ADMIN only)
// no delete policy; anon cannot touch the table; a partial unique index enforces
// "at most one PENDING proposal per (manual_version_id, input_hash)".
// ---------------------------------------------------------------------------
describe.skipIf(!HAS_API)("Phase 4 — ai_revisions RLS + idempotency", () => {
  const MARK = `test:ai-rls:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  let dev: SupabaseClient;
  let technical: SupabaseClient;
  let compliance: SupabaseClient;
  let outsider: SupabaseClient;
  let anon: SupabaseClient;
  let devUid = "";

  const baseRow = (over: Record<string, unknown> = {}) => ({
    organization_id: ORG_A,
    manual_version_id: VMAX_MV,
    section_id: null,
    block_id: null,
    target_field: "content",
    operation: "improveText",
    input_hash: MARK,
    locale: "id",
    status: "PROPOSAL",
    proposed_output: { kind: "text", text: "Pasang file EX5 ke folder Experts." },
    provider: "mock",
    ...over,
  });

  beforeAll(async () => {
    anon = createClient(URL!, ANON!, { global: { fetch: boundFetch } });
    dev = await signIn("developer@smartin.demo");
    technical = await signIn("reviewer@smartin.demo");
    compliance = await signIn("compliance@smartin.demo");
    outsider = await signIn("outsider@smartin.demo");
    devUid = (await dev.auth.getUser()).data.user!.id;
  });

  afterAll(async () => {
    // data hygiene (§38): remove every row this suite created; assert it is gone
    const svc = service();
    await svc.from("ai_revisions").delete().eq("input_hash", MARK);
    const { data } = await svc.from("ai_revisions").select("id").eq("input_hash", MARK);
    expect(data ?? [], "ai_revisions test rows cleaned up").toHaveLength(0);
  });

  it("anon cannot insert, update, or read ai_revisions", async () => {
    const ins = await anon.from("ai_revisions").insert(baseRow({ actor_id: null }));
    expect(ins.error, "anon insert denied").toBeTruthy();
    const upd = await anon.from("ai_revisions").update({ decision: "ACCEPTED" }).eq("input_hash", MARK).select("id");
    expect(upd.data ?? [], "anon update no-op").toHaveLength(0);
    const sel = await anon.from("ai_revisions").select("id").eq("input_hash", MARK);
    expect(sel.data ?? [], "anon select empty").toHaveLength(0);
  });

  it("a reviewer (technical / compliance) cannot insert an ai_revisions row", async () => {
    for (const c of [technical, compliance]) {
      const uid = (await c.auth.getUser()).data.user!.id;
      const { error } = await c.from("ai_revisions").insert(baseRow({ actor_id: uid }));
      expect(error, "reviewer insert denied by RLS").toBeTruthy();
    }
  });

  it("a DEVELOPER can insert their own PROPOSAL, and the PENDING dedup index blocks a duplicate", async () => {
    const first = await dev.from("ai_revisions").insert(baseRow({ actor_id: devUid })).select("id, decision").single();
    expect(first.error, "developer insert ok").toBeNull();
    expect(first.data?.decision).toBe("PENDING");

    // identical (manual_version_id, input_hash) while still PENDING -> unique-index violation
    const dup = await dev.from("ai_revisions").insert(baseRow({ actor_id: devUid }));
    expect(dup.error, "duplicate PENDING proposal rejected").toBeTruthy();
    expect(dup.error?.code, "unique_violation").toBe("23505");

    // the developer can record a decision on their own row
    const decided = await dev
      .from("ai_revisions")
      .update({ decision: "REJECTED", decided_at: new Date().toISOString() })
      .eq("id", first.data!.id)
      .select("decision")
      .single();
    expect(decided.error).toBeNull();
    expect(decided.data?.decision).toBe("REJECTED");

    // once it is no longer PENDING, an identical request may create a fresh proposal
    const reissue = await dev.from("ai_revisions").insert(baseRow({ actor_id: devUid })).select("id").single();
    expect(reissue.error, "re-issue after decision allowed").toBeNull();
  });

  it("a reviewer can READ the org's ai_revisions audit (read-only)", async () => {
    const { data, error } = await technical.from("ai_revisions").select("id, operation").eq("input_hash", MARK);
    expect(error).toBeNull();
    expect((data ?? []).length, "reviewer sees the audit rows").toBeGreaterThan(0);
  });

  it("an outsider (org B) can neither read nor write org A's ai_revisions", async () => {
    const sel = await outsider.from("ai_revisions").select("id").eq("input_hash", MARK);
    expect(sel.data ?? [], "org B reads none of org A's rows").toHaveLength(0);

    const outUid = (await outsider.auth.getUser()).data.user!.id;
    const ins = await outsider.from("ai_revisions").insert(baseRow({ actor_id: outUid }));
    expect(ins.error, "org B insert into org A denied").toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — checklist template + results RLS (AC-P5-2/11, spec §35)
//
//   checklist_templates / checklist_items  -> SELECT for any authenticated user; NO client write
//   checklist_results                      -> SELECT for org members; NO client write at all
//                                             (server actions write via the service-role client)
// ---------------------------------------------------------------------------
describe.skipIf(!HAS_SERVICE)("Phase 5 — checklist RLS", () => {
  const MARK = `p5-rls-${Date.now()}`;
  let dev: SupabaseClient;
  let technical: SupabaseClient;
  let outsider: SupabaseClient;
  let anon: SupabaseClient;
  let seededResultId: string | null = null;

  const TEMPLATE_ID = "c5000000-0000-4000-8000-000000000001";

  beforeAll(async () => {
    dev = await signIn("developer@smartin.demo");
    technical = await signIn("reviewer@smartin.demo");
    outsider = await signIn("outsider@smartin.demo");
    anon = createClient(URL!, ANON!, { global: { fetch: boundFetch } });

    // seed one Org A result row via the service role (the only path that may write).
    // Defensive: this suite runs against a shared DEV project — clear any row this key left behind
    // by an earlier interrupted run so the seed is deterministic (no 23505 on a stale duplicate).
    await service().from("checklist_results").delete().eq("manual_version_id", VMAX_MV).eq("check_key", "CHK-VERSI-MATCH");
    const ins = await service()
      .from("checklist_results")
      .insert({
        organization_id: ORG_A,
        manual_version_id: VMAX_MV,
        checklist_template_id: TEMPLATE_ID,
        checklist_template_version: 1,
        check_key: "CHK-VERSI-MATCH",
        category: "identity",
        required: true,
        state: "PASS",
        evidence: { _reason: `seed ${MARK}` },
        evaluator: "system",
      })
      .select("id")
      .single();
    expect(ins.error, "service seed of checklist_result").toBeNull();
    seededResultId = ins.data!.id as string;
  });

  afterAll(async () => {
    await service().from("checklist_results").delete().eq("id", seededResultId);
    const { data } = await service().from("checklist_results").select("id").eq("id", seededResultId);
    expect(data ?? [], "checklist_results test row cleaned up").toHaveLength(0);
  });

  it("the active checklist template v1 has the full 31-item set with stable keys (PRD-OQ-004)", async () => {
    const { data, error } = await dev
      .from("checklist_items")
      .select("check_key, rule_key, position, required, bappebti_only")
      .eq("checklist_template_id", TEMPLATE_ID)
      .order("position");
    expect(error).toBeNull();
    const rows = data ?? [];
    expect(rows).toHaveLength(31);
    expect(rows.map((r) => r.check_key)).toEqual([
      "CHK-VERSI-DUA", "CHK-VERSI-MATCH", "CHK-DEV-LEGAL", "CHK-INSTALASI", "CHK-INSTALL-AUTOTRADING",
      "CHK-DEPENDENCIES-LISTED", "CHK-PACKAGE-FILES", "CHK-CARA-KERJA", "CHK-SPECIAL-CONDITIONS", "CHK-SETTING",
      "CHK-PARAM-COMPLETE", "CHK-PARAM-DEFAULT-MATCH", "CHK-UNITS-DEFINED", "CHK-QUICKSTART-DEMO", "CHK-SAFE-STOP",
      "CHK-DISCLAIMER-5-5-D", "CHK-RISK-GENERAL", "CHK-PAST-NOT-FUTURE", "CHK-DANGER-MODE-WARN", "CHK-NO-PROHIBITED-CLAIMS",
      "CHK-KONTAK", "CHK-KONTAK-SPLIT", "CHK-TRANSPARANSI", "CHK-BAHASA-ALGO", "CHK-PERIODE-EFEKTIF",
      "CHK-PERFORMANCE-KONDISI", "CHK-CHANGELOG-VERSI", "CHK-DISCLOSURE-REF", "CHK-ONBOARDING-MARGIN",
      "CHK-FITUR-DIJELASKAN", "CHK-INTERFACE",
    ]);
    // positions are 0..30, no gaps / duplicates
    expect(rows.map((r) => r.position)).toEqual(Array.from({ length: 31 }, (_, i) => i));
    // CHK-REQUIRED-CHAPTER (the removed umbrella) is gone
    expect(rows.some((r) => r.check_key === "CHK-REQUIRED-CHAPTER")).toBe(false);
    // exactly one non-required item, exactly seven bappebti-only
    expect(rows.filter((r) => !r.required).map((r) => r.check_key)).toEqual(["CHK-PACKAGE-FILES"]);
    expect(rows.filter((r) => r.bappebti_only).map((r) => r.check_key)).toEqual([
      "CHK-DISCLAIMER-5-5-D", "CHK-KONTAK", "CHK-TRANSPARANSI", "CHK-BAHASA-ALGO", "CHK-PERIODE-EFEKTIF",
      "CHK-DISCLOSURE-REF", "CHK-ONBOARDING-MARGIN",
    ]);
  });

  it("drift guard: every seeded rule_key maps to a registered evaluator (§9)", async () => {
    const { RULES } = await import("@/lib/validation/rules");
    const { data } = await dev.from("checklist_items").select("check_key, rule_key").eq("checklist_template_id", TEMPLATE_ID);
    for (const row of data ?? []) {
      expect(typeof RULES[row.rule_key as string], `no evaluator for ${row.check_key} (rule_key=${row.rule_key})`).toBe("function");
    }
    // and no orphan evaluator
    const seeded = new Set((data ?? []).map((r) => r.rule_key));
    for (const key of Object.keys(RULES)) expect(seeded.has(key), `evaluator ${key} not in the active template`).toBe(true);
  });

  it("the seeded result records its checklist template version (AC-P5-11)", async () => {
    const { data } = await dev
      .from("checklist_results")
      .select("checklist_template_id, checklist_template_version, state, evaluator")
      .eq("id", seededResultId)
      .single();
    expect(data?.checklist_template_id).toBe(TEMPLATE_ID);
    expect(data?.checklist_template_version).toBe(1);
  });

  it("templates + items are readable but not client-writable (immutable)", async () => {
    const rd = await dev.from("checklist_templates").select("id").eq("id", TEMPLATE_ID);
    expect((rd.data ?? []).length, "member reads the system template").toBe(1);

    const wr = await dev.from("checklist_templates").update({ title: "hacked" }).eq("id", TEMPLATE_ID).select("id");
    expect(wr.data ?? [], "no client update on checklist_templates").toHaveLength(0);

    const wi = await dev.from("checklist_items").update({ required: false }).eq("checklist_template_id", TEMPLATE_ID).select("id");
    expect(wi.data ?? [], "no client update on checklist_items").toHaveLength(0);
  });

  it("no authenticated role can insert / update / delete a checklist_result directly", async () => {
    for (const [name, c] of [["developer", dev], ["reviewer", technical], ["outsider", outsider]] as const) {
      const ins = await c.from("checklist_results").insert({
        organization_id: ORG_A,
        manual_version_id: VMAX_MV,
        checklist_template_id: TEMPLATE_ID,
        checklist_template_version: 1,
        check_key: "CHK-KONTAK",
        category: "support",
        required: true,
        state: "NOT_APPLICABLE",
        evidence: {},
        evaluator: "reviewer",
      });
      expect(ins.error, `${name} cannot insert a checklist_result`).toBeTruthy();

      const upd = await c
        .from("checklist_results")
        .update({ state: "NOT_APPLICABLE", evaluator: "reviewer" })
        .eq("id", seededResultId)
        .select("id");
      expect(upd.data ?? [], `${name} cannot update a checklist_result (forge N/A)`).toHaveLength(0);

      const del = await c.from("checklist_results").delete().eq("id", seededResultId).select("id");
      expect(del.data ?? [], `${name} cannot delete a checklist_result`).toHaveLength(0);
    }
  });

  it("developer of the org reads its own manual's checklist_results", async () => {
    const { data, error } = await dev.from("checklist_results").select("id, state").eq("manual_version_id", VMAX_MV);
    expect(error).toBeNull();
    expect((data ?? []).some((r) => r.id === seededResultId)).toBe(true);
  });

  it("an outsider (org B) reads none of org A's checklist_results", async () => {
    const { data } = await outsider.from("checklist_results").select("id").eq("manual_version_id", VMAX_MV);
    expect(data ?? [], "org B sees no org A checklist_results").toHaveLength(0);
  });

  it("anon cannot read or write checklist_results", async () => {
    const rd = await anon.from("checklist_results").select("id").eq("manual_version_id", VMAX_MV);
    expect(rd.data ?? [], "anon reads nothing").toHaveLength(0);
    const wr = await anon.from("checklist_results").insert({
      organization_id: ORG_A,
      manual_version_id: VMAX_MV,
      checklist_template_id: TEMPLATE_ID,
      checklist_template_version: 1,
      check_key: "CHK-KONTAK",
      category: "support",
      required: true,
      state: "PASS",
      evidence: {},
      evaluator: "system",
    });
    expect(wr.error, "anon insert denied").toBeTruthy();
  });

  it("the unique (manual_version_id, check_key) constraint holds (AC-P5-2)", async () => {
    const dup = await service().from("checklist_results").insert({
      organization_id: ORG_A,
      manual_version_id: VMAX_MV,
      checklist_template_id: TEMPLATE_ID,
      checklist_template_version: 1,
      check_key: "CHK-VERSI-MATCH", // same as the seeded row
      category: "identity",
      required: true,
      state: "MISSING",
      evidence: {},
      evaluator: "system",
    });
    expect(dup.error?.code, "duplicate item per manual version rejected").toBe("23505");
  });
});

// ===========================================================================
// Phase 6 slice 1 — foundation: contributors, reviews/comments/changelog/
// published_snapshots schema, RLS, cross-org integrity. (AC-P6-6 groundwork,
// AC-P6-13 groundwork; full workflow is slices 2-6.)
// ===========================================================================
describe.skipIf(!HAS_SERVICE)("Phase 6 slice 1 — foundation schema + RLS + provenance", () => {
  const MISSING_UUID = "00000000-0000-4000-8000-0000000000ff";
  let dev: SupabaseClient;
  let outsider: SupabaseClient;
  let reviewer: SupabaseClient;
  let anon: SupabaseClient;
  let DEV = "";
  let OUT = "";
  let REV = "";
  let coverSectionId: string;

  beforeAll(async () => {
    dev = await signIn("developer@smartin.demo");
    outsider = await signIn("outsider@smartin.demo");
    reviewer = await signIn("reviewer@smartin.demo");
    anon = createClient(URL!, ANON!, { global: { fetch: boundFetch } });
    DEV = (await dev.auth.getUser()).data.user!.id;
    OUT = (await outsider.auth.getUser()).data.user!.id;
    REV = (await reviewer.auth.getUser()).data.user!.id;
    const s = await service().from("manual_sections").select("id").eq("manual_version_id", VMAX_MV).eq("section_key", "cover").single();
    coverSectionId = s.data!.id as string;
    // clean slate for this manual version
    await service().from("manual_version_contributors").delete().eq("manual_version_id", VMAX_MV);
    await service().from("published_snapshots").delete().eq("manual_version_id", VMAX_MV);
  });

  afterAll(async () => {
    await service().from("manual_version_contributors").delete().eq("manual_version_id", VMAX_MV);
    await service().from("published_snapshots").delete().eq("manual_version_id", VMAX_MV);
    await service().from("manual_blocks").delete().eq("manual_section_id", coverSectionId);
    const left = await service().from("manual_version_contributors").select("id").eq("manual_version_id", VMAX_MV);
    expect(left.data ?? [], "slice-1 contributor fixtures cleaned").toHaveLength(0);
  });

  // --- new columns exist ---
  it("manual_versions gained reviewer / round / submitted-hash columns", async () => {
    const { data, error } = await service()
      .from("manual_versions")
      .select("technical_reviewer_id, compliance_reviewer_id, review_round, submitted_content_hash")
      .eq("id", VMAX_MV)
      .single();
    expect(error).toBeNull();
    expect(data!.review_round).toBe(0);
    expect(data!.technical_reviewer_id).toBeNull();
    expect(data!.submitted_content_hash).toBeNull();
  });

  // --- contributor provenance (AC-P6-6 groundwork) ---
  it("an authenticated author edit records exactly one durable contributor row", async () => {
    const ins = await dev.from("manual_blocks").insert({
      organization_id: ORG_A,
      manual_section_id: coverSectionId,
      block_type: "text",
      payload: { type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: ["p6 slice1 probe"] } },
      position: 900,
    }).select("id").single();
    expect(ins.error, "developer may author a block").toBeNull();

    const rows = await service().from("manual_version_contributors").select("user_id, contribution_count").eq("manual_version_id", VMAX_MV);
    expect((rows.data ?? []).map((r) => r.user_id)).toEqual([DEV]);

    // a second edit by the same user bumps the count, still one row (unique identity)
    await dev.from("manual_blocks").update({ payload: { type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: ["edited"] } } }).eq("id", ins.data!.id);
    const rows2 = await service().from("manual_version_contributors").select("user_id, contribution_count").eq("manual_version_id", VMAX_MV);
    expect(rows2.data).toHaveLength(1);
    expect(Number(rows2.data![0].contribution_count)).toBeGreaterThanOrEqual(2);

    await service().from("manual_blocks").delete().eq("id", ins.data!.id);
  });

  it("unique (manual_version_id, user_id) is enforced", async () => {
    await service().from("manual_version_contributors").insert({ organization_id: ORG_A, manual_version_id: VMAX_MV, user_id: DEV });
    const dup = await service().from("manual_version_contributors").insert({ organization_id: ORG_A, manual_version_id: VMAX_MV, user_id: DEV });
    expect(dup.error?.code).toBe("23505");
    await service().from("manual_version_contributors").delete().eq("manual_version_id", VMAX_MV);
  });

  it("checklist evaluation does NOT create contributor provenance", async () => {
    await service().from("manual_version_contributors").delete().eq("manual_version_id", VMAX_MV);
    await service().from("checklist_results").insert({
      organization_id: ORG_A, manual_version_id: VMAX_MV,
      checklist_template_id: "c5000000-0000-4000-8000-000000000001", checklist_template_version: 1,
      check_key: "CHK-VERSI-DUA", category: "identity", required: true, state: "MISSING", evidence: {}, evaluator: "system",
    });
    const rows = await service().from("manual_version_contributors").select("id").eq("manual_version_id", VMAX_MV);
    expect(rows.data ?? [], "checklist write is not authorship").toHaveLength(0);
    await service().from("checklist_results").delete().eq("manual_version_id", VMAX_MV);
  });

  it("a service-role (no auth.uid) write does not fabricate a contributor", async () => {
    await service().from("manual_version_contributors").delete().eq("manual_version_id", VMAX_MV);
    const b = await service().from("manual_blocks").insert({
      organization_id: ORG_A, manual_section_id: coverSectionId, block_type: "text",
      payload: { type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: ["svc"] } },
      position: 901,
    }).select("id").single();
    const rows = await service().from("manual_version_contributors").select("id").eq("manual_version_id", VMAX_MV);
    expect(rows.data ?? [], "no auth.uid -> no fabricated history").toHaveLength(0);
    await service().from("manual_blocks").delete().eq("id", b.data!.id);
  });

  it("a non-service caller cannot write manual_version_contributors directly (no INSERT policy)", async () => {
    const ins = await dev.from("manual_version_contributors").insert({ organization_id: ORG_A, manual_version_id: VMAX_MV, user_id: DEV }).select("id");
    expect(ins.data ?? [], "developer cannot forge contributor rows").toHaveLength(0);
  });

  it("a cross-org contributor row is impossible (composite FK)", async () => {
    const bad = await service().from("manual_version_contributors").insert({ organization_id: ORG_B, manual_version_id: VMAX_MV, user_id: OUT });
    expect(bad.error?.code, "wrong-org parent reference rejected").toBe("23503");
  });

  // --- reviews / review_comments / changelog cross-org + immutability ---
  it("reviews decision rows: UPDATE blocked for everyone; app-caller DELETE blocked; constraints hold", async () => {
    const r = await service().from("reviews").insert({
      organization_id: ORG_A, manual_version_id: VMAX_MV, round_number: 1, review_type: "TECHNICAL",
      reviewer_id: REV, decision: "APPROVE", summary: "", reviewed_content_hash: "deadbeef",
    }).select("id").single();
    expect(r.error, "seed a review row").toBeNull();
    // §39 — a decision can never be rewritten, not even by service-role
    const upd = await service().from("reviews").update({ decision: "REQUEST_CHANGES" }).eq("id", r.data!.id).select("id");
    expect(upd.error, "review decision cannot be rewritten").toBeTruthy();
    // an authenticated non-service caller cannot delete it (no client write policy)
    const appDel = await dev.from("reviews").delete().eq("id", r.data!.id).select("id");
    expect(appDel.data ?? [], "app caller cannot delete a review decision").toHaveLength(0);
    const stillThere = await service().from("reviews").select("id").eq("id", r.data!.id);
    expect(stillThere.data ?? [], "review decision survived the app-caller delete").toHaveLength(1);
    // constraints: REQUEST_CHANGES needs a summary; one decision per (version, round, type)
    const noSummary = await service().from("reviews").insert({
      organization_id: ORG_A, manual_version_id: VMAX_MV, round_number: 2, review_type: "TECHNICAL",
      reviewer_id: REV, decision: "REQUEST_CHANGES", summary: "   ", reviewed_content_hash: "x",
    });
    expect(noSummary.error, "REQUEST_CHANGES needs a non-empty summary").toBeTruthy();
    const dupRound = await service().from("reviews").insert({
      organization_id: ORG_A, manual_version_id: VMAX_MV, round_number: 1, review_type: "TECHNICAL",
      reviewer_id: REV, decision: "APPROVE", summary: "", reviewed_content_hash: "y",
    });
    expect(dupRound.error?.code, "one technical decision per round").toBe("23505");
    // DELETE is permitted only for a trusted service request (cascade / infra cleanup)
    const cleaned = await service().from("reviews").delete().eq("manual_version_id", VMAX_MV).select("id");
    expect(cleaned.error, "service-role may remove the fixture review row").toBeNull();
    const gone = await service().from("reviews").select("id").eq("manual_version_id", VMAX_MV);
    expect(gone.data ?? [], "reviews fixture cleaned").toHaveLength(0);
  });

  it("review_comments: foreign / cross-org anchors are rejected", async () => {
    const foreignSection = await service().from("review_comments").insert({
      organization_id: ORG_A, manual_version_id: VMAX_MV, round_number: 1, review_type: "TECHNICAL",
      author_id: REV, section_id: MISSING_UUID, body: "x",
    });
    expect(foreignSection.error, "unknown section anchor rejected").toBeTruthy();
    const wrongOrg = await service().from("review_comments").insert({
      organization_id: ORG_B, manual_version_id: VMAX_MV, round_number: 1, review_type: "TECHNICAL",
      author_id: REV, body: "x",
    });
    expect(wrongOrg.error?.code, "wrong-org manual_version reference rejected").toBe("23503");
    const bothAnchors = await service().from("review_comments").insert({
      organization_id: ORG_A, manual_version_id: VMAX_MV, round_number: 1, review_type: "TECHNICAL",
      author_id: REV, section_id: coverSectionId, block_id: coverSectionId, body: "x",
    });
    expect(bothAnchors.error, "at most one anchor").toBeTruthy();
  });

  it("changelog_entries: cross-org manual_version reference rejected", async () => {
    const bad = await service().from("changelog_entries").insert({
      organization_id: ORG_B, manual_version_id: VMAX_MV, position: 0, entry_type: "ADDED", body: "x", source_ea_version_id: VMAX_EA_VERSION,
    });
    expect(bad.error?.code).toBe("23503");
    const badType = await service().from("changelog_entries").insert({
      organization_id: ORG_A, manual_version_id: VMAX_MV, position: 0, entry_type: "REMOVED", body: "x", source_ea_version_id: VMAX_EA_VERSION,
    });
    expect(badType.error, "entry_type check constraint").toBeTruthy();
  });

  // --- published_snapshots uniqueness ---
  it("only one published_snapshot per manual version", async () => {
    const row = {
      organization_id: ORG_A, manual_version_id: VMAX_MV, render_json: { v: 1 }, content_hash: "abc",
      public_slug: "vmax-ea-demo", public_version: "1.0.0",
    };
    const first = await service().from("published_snapshots").insert(row).select("id").single();
    expect(first.error, "first snapshot inserts").toBeNull();
    const second = await service().from("published_snapshots").insert({ ...row, content_hash: "def", public_version: "1.0.1" });
    expect(second.error?.code, "second snapshot for same version rejected").toBe("23505");
    await service().from("published_snapshots").delete().eq("manual_version_id", VMAX_MV);
  });

  it("a non-service caller cannot write published_snapshots (no policy)", async () => {
    const ins = await dev.from("published_snapshots").insert({
      organization_id: ORG_A, manual_version_id: VMAX_MV, render_json: {}, content_hash: "x", public_slug: "s", public_version: "1.0.0",
    }).select("id");
    expect(ins.data ?? [], "developer cannot forge a snapshot").toHaveLength(0);
  });

  // --- RLS read isolation ---
  it("org B cannot read any org A foundation rows", async () => {
    // seed one org-A row of each readable kind
    await service().from("manual_version_contributors").insert({ organization_id: ORG_A, manual_version_id: VMAX_MV, user_id: DEV });
    for (const t of ["manual_version_contributors", "reviews", "review_comments", "changelog_entries", "published_snapshots"]) {
      const { data } = await outsider.from(t).select("id").eq("organization_id", ORG_A);
      expect(data ?? [], `${t}: org B reads nothing of org A`).toHaveLength(0);
    }
    // the same org-A member DOES see its own contributor rows
    const mine = await dev.from("manual_version_contributors").select("id").eq("manual_version_id", VMAX_MV);
    expect((mine.data ?? []).length).toBeGreaterThan(0);
    await service().from("manual_version_contributors").delete().eq("manual_version_id", VMAX_MV);
  });

  it("anon cannot read or write any foundation table", async () => {
    for (const t of ["manual_version_contributors", "reviews", "review_comments", "changelog_entries", "published_snapshots"]) {
      const rd = await anon.from(t).select("id");
      expect(rd.data ?? [], `anon reads nothing from ${t}`).toHaveLength(0);
    }
    const wr = await anon.from("changelog_entries").insert({ organization_id: ORG_A, manual_version_id: VMAX_MV, position: 0, entry_type: "ADDED", body: "x" });
    expect(wr.error, "anon insert denied").toBeTruthy();
  });
});

// ===========================================================================
// Phase 6 slice 2 — workflow commands + assignment + queues (AC-P6-2/3/5/6/7/8).
// Uses a DEDICATED throwaway manual version so the shared demo (VMAX_MV) is never
// left in a review state. All RPC calls go through authenticated clients except
// fixture setup/reset (service-role). afterAll drops the fixture + its audit trail.
// ===========================================================================
describe.skipIf(!HAS_SERVICE)("Phase 6 slice 2 — review workflow", () => {
  const MANUAL_ID = "60000000-0000-4000-8000-0000000000a2";
  const MV = "60000000-0000-4000-8000-0000000000b2";
  const H1 = "1".repeat(64);
  const H2 = "2".repeat(64);
  let dev: SupabaseClient; // developer@ = DEVELOPER + TECHNICAL_REVIEWER (multi-role)
  let admin: SupabaseClient;
  let reviewer: SupabaseClient; // reviewer@ = TECHNICAL_REVIEWER only
  let compliance: SupabaseClient; // compliance@ = COMPLIANCE_REVIEWER only
  let outsider: SupabaseClient; // org B
  let DEV = "", ADMIN = "", REV = "", COMP = "", OUT = "";
  let coverSectionId = "";

  const svc = () => service();
  const mvRow = async () =>
    (await svc().from("manual_versions").select("status, review_round, submitted_content_hash, technical_reviewer_id, compliance_reviewer_id").eq("id", MV).single()).data!;
  const auditCountFor = async (action?: string) => {
    let q = svc().from("audit_events").select("id", { count: "exact", head: true }).eq("entity_id", MV);
    if (action) q = q.eq("action", action);
    return (await q).count ?? 0;
  };

  beforeAll(async () => {
    dev = await signIn("developer@smartin.demo");
    admin = await signIn("admin@smartin.demo");
    reviewer = await signIn("reviewer@smartin.demo");
    compliance = await signIn("compliance@smartin.demo");
    outsider = await signIn("outsider@smartin.demo");
    DEV = (await dev.auth.getUser()).data.user!.id;
    ADMIN = (await admin.auth.getUser()).data.user!.id;
    REV = (await reviewer.auth.getUser()).data.user!.id;
    COMP = (await compliance.auth.getUser()).data.user!.id;
    OUT = (await outsider.auth.getUser()).data.user!.id;

    await svc().from("manual_versions").delete().eq("id", MV);
    await svc().from("manuals").delete().eq("id", MANUAL_ID);
    await svc().from("manuals").insert({
      id: MANUAL_ID, organization_id: ORG_A, ea_product_id: VMAX_PRODUCT, template_id: SYSTEM_TEMPLATE, locale: "id",
    });
    await svc().from("manual_versions").insert({
      id: MV, organization_id: ORG_A, manual_id: MANUAL_ID, ea_version_id: VMAX_EA_VERSION,
      version: "9.9.1", status: "DRAFT", template_id: SYSTEM_TEMPLATE, template_version: 1,
    });
    const s = await svc().from("manual_sections").insert({
      organization_id: ORG_A, manual_version_id: MV, section_key: "cover", title: "Sampul", required: true, position: 0,
    }).select("id").single();
    coverSectionId = s.data!.id as string;
  });

  afterAll(async () => {
    await svc().from("reviews").delete().eq("manual_version_id", MV);
    await svc().from("manual_versions").delete().eq("id", MV);
    await svc().from("manuals").delete().eq("id", MANUAL_ID);
    await svc().from("audit_events").delete().eq("entity_id", MV); // throwaway fixture audit trail
    await svc().from("memberships").delete().eq("organization_id", ORG_A).eq("user_id", ADMIN).eq("role", "TECHNICAL_REVIEWER");
  });

  // reset to a clean assigned DRAFT before each test
  beforeEach(async () => {
    await svc().from("reviews").delete().eq("manual_version_id", MV);
    await svc().from("manual_version_contributors").delete().eq("manual_version_id", MV);
    await svc().from("manual_blocks").delete().eq("manual_section_id", coverSectionId);
    await svc().from("manual_versions").update({
      status: "DRAFT", review_round: 0, submitted_content_hash: null,
      technical_reviewer_id: REV, compliance_reviewer_id: COMP,
    }).eq("id", MV);
  });

  // --- assignment ---
  it("admin assigns valid reviewers -> one audit event; reassignment -> another", { retry: 2 }, async () => {
    await svc().from("manual_versions").update({ technical_reviewer_id: null, compliance_reviewer_id: null }).eq("id", MV);
    const before = await auditCountFor("manual_version:assign_reviewers");
    const r1 = await admin.rpc("assign_reviewers", { p_manual_version_id: MV, p_technical_reviewer_id: REV, p_compliance_reviewer_id: COMP });
    expect(r1.error, "admin assigns").toBeNull();
    expect(await auditCountFor("manual_version:assign_reviewers")).toBe(before + 1);
    expect((await mvRow()).technical_reviewer_id).toBe(REV);

    const r2 = await admin.rpc("assign_reviewers", { p_manual_version_id: MV, p_technical_reviewer_id: DEV, p_compliance_reviewer_id: COMP });
    expect(r2.error, "reassign technical reviewer").toBeNull();
    expect(await auditCountFor("manual_version:assign_reviewers")).toBe(before + 2);
    const meta = (await svc().from("audit_events").select("metadata").eq("entity_id", MV).eq("action", "manual_version:assign_reviewers").order("created_at", { ascending: false }).limit(1).single()).data!.metadata as Record<string, unknown>;
    expect(meta.previousTechnicalReviewerId).toBe(REV);
    expect(meta.technicalReviewerId).toBe(DEV);
    expect(JSON.stringify(meta)).not.toMatch(/paragraph|content|payload/i); // no manual body
  });

  it("wrong-role / cross-org / inactive assignees are rejected (RPC + DB guard)", { retry: 2 }, async () => {
    expect((await admin.rpc("assign_reviewers", { p_manual_version_id: MV, p_technical_reviewer_id: COMP, p_compliance_reviewer_id: COMP })).error, "compliance user as technical reviewer").toBeTruthy();
    expect((await admin.rpc("assign_reviewers", { p_manual_version_id: MV, p_technical_reviewer_id: REV, p_compliance_reviewer_id: REV })).error, "technical user as compliance reviewer").toBeTruthy();
    expect((await admin.rpc("assign_reviewers", { p_manual_version_id: MV, p_technical_reviewer_id: OUT, p_compliance_reviewer_id: COMP })).error, "org B user").toBeTruthy();
    // DB-level: a direct forged UPDATE with a wrong-role reviewer id is rejected by the guard trigger
    const forged = await svc().from("manual_versions").update({ technical_reviewer_id: COMP }).eq("id", MV).select("id");
    expect(forged.error?.message ?? "", "guard trigger rejects wrong-role reviewer").toMatch(/must be an active TECHNICAL_REVIEWER/i);
    // inactive member: give admin@ an INACTIVE technical-reviewer membership, then try to assign
    await svc().from("memberships").upsert({ organization_id: ORG_A, user_id: ADMIN, role: "TECHNICAL_REVIEWER", is_active: false }, { onConflict: "organization_id,user_id,role" });
    expect((await admin.rpc("assign_reviewers", { p_manual_version_id: MV, p_technical_reviewer_id: ADMIN, p_compliance_reviewer_id: COMP })).error, "inactive member rejected").toBeTruthy();
    await svc().from("memberships").delete().eq("organization_id", ORG_A).eq("user_id", ADMIN).eq("role", "TECHNICAL_REVIEWER");
  });

  it("a non-admin cannot assign reviewers", { retry: 2 }, async () => {
    expect((await dev.rpc("assign_reviewers", { p_manual_version_id: MV, p_technical_reviewer_id: REV, p_compliance_reviewer_id: COMP })).error, "developer cannot assign").toBeTruthy();
    expect((await reviewer.rpc("assign_reviewers", { p_manual_version_id: MV, p_technical_reviewer_id: REV, p_compliance_reviewer_id: COMP })).error, "reviewer cannot assign").toBeTruthy();
  });

  // --- queue scoping (mirrors listReviewQueue's filter) ---
  it("review queues are assignment-scoped; admin sees the whole org queue; cross-org sees nothing", { retry: 2 }, async () => {
    await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 0, p_content_hash: H1 });
    const q = (c: SupabaseClient, uid: string, admin = false) =>
      admin
        ? c.from("manual_versions").select("id").eq("organization_id", ORG_A).eq("status", "TECHNICAL_REVIEW")
        : c.from("manual_versions").select("id").eq("organization_id", ORG_A).eq("status", "TECHNICAL_REVIEW").eq("technical_reviewer_id", uid);
    expect(((await q(reviewer, REV)).data ?? []).some((r) => r.id === MV), "assigned technical reviewer sees it").toBe(true);
    expect(((await q(dev, DEV)).data ?? []).some((r) => r.id === MV), "same-role but unassigned reviewer does not").toBe(false);
    expect(((await q(admin, ADMIN, true)).data ?? []).some((r) => r.id === MV), "admin sees the org queue").toBe(true);
    expect(((await outsider.from("manual_versions").select("id").eq("id", MV)).data ?? []), "org B sees nothing").toHaveLength(0);
    expect(((await compliance.from("manual_versions").select("id").eq("id", MV).eq("compliance_reviewer_id", COMP).eq("status", "COMPLIANCE_REVIEW")).data ?? []), "compliance queue is empty pre-technical-approval").toHaveLength(0);
  });

  // --- stage-specific queue visibility follows the workflow (FINAL QUEUE SEMANTICS CORRECTION) ---
  it("a manual is visible in exactly the queue matching its current review stage; it moves between queues on approve and leaves both on CHANGES_REQUESTED", { retry: 2 }, async () => {
    // Replays listReviewQueue's filter EXACTLY, driven by the shared REVIEW_QUEUE_STATUS contract:
    // one status per queue type; ADMIN drops only the assignment filter, never the status filter.
    const seesMV = async (
      c: SupabaseClient,
      uid: string,
      type: "technical" | "compliance",
      isAdmin: boolean,
    ) => {
      let q = c
        .from("manual_versions")
        .select("id")
        .eq("organization_id", ORG_A)
        .eq("status", REVIEW_QUEUE_STATUS[type]);
      if (!isAdmin) {
        q = q.eq(type === "technical" ? "technical_reviewer_id" : "compliance_reviewer_id", uid);
      }
      return (((await q).data ?? []) as { id: string }[]).some((r) => r.id === MV);
    };

    // A. status = TECHNICAL_REVIEW
    await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 0, p_content_hash: H1 });
    expect(await seesMV(reviewer, REV, "technical", false), "A: tech reviewer sees it in the technical queue").toBe(true);
    expect(await seesMV(compliance, COMP, "compliance", false), "A: compliance reviewer does NOT see it yet").toBe(false);
    expect(await seesMV(admin, ADMIN, "technical", true), "A: admin sees it in the technical queue").toBe(true);
    expect(await seesMV(admin, ADMIN, "compliance", true), "A: admin does NOT see it in the compliance queue").toBe(false);
    expect((await outsider.from("manual_versions").select("id").eq("id", MV)).data ?? [], "D: org B sees nothing").toHaveLength(0);

    // B. technical APPROVE -> status = COMPLIANCE_REVIEW
    const appr = await reviewer.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    expect(appr.error, "technical approve succeeds").toBeNull();
    expect((await mvRow()).status).toBe("COMPLIANCE_REVIEW");
    expect(await seesMV(reviewer, REV, "technical", false), "B: manual left the technical queue").toBe(false);
    expect(await seesMV(compliance, COMP, "compliance", false), "B: manual entered the compliance queue").toBe(true);
    expect(await seesMV(admin, ADMIN, "technical", true), "B: admin technical queue no longer shows it").toBe(false);
    expect(await seesMV(admin, ADMIN, "compliance", true), "B: admin compliance queue now shows it").toBe(true);
    expect((await outsider.from("manual_versions").select("id").eq("id", MV)).data ?? [], "D: org B still sees nothing").toHaveLength(0);

    // C. COMPLIANCE_REVIEW -> CHANGES_REQUESTED
    const rc = await compliance.rpc("record_compliance_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "REQUEST_CHANGES", p_summary: "lengkapi bagian risiko", p_current_hash: H1 });
    expect(rc.error, "compliance request-changes succeeds").toBeNull();
    expect((await mvRow()).status).toBe("CHANGES_REQUESTED");
    expect(await seesMV(reviewer, REV, "technical", false), "C: not in technical queue").toBe(false);
    expect(await seesMV(compliance, COMP, "compliance", false), "C: not in compliance queue").toBe(false);
    expect(await seesMV(admin, ADMIN, "technical", true), "C: not in admin technical queue").toBe(false);
    expect(await seesMV(admin, ADMIN, "compliance", true), "C: not in admin compliance queue").toBe(false);
  });

  // --- submission ---
  it("submit: happy path -> TECHNICAL_REVIEW round 1, one audit event; hash stored", { retry: 2 }, async () => {
    const before = await auditCountFor("manual_version:submit_review");
    const r = await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 0, p_content_hash: H1 });
    expect(r.error, "developer submits a ready DRAFT").toBeNull();
    const row = await mvRow();
    expect(row.status).toBe("TECHNICAL_REVIEW");
    expect(row.review_round).toBe(1);
    expect(row.submitted_content_hash).toBe(H1);
    expect(await auditCountFor("manual_version:submit_review")).toBe(before + 1);
  });

  it("submit is blocked without both reviewers, on a stale round, and for a non-author; a forged direct transition is blocked", { retry: 2 }, async () => {
    await svc().from("manual_versions").update({ technical_reviewer_id: null }).eq("id", MV);
    expect((await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 0, p_content_hash: H1 })).error?.message).toMatch(/technical reviewer not assigned/i);
    await svc().from("manual_versions").update({ technical_reviewer_id: REV, compliance_reviewer_id: null }).eq("id", MV);
    expect((await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 0, p_content_hash: H1 })).error?.message).toMatch(/compliance reviewer not assigned/i);
    await svc().from("manual_versions").update({ compliance_reviewer_id: COMP }).eq("id", MV);
    expect((await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 5, p_content_hash: H1 })).error?.message).toMatch(/stale review round/i);
    expect((await reviewer.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 0, p_content_hash: H1 })).error?.message).toMatch(/DEVELOPER or ADMIN/i);
    const forged = await dev.from("manual_versions").update({ status: "TECHNICAL_REVIEW" }).eq("id", MV).select("id");
    expect(forged.error?.message ?? "", "direct status write blocked by guard").toMatch(/review commands|insufficient/i);
    expect((await mvRow()).status).toBe("DRAFT");
  });

  // --- server-side read-only guard ---
  it("manual content is read-only in every non-DRAFT state; begin_revision reopens it", { retry: 2 }, async () => {
    await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 0, p_content_hash: H1 });
    const blockPayload = { type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: ["x"] } };
    // TECHNICAL_REVIEW
    expect((await dev.from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: coverSectionId, block_type: "text", payload: blockPayload, position: 0 }).select("id")).error?.message).toMatch(/read-only unless the version is DRAFT/i);
    expect((await dev.from("manual_sections").update({ completion_state: "complete" }).eq("id", coverSectionId).select("id")).error?.message).toMatch(/read-only/i);
    // -> CHANGES_REQUESTED
    await reviewer.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "REQUEST_CHANGES", p_summary: "perbaiki bab X", p_current_hash: H1 });
    expect((await mvRow()).status).toBe("CHANGES_REQUESTED");
    expect((await dev.from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: coverSectionId, block_type: "text", payload: blockPayload, position: 0 }).select("id")).error?.message).toMatch(/read-only/i);
    // begin revision -> DRAFT -> now writable
    const br = await dev.rpc("begin_revision", { p_manual_version_id: MV, p_expected_round: 1 });
    expect(br.error).toBeNull();
    expect((await mvRow()).status).toBe("DRAFT");
    const ok = await dev.from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: coverSectionId, block_type: "text", payload: blockPayload, position: 0 }).select("id");
    expect(ok.error, "DRAFT is writable again").toBeNull();
  });

  // --- self-approval ---
  it("self-approval: a reviewer who authored the version cannot APPROVE (technical + compliance); an independent reviewer can", { retry: 2 }, async () => {
    // dev@ authors a block -> becomes a contributor -> then is assigned technical reviewer
    await dev.from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: coverSectionId, block_type: "text", payload: { type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: ["authored by dev"] } }, position: 0 });
    await svc().from("manual_versions").update({ technical_reviewer_id: DEV }).eq("id", MV);
    await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 0, p_content_hash: H1 });

    const selfApprove = await dev.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    expect(selfApprove.error?.message, "author cannot self-approve").toMatch(/self approval forbidden/i);
    // but a contributor reviewer MAY request changes
    const rc = await dev.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "REQUEST_CHANGES", p_summary: "kembalikan ke draf", p_current_hash: H1 });
    expect(rc.error, "contributor reviewer may request changes").toBeNull();

    // re-open, reassign an INDEPENDENT technical reviewer (reviewer@ never authored), approve succeeds
    await dev.rpc("begin_revision", { p_manual_version_id: MV, p_expected_round: 1 });
    await svc().from("manual_versions").update({ technical_reviewer_id: REV }).eq("id", MV);
    await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 1, p_content_hash: H1 });
    const indepApprove = await reviewer.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    expect(indepApprove.error, "independent reviewer approves").toBeNull();
    expect((await mvRow()).status).toBe("COMPLIANCE_REVIEW");

    // compliance self-approval: plant compliance@ as a contributor, APPROVE -> rejected
    await svc().from("manual_version_contributors").insert({ organization_id: ORG_A, manual_version_id: MV, user_id: COMP });
    const compSelf = await compliance.rpc("record_compliance_decision", { p_manual_version_id: MV, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    expect(compSelf.error?.message, "compliance author cannot self-approve").toMatch(/self approval forbidden/i);
    await svc().from("manual_version_contributors").delete().eq("manual_version_id", MV).eq("user_id", COMP);
    const compOk = await compliance.rpc("record_compliance_decision", { p_manual_version_id: MV, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    expect(compOk.error, "independent compliance reviewer approves").toBeNull();
    expect((await mvRow()).status).toBe("APPROVED");
  });

  // --- decisions ---
  it("technical decisions transition correctly; wrong reviewer / role / round / summary / hash are rejected", { retry: 2 }, async () => {
    await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 0, p_content_hash: H1 });
    // wrong reviewer (compliance@ has no technical permission AND is not assigned)
    expect((await compliance.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 })).error?.message).toMatch(/technical review permission|assigned technical/i);
    // dev@ HAS the technical role but is not the assigned reviewer (reviewer@ is)
    expect((await dev.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 })).error?.message).toMatch(/not the assigned technical reviewer/i);
    // stale round
    expect((await reviewer.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 9, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 })).error?.message).toMatch(/stale review round/i);
    // blank summary on REQUEST_CHANGES
    expect((await reviewer.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "REQUEST_CHANGES", p_summary: "   ", p_current_hash: H1 })).error?.message).toMatch(/summary/i);
    // changed fingerprint on APPROVE
    expect((await reviewer.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H2 })).error?.message).toMatch(/stale content/i);
    // valid APPROVE -> COMPLIANCE_REVIEW, one reviews row, one audit
    const before = await auditCountFor("manual_version:technical_approve");
    const ok = await reviewer.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    expect(ok.error).toBeNull();
    expect((await mvRow()).status).toBe("COMPLIANCE_REVIEW");
    expect((await svc().from("reviews").select("id").eq("manual_version_id", MV).eq("round_number", 1).eq("review_type", "TECHNICAL")).data ?? []).toHaveLength(1);
    expect(await auditCountFor("manual_version:technical_approve")).toBe(before + 1);
  });

  it("compliance is unreachable without a recorded technical approval; then APPROVE -> APPROVED / REQUEST_CHANGES -> CHANGES_REQUESTED", { retry: 2 }, async () => {
    await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 0, p_content_hash: H1 });
    // acting compliance while still in TECHNICAL_REVIEW
    expect((await compliance.rpc("record_compliance_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 })).error?.message).toMatch(/not in COMPLIANCE_REVIEW/i);
    // force status to COMPLIANCE_REVIEW without a technical review row (service bypass)
    await svc().from("manual_versions").update({ status: "COMPLIANCE_REVIEW" }).eq("id", MV);
    expect((await compliance.rpc("record_compliance_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 })).error?.message).toMatch(/unreachable without a recorded technical approval/i);
    // do it properly
    await svc().from("manual_versions").update({ status: "TECHNICAL_REVIEW" }).eq("id", MV);
    await reviewer.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    const rc = await compliance.rpc("record_compliance_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "REQUEST_CHANGES", p_summary: "kutipan bab risiko kurang", p_current_hash: H1 });
    expect(rc.error).toBeNull();
    expect((await mvRow()).status).toBe("CHANGES_REQUESTED");
  });

  // --- concurrency ---
  it("concurrent technical decisions converge: one decision, one transition, one audit; loser gets a typed error", { retry: 2 }, async () => {
    await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 0, p_content_hash: H1 });
    const before = await auditCountFor();
    const [a, b] = await Promise.all([
      reviewer.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 }),
      reviewer.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 }),
    ]);
    const errs = [a.error, b.error].filter(Boolean);
    expect(errs, "exactly one request loses").toHaveLength(1);
    expect((await svc().from("reviews").select("id").eq("manual_version_id", MV).eq("round_number", 1).eq("review_type", "TECHNICAL")).data ?? [], "one decision row").toHaveLength(1);
    expect((await mvRow()).status, "one transition").toBe("COMPLIANCE_REVIEW");
    expect((await auditCountFor()) - before, "one audit event for the winning decision").toBe(1);

    // approve vs request-changes race on a fresh round
    await svc().from("manual_versions").update({ status: "TECHNICAL_REVIEW" }).eq("id", MV);
    await svc().from("reviews").delete().eq("manual_version_id", MV);
    const [c, d] = await Promise.all([
      reviewer.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 }),
      reviewer.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "REQUEST_CHANGES", p_summary: "x", p_current_hash: H1 }),
    ]);
    expect([c.error, d.error].filter(Boolean), "one of approve/request-changes loses").toHaveLength(1);
    expect((await svc().from("reviews").select("id").eq("manual_version_id", MV).eq("round_number", 1).eq("review_type", "TECHNICAL")).data ?? []).toHaveLength(1);
  });

  // --- two rounds ---
  it("two review rounds: resubmission re-enters TECHNICAL_REVIEW (never straight to compliance); prior round persists", { retry: 2 }, async () => {
    // round 1
    await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 0, p_content_hash: H1 });
    await reviewer.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "REQUEST_CHANGES", p_summary: "bab risiko", p_current_hash: H1 });
    expect((await mvRow()).status).toBe("CHANGES_REQUESTED");
    await dev.rpc("begin_revision", { p_manual_version_id: MV, p_expected_round: 1 });
    expect((await mvRow()).review_round, "begin_revision does not change the round").toBe(1);
    expect((await mvRow()).submitted_content_hash, "stale submitted hash is cleared").toBeNull();
    // edit content in DRAFT
    await dev.from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: coverSectionId, block_type: "text", payload: { type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: ["round 2 edit"] } }, position: 0 });
    // round 2 — a DIFFERENT hash, and it lands in TECHNICAL_REVIEW not COMPLIANCE_REVIEW
    await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 1, p_content_hash: H2 });
    const row = await mvRow();
    expect(row.status).toBe("TECHNICAL_REVIEW");
    expect(row.review_round).toBe(2);
    expect(row.submitted_content_hash).toBe(H2);
    // round 1 decision still present; round 2 has none yet
    expect((await svc().from("reviews").select("round_number, decision").eq("manual_version_id", MV).order("round_number")).data ?? []).toEqual([
      { round_number: 1, decision: "REQUEST_CHANGES" },
    ]);
    // reviewer assignments retained across the round
    expect((await mvRow()).technical_reviewer_id).toBe(REV);
  });

  // --- audit exactly once for every privileged command ---
  it("every workflow command writes exactly one audit event", { retry: 2 }, async () => {
    const step = async (label: string, fn: () => PromiseLike<{ error: unknown }>) => {
      const before = await auditCountFor();
      const r = await fn();
      expect(r.error, `${label} succeeds`).toBeNull();
      expect((await auditCountFor()) - before, `${label} -> exactly one audit event`).toBe(1);
    };
    await step("assign_reviewers", () => admin.rpc("assign_reviewers", { p_manual_version_id: MV, p_technical_reviewer_id: REV, p_compliance_reviewer_id: COMP }));
    await step("submit_for_technical_review", () => dev.rpc("submit_for_technical_review", { p_manual_version_id: MV, p_expected_round: 0, p_content_hash: H1 }));
    await step("record_technical_decision (approve)", () => reviewer.rpc("record_technical_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 }));
    await step("record_compliance_decision (request_changes)", () => compliance.rpc("record_compliance_decision", { p_manual_version_id: MV, p_expected_round: 1, p_decision: "REQUEST_CHANGES", p_summary: "revisi", p_current_hash: H1 }));
    await step("begin_revision", () => dev.rpc("begin_revision", { p_manual_version_id: MV, p_expected_round: 1 }));
  });
});

// ===========================================================================
// Phase 6 slice 3 — review comments (anchored, resolve/reopen, cross-round).
// Dedicated throwaway manual version (MV3) + a second same-org version (MV3B) + a minimal
// org-B chain, all built with the service role and dropped in afterAll. Comments are created
// only through create_review_comment / set_review_comment_resolved (SECURITY DEFINER); direct
// table writes are used only to prove the immutability + anchor guards.
// AC-P6-4 (comments) and the comment half of AC-P6-8 (cross-round).
// ===========================================================================
describe.skipIf(!HAS_SERVICE)("Phase 6 slice 3 — review comments", () => {
  const M3 = "60000000-0000-4000-8000-0000000000a3";
  const MV3 = "60000000-0000-4000-8000-0000000000b3";
  const MV3B = "60000000-0000-4000-8000-0000000000c3"; // second same-org version (cross-version anchor)
  const EAP_B = "60000000-0000-4000-8000-0000000000d3";
  const EAV_B = "60000000-0000-4000-8000-0000000000e3";
  const MID_B = "60000000-0000-4000-8000-0000000000f3";
  const MVB = "60000000-0000-4000-8000-000000000a13";
  const H1 = "3".repeat(64);
  const H2 = "4".repeat(64);
  const RANDOM_UUID = "99999999-9999-4999-8999-999999999993";

  let dev: SupabaseClient; // developer@ = DEVELOPER + TECHNICAL_REVIEWER
  let reviewer: SupabaseClient; // reviewer@ = TECHNICAL_REVIEWER only
  let compliance: SupabaseClient; // compliance@ = COMPLIANCE_REVIEWER only
  let admin: SupabaseClient; // admin@ = ADMIN (org A), never assigned as a reviewer here
  let outsider: SupabaseClient; // outsider@ = ADMIN of org B
  let anon: SupabaseClient;
  let REV = "", COMP = "", OUT = "";
  let sec3 = "", blk3a = "";
  let sec3b = "", blk3b2 = "";
  let secB = "", blkB = "";

  const svc = () => service();
  const mv3 = async () =>
    (await svc().from("manual_versions").select("status, review_round, submitted_content_hash").eq("id", MV3).single()).data!;
  const commentsOf = async (mvId: string) =>
    (await svc().from("review_comments").select("*").eq("manual_version_id", mvId).order("round_number").order("created_at")).data ?? [];
  const checklistCount = async () =>
    (await svc().from("checklist_results").select("id", { count: "exact", head: true }).eq("manual_version_id", MV3)).count ?? 0;

  const textPayload = { type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: ["x"] } };

  const toTechReview = async () => {
    const r = await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV3, p_expected_round: 0, p_content_hash: H1 });
    expect(r.error, "submit MV3 to TECHNICAL_REVIEW").toBeNull();
  };
  const toComplianceReview = async () => {
    await toTechReview();
    const r = await reviewer.rpc("record_technical_decision", { p_manual_version_id: MV3, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    expect(r.error, "technical approve -> COMPLIANCE_REVIEW").toBeNull();
  };

  beforeAll(async () => {
    dev = await signIn("developer@smartin.demo");
    reviewer = await signIn("reviewer@smartin.demo");
    compliance = await signIn("compliance@smartin.demo");
    admin = await signIn("admin@smartin.demo");
    outsider = await signIn("outsider@smartin.demo");
    anon = createClient(URL!, ANON!, { global: { fetch: boundFetch } });
    REV = (await reviewer.auth.getUser()).data.user!.id;
    COMP = (await compliance.auth.getUser()).data.user!.id;
    OUT = (await outsider.auth.getUser()).data.user!.id;

    // clean any earlier run
    for (const id of [MV3, MV3B]) await svc().from("manual_versions").delete().eq("id", id);
    await svc().from("manuals").delete().eq("id", M3);
    await svc().from("manual_versions").delete().eq("id", MVB);
    await svc().from("manuals").delete().eq("id", MID_B);
    await svc().from("ea_versions").delete().eq("id", EAV_B);
    await svc().from("ea_products").delete().eq("id", EAP_B);

    // --- org A: manual + two versions, sections + blocks ---
    await svc().from("manuals").insert({ id: M3, organization_id: ORG_A, ea_product_id: VMAX_PRODUCT, template_id: SYSTEM_TEMPLATE, locale: "id" });
    await svc().from("manual_versions").insert([
      { id: MV3, organization_id: ORG_A, manual_id: M3, ea_version_id: VMAX_EA_VERSION, version: "8.8.1", status: "DRAFT", template_id: SYSTEM_TEMPLATE, template_version: 1 },
      { id: MV3B, organization_id: ORG_A, manual_id: M3, ea_version_id: VMAX_EA_VERSION, version: "8.8.2", status: "DRAFT", template_id: SYSTEM_TEMPLATE, template_version: 1 },
    ]);
    sec3 = (await svc().from("manual_sections").insert({ organization_id: ORG_A, manual_version_id: MV3, section_key: "cover", title: "Sampul", required: true, position: 0 }).select("id").single()).data!.id as string;
    blk3a = (await svc().from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: sec3, block_type: "text", payload: textPayload, position: 0 }).select("id").single()).data!.id as string;
    sec3b = (await svc().from("manual_sections").insert({ organization_id: ORG_A, manual_version_id: MV3B, section_key: "cover", title: "Sampul B", required: true, position: 0 }).select("id").single()).data!.id as string;
    blk3b2 = (await svc().from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: sec3b, block_type: "text", payload: textPayload, position: 0 }).select("id").single()).data!.id as string;

    // --- org B: minimal chain so we have a genuine cross-org section + block ---
    await svc().from("ea_products").insert({ id: EAP_B, organization_id: ORG_B, owner_id: OUT, name: "Cmt B3 (DEMO)", slug: "cmt-b3-demo", description: "x" });
    await svc().from("ea_versions").insert({ id: EAV_B, organization_id: ORG_B, ea_product_id: EAP_B, version: "1.0.0", platform: "MT5", release_date: "2026-01-01", requirements: {}, support: {} });
    await svc().from("manuals").insert({ id: MID_B, organization_id: ORG_B, ea_product_id: EAP_B, template_id: SYSTEM_TEMPLATE, locale: "id" });
    await svc().from("manual_versions").insert({ id: MVB, organization_id: ORG_B, manual_id: MID_B, ea_version_id: EAV_B, version: "1.0.0", status: "DRAFT", template_id: SYSTEM_TEMPLATE, template_version: 1 });
    secB = (await svc().from("manual_sections").insert({ organization_id: ORG_B, manual_version_id: MVB, section_key: "cover", title: "Org B", required: true, position: 0 }).select("id").single()).data!.id as string;
    blkB = (await svc().from("manual_blocks").insert({ organization_id: ORG_B, manual_section_id: secB, block_type: "text", payload: textPayload, position: 0 }).select("id").single()).data!.id as string;
  });

  afterAll(async () => {
    await svc().from("review_comments").delete().in("manual_version_id", [MV3, MV3B, MVB]);
    for (const id of [MV3, MV3B]) await svc().from("manual_versions").delete().eq("id", id);
    await svc().from("manuals").delete().eq("id", M3);
    await svc().from("manual_versions").delete().eq("id", MVB);
    await svc().from("manuals").delete().eq("id", MID_B);
    await svc().from("ea_versions").delete().eq("id", EAV_B);
    await svc().from("ea_products").delete().eq("id", EAP_B);
    await svc().from("audit_events").delete().in("entity_id", [MV3, MV3B]);
  });

  beforeEach(async () => {
    await svc().from("review_comments").delete().eq("manual_version_id", MV3);
    await svc().from("reviews").delete().eq("manual_version_id", MV3);
    await svc().from("manual_versions").update({
      status: "DRAFT", review_round: 0, submitted_content_hash: null,
      technical_reviewer_id: REV, compliance_reviewer_id: COMP,
    }).eq("id", MV3);
  });

  // ---- §21 create technical comments; §28 no workflow side effect ----
  it("assigned technical reviewer creates manual / section / block comments in the current round; status + hash + checklist untouched", { retry: 2 }, async () => {
    await toTechReview();
    const beforeStatus = await mv3();
    const beforeChecklist = await checklistCount();

    const g = await reviewer.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: null, p_body: "  komentar umum  " });
    expect(g.error, "manual comment").toBeNull();
    const s = await reviewer.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: sec3, p_block_id: null, p_body: "komentar bab" });
    expect(s.error, "section comment").toBeNull();
    const b = await reviewer.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: blk3a, p_body: "komentar blok" });
    expect(b.error, "block comment").toBeNull();

    const rows = await commentsOf(MV3);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.round_number).toBe(1);
      expect(r.review_type).toBe("TECHNICAL");
      expect(r.author_id).toBe(REV);
      expect(r.resolved).toBe(false);
    }
    expect(rows.find((r) => r.section_id === null && r.block_id === null)!.body).toBe("komentar umum"); // trimmed
    expect(rows.some((r) => r.section_id === sec3 && r.block_id === null)).toBe(true);
    expect(rows.some((r) => r.block_id === blk3a && r.section_id === null)).toBe(true);

    const afterStatus = await mv3();
    expect(afterStatus.status).toBe(beforeStatus.status);
    expect(afterStatus.submitted_content_hash).toBe(beforeStatus.submitted_content_hash);
    expect(await checklistCount()).toBe(beforeChecklist);
  });

  // ---- §21 compliance comments ----
  it("assigned compliance reviewer creates comments once the version is in COMPLIANCE_REVIEW", { retry: 2 }, async () => {
    await toComplianceReview();
    const g = await compliance.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "COMPLIANCE", p_round: 1, p_section_id: null, p_block_id: null, p_body: "kutipan kepatuhan" });
    expect(g.error, "compliance manual comment").toBeNull();
    const s = await compliance.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "COMPLIANCE", p_round: 1, p_section_id: sec3, p_block_id: null, p_body: "bab risiko" });
    expect(s.error).toBeNull();
    const rows = await commentsOf(MV3);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.review_type).toBe("COMPLIANCE");
      expect(r.author_id).toBe(COMP);
      expect(r.round_number).toBe(1);
    }
  });

  // ---- §22 invalid anchors ----
  it("invalid anchors are rejected: unknown / other-version / cross-org section or block, and both anchors at once", { retry: 2 }, async () => {
    await toTechReview();
    const bad = (over: Record<string, unknown>) =>
      reviewer.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: null, p_body: "x", ...over });

    expect((await bad({ p_section_id: RANDOM_UUID })).error?.message, "unknown section").toMatch(/invalid anchor/i);
    expect((await bad({ p_block_id: RANDOM_UUID })).error?.message, "unknown block").toMatch(/invalid anchor/i);
    expect((await bad({ p_section_id: sec3b })).error?.message, "section from another version").toMatch(/invalid anchor/i);
    expect((await bad({ p_block_id: blk3b2 })).error?.message, "block from another version").toMatch(/invalid anchor/i);
    expect((await bad({ p_section_id: secB })).error?.message, "cross-org section").toMatch(/invalid anchor/i);
    expect((await bad({ p_block_id: blkB })).error?.message, "cross-org block").toMatch(/invalid anchor/i);
    expect((await bad({ p_section_id: sec3, p_block_id: blk3a })).error?.message, "both anchors").toMatch(/not more than one/i);
    expect(await commentsOf(MV3), "no bad comment persisted").toHaveLength(0);

    // belt-and-braces: the 001300 DB anchor trigger also rejects a forged cross-version section
    const forged = await svc().from("review_comments").insert({
      organization_id: ORG_A, manual_version_id: MV3, round_number: 1, review_type: "TECHNICAL",
      author_id: REV, section_id: sec3b, body: "forged",
    }).select("id");
    expect(forged.error?.message ?? "", "DB anchor trigger").toMatch(/not part of this manual version/i);
  });

  // ---- §23 permissions ----
  it("only the assigned reviewer of the active stage may create a comment; admin does not bypass assignment; outsider + anon rejected", { retry: 2 }, async () => {
    await toTechReview(); // technical reviewer = REV, compliance reviewer = COMP

    expect((await reviewer.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: null, p_body: "ok" })).error, "assigned technical reviewer").toBeNull();

    // dev@ HAS review:technical but is not the assigned reviewer
    expect((await dev.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: null, p_body: "x" })).error?.message).toMatch(/not the assigned technical reviewer/i);
    // compliance@ has no technical permission
    expect((await compliance.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: null, p_body: "x" })).error?.message).toMatch(/technical review permission|not the assigned/i);
    // admin@ is ADMIN but not the assigned technical reviewer -> no silent bypass
    expect((await admin.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: null, p_body: "x" })).error?.message).toMatch(/not the assigned technical reviewer/i);
    // outsider (org B admin)
    expect((await outsider.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: null, p_body: "x" })).error?.message).toMatch(/permission required|not the assigned/i);
    // anon
    expect((await anon.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: null, p_body: "x" })).error?.message).toMatch(/authentication required|permission|denied/i);

    expect(await commentsOf(MV3), "only the one valid comment persisted").toHaveLength(1);
  });

  // ---- §24 wrong state / round; type must match stage ----
  it("comment creation is rejected outside the matching review stage and on a stale round", { retry: 2 }, async () => {
    // DRAFT
    expect((await reviewer.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 0, p_section_id: null, p_block_id: null, p_body: "x" })).error?.message).toMatch(/TECHNICAL_REVIEW/i);

    await toTechReview();
    // stale round
    expect((await reviewer.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 9, p_section_id: null, p_block_id: null, p_body: "x" })).error?.message).toMatch(/stale review round/i);
    // a compliance comment while still in TECHNICAL_REVIEW
    expect((await compliance.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "COMPLIANCE", p_round: 1, p_section_id: null, p_block_id: null, p_body: "x" })).error?.message).toMatch(/COMPLIANCE_REVIEW/i);

    // COMPLIANCE_REVIEW: a technical comment is now rejected
    await reviewer.rpc("record_technical_decision", { p_manual_version_id: MV3, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    expect((await mv3()).status).toBe("COMPLIANCE_REVIEW");
    expect((await reviewer.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: null, p_body: "x" })).error?.message).toMatch(/TECHNICAL_REVIEW/i);

    // forced terminal states
    for (const st of ["CHANGES_REQUESTED", "APPROVED", "PUBLISHED", "ARCHIVED"] as const) {
      await svc().from("manual_versions").update({ status: st }).eq("id", MV3);
      expect((await reviewer.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: null, p_body: "x" })).error, `rejected in ${st}`).toBeTruthy();
      expect((await compliance.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "COMPLIANCE", p_round: 1, p_section_id: null, p_block_id: null, p_body: "x" })).error, `compliance rejected in ${st}`).toBeTruthy();
    }
    expect(await commentsOf(MV3)).toHaveLength(0);
  });

  // ---- §25 resolve / reopen; §28 no side effect ----
  it("resolve sets resolver + timestamp, reopen clears them; only the assigned reviewer of the comment type may toggle; status + hash unchanged", { retry: 2 }, async () => {
    await toTechReview();
    const before = await mv3();
    const c = await reviewer.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: sec3, p_block_id: null, p_body: "temuan" });
    const id = (c.data as { id: string }).id;

    // developer (not the assigned technical reviewer) cannot resolve a reviewer finding
    expect((await dev.rpc("set_review_comment_resolved", { p_comment_id: id, p_resolved: true })).error?.message).toMatch(/assigned technical reviewer/i);
    // compliance reviewer cannot resolve a TECHNICAL comment
    expect((await compliance.rpc("set_review_comment_resolved", { p_comment_id: id, p_resolved: true })).error?.message).toMatch(/assigned technical reviewer/i);

    const r1 = await reviewer.rpc("set_review_comment_resolved", { p_comment_id: id, p_resolved: true });
    expect(r1.error, "assigned technical reviewer resolves").toBeNull();
    let row = (await svc().from("review_comments").select("resolved, resolved_by, resolved_at").eq("id", id).single()).data!;
    expect(row.resolved).toBe(true);
    expect(row.resolved_by).toBe(REV);
    expect(row.resolved_at).not.toBeNull();

    const r2 = await reviewer.rpc("set_review_comment_resolved", { p_comment_id: id, p_resolved: false });
    expect(r2.error, "reopen").toBeNull();
    row = (await svc().from("review_comments").select("resolved, resolved_by, resolved_at").eq("id", id).single()).data!;
    expect(row.resolved).toBe(false);
    expect(row.resolved_by).toBeNull();
    expect(row.resolved_at).toBeNull();

    const after = await mv3();
    expect(after.status).toBe(before.status);
    expect(after.submitted_content_hash).toBe(before.submitted_content_hash);

    // compliance equivalent
    await reviewer.rpc("record_technical_decision", { p_manual_version_id: MV3, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    const cc = await compliance.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "COMPLIANCE", p_round: 1, p_section_id: null, p_block_id: null, p_body: "kepatuhan" });
    const cid = (cc.data as { id: string }).id;
    expect((await reviewer.rpc("set_review_comment_resolved", { p_comment_id: cid, p_resolved: true })).error?.message, "tech reviewer cannot resolve a compliance comment").toMatch(/assigned compliance reviewer/i);
    expect((await compliance.rpc("set_review_comment_resolved", { p_comment_id: cid, p_resolved: true })).error, "assigned compliance reviewer resolves").toBeNull();
    expect((await compliance.rpc("set_review_comment_resolved", { p_comment_id: cid, p_resolved: false })).error, "compliance reopen").toBeNull();
  });

  // ---- §26 body immutability ----
  it("after creation only the resolved columns may change — body / author / round / type / anchor are locked", { retry: 2 }, async () => {
    await toTechReview();
    // anchor-free so every patch below is judged by the body-immutability guard (not the anchor
    // trigger, which fires first and would mask a section/version change with its own message)
    const c = await reviewer.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: null, p_body: "asli" });
    const id = (c.data as { id: string }).id;

    for (const patch of [
      { body: "diubah" },
      { author_id: COMP },
      { round_number: 2 },
      { review_type: "COMPLIANCE" },
      { block_id: blk3a },
      { manual_version_id: MV3B },
    ] as Record<string, unknown>[]) {
      const res = await svc().from("review_comments").update(patch).eq("id", id).select("id");
      expect(res.error?.message ?? "", `blocked: ${Object.keys(patch).join(",")}`).toMatch(/immutable review evidence/i);
    }
    // resolution metadata is the one allowed mutation surface (direct service write)
    const okUpd = await svc().from("review_comments").update({ resolved: true, resolved_by: REV, resolved_at: new Date().toISOString() }).eq("id", id).select("id");
    expect(okUpd.error, "resolution columns are mutable").toBeNull();
    expect((await svc().from("review_comments").select("body").eq("id", id).single()).data!.body).toBe("asli");
  });

  // ---- §27 cross-round persistence (AC-P6-8 comment half, AC-P6-4) ----
  it("round-1 comments survive CHANGES_REQUESTED -> revision -> resubmit unchanged; round-2 comments are stored under round 2", { retry: 2 }, async () => {
    await toTechReview(); // round 1
    const c1 = await reviewer.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: sec3, p_block_id: null, p_body: "temuan ronde 1" });
    const id1 = (c1.data as { id: string }).id;
    await reviewer.rpc("set_review_comment_resolved", { p_comment_id: id1, p_resolved: true });
    const c1b = await reviewer.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: null, p_body: "belum selesai" });
    const id1b = (c1b.data as { id: string }).id;

    await reviewer.rpc("record_technical_decision", { p_manual_version_id: MV3, p_expected_round: 1, p_decision: "REQUEST_CHANGES", p_summary: "perbaiki bab", p_current_hash: H1 });
    expect((await mv3()).status).toBe("CHANGES_REQUESTED");
    await dev.rpc("begin_revision", { p_manual_version_id: MV3, p_expected_round: 1 });
    expect((await mv3()).review_round).toBe(1);
    await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV3, p_expected_round: 1, p_content_hash: H2 });
    expect((await mv3()).review_round).toBe(2);

    // round-1 comments are byte-identical, still round 1, resolved state preserved
    const r1a = (await svc().from("review_comments").select("*").eq("id", id1).single()).data!;
    expect(r1a.round_number).toBe(1);
    expect(r1a.body).toBe("temuan ronde 1");
    expect(r1a.section_id).toBe(sec3);
    expect(r1a.resolved).toBe(true);
    expect(r1a.resolved_by).toBe(REV);
    const r1b = (await svc().from("review_comments").select("round_number, resolved").eq("id", id1b).single()).data!;
    expect(r1b.round_number).toBe(1);
    expect(r1b.resolved).toBe(false);

    // a round-2 comment lands under round 2
    const c2 = await reviewer.rpc("create_review_comment", { p_manual_version_id: MV3, p_review_type: "TECHNICAL", p_round: 2, p_section_id: sec3, p_block_id: null, p_body: "temuan ronde 2" });
    expect(c2.error).toBeNull();

    const all = await commentsOf(MV3);
    expect(all.map((r) => r.round_number)).toEqual([1, 1, 2]);
    expect(all[2].body).toBe("temuan ronde 2");
  });
});

// ===========================================================================
// Phase 6 slice 4 — structured changelog (CRUD, ordering, DRAFT-only, contributor
// provenance, source-EA-version lineage guard, BREAKING impact, no workflow side effect).
// AC-P6-14. Dedicated manual version MV4 + sibling EA versions built with the service role.
// ===========================================================================
describe.skipIf(!HAS_SERVICE)("Phase 6 slice 4 — structured changelog", () => {
  const M4 = "60000000-0000-4000-8000-000000000a41";
  const MV4 = "60000000-0000-4000-8000-000000000b41";
  const EAV2 = "60000000-0000-4000-8000-000000000c41"; // 2nd VMax EA version — a VALID source
  const EAP_OTHER = "60000000-0000-4000-8000-000000000d41"; // unrelated ORG_A product
  const EAV_OTHER = "60000000-0000-4000-8000-000000000e41"; // its version — a FORGED source
  const EAP_B = "60000000-0000-4000-8000-000000000f41"; // ORG_B product
  const EAV_B = "60000000-0000-4000-8000-000000000a51"; // its version — a cross-org FORGED source
  const H = "6".repeat(64);

  let dev: SupabaseClient; // developer@ (DEVELOPER + TECHNICAL_REVIEWER)
  let reviewer: SupabaseClient; // reviewer@ (TECHNICAL_REVIEWER only)
  let outsider: SupabaseClient; // ORG_B ADMIN
  let anon: SupabaseClient;
  let DEV = "", REV = "", COMP = "", OUT = "";

  const svc = () => service();
  const mv4 = async () =>
    (await svc().from("manual_versions").select("status, review_round, submitted_content_hash").eq("id", MV4).single()).data!;
  const entries = async () =>
    (await svc().from("changelog_entries").select("id, position, entry_type, body, is_feature_change, open_position_impact, source_ea_version_id")
      .eq("manual_version_id", MV4).order("position")).data ?? [];
  const create = (c: SupabaseClient, over: Record<string, unknown> = {}) =>
    c.rpc("create_changelog_entry", {
      // MV4 is linked to VMAX_EA_VERSION → a valid same-org / same-product source (mandatory since 20260901001700)
      p_manual_version_id: MV4, p_entry_type: "ADDED", p_body: "perubahan", p_source_ea_version_id: VMAX_EA_VERSION,
      p_is_feature_change: false, p_open_position_impact: null, ...over,
    });
  const auditCount = async () =>
    (await svc().from("audit_events").select("id", { count: "exact", head: true }).eq("entity_id", MV4)).count ?? 0;

  beforeAll(async () => {
    dev = await signIn("developer@smartin.demo");
    reviewer = await signIn("reviewer@smartin.demo");
    outsider = await signIn("outsider@smartin.demo");
    anon = createClient(URL!, ANON!, { global: { fetch: boundFetch } });
    DEV = (await dev.auth.getUser()).data.user!.id;
    REV = (await reviewer.auth.getUser()).data.user!.id;
    COMP = (await (await signIn("compliance@smartin.demo")).auth.getUser()).data.user!.id;
    OUT = (await outsider.auth.getUser()).data.user!.id;

    for (const id of [MV4]) await svc().from("manual_versions").delete().eq("id", id);
    await svc().from("manuals").delete().eq("id", M4);
    for (const id of [EAV2, EAV_OTHER]) await svc().from("ea_versions").delete().eq("id", id);
    await svc().from("ea_products").delete().eq("id", EAP_OTHER);
    await svc().from("ea_versions").delete().eq("id", EAV_B);
    await svc().from("ea_products").delete().eq("id", EAP_B);

    // ORG_A: a 2nd EA version of the SAME VMax product = a valid changelog source
    await svc().from("ea_versions").insert({
      id: EAV2, organization_id: ORG_A, ea_product_id: VMAX_PRODUCT, version: "2.0.0", platform: "MT5",
      release_date: "2026-02-01", requirements: {}, support: {},
    });
    // ORG_A: an unrelated product + version = a forged source (right org, wrong lineage)
    await svc().from("ea_products").insert({ id: EAP_OTHER, organization_id: ORG_A, owner_id: DEV, name: "Other A (DEMO)", slug: "other-a-demo", description: "x" });
    await svc().from("ea_versions").insert({ id: EAV_OTHER, organization_id: ORG_A, ea_product_id: EAP_OTHER, version: "1.0.0", platform: "MT5", release_date: "2026-01-01", requirements: {}, support: {} });
    // ORG_B: product + version = a cross-org forged source
    await svc().from("ea_products").insert({ id: EAP_B, organization_id: ORG_B, owner_id: OUT, name: "B4 (DEMO)", slug: "b4-demo", description: "x" });
    await svc().from("ea_versions").insert({ id: EAV_B, organization_id: ORG_B, ea_product_id: EAP_B, version: "1.0.0", platform: "MT5", release_date: "2026-01-01", requirements: {}, support: {} });

    await svc().from("manuals").insert({ id: M4, organization_id: ORG_A, ea_product_id: VMAX_PRODUCT, template_id: SYSTEM_TEMPLATE, locale: "id" });
    await svc().from("manual_versions").insert({
      id: MV4, organization_id: ORG_A, manual_id: M4, ea_version_id: VMAX_EA_VERSION, version: "4.4.1",
      status: "DRAFT", template_id: SYSTEM_TEMPLATE, template_version: 1,
      technical_reviewer_id: REV, compliance_reviewer_id: COMP,
    });
  });

  afterAll(async () => {
    await svc().from("changelog_entries").delete().eq("manual_version_id", MV4);
    await svc().from("manual_versions").delete().eq("id", MV4);
    await svc().from("manuals").delete().eq("id", M4);
    for (const id of [EAV2, EAV_OTHER]) await svc().from("ea_versions").delete().eq("id", id);
    await svc().from("ea_products").delete().eq("id", EAP_OTHER);
    await svc().from("ea_versions").delete().eq("id", EAV_B);
    await svc().from("ea_products").delete().eq("id", EAP_B);
    await svc().from("audit_events").delete().eq("entity_id", MV4);
  });

  beforeEach(async () => {
    await svc().from("changelog_entries").delete().eq("manual_version_id", MV4);
    await svc().from("manual_version_contributors").delete().eq("manual_version_id", MV4);
    await svc().from("manual_versions").update({ status: "DRAFT", review_round: 0, submitted_content_hash: null }).eq("id", MV4);
  });

  // ---- CRUD + contiguous positions ----
  it("create / update / delete / reorder keep positions contiguous (0..n-1)", { retry: 2 }, async () => {
    const a = await create(dev, { p_body: "A" });
    const b = await create(dev, { p_body: "B" });
    const c = await create(dev, { p_body: "C" });
    expect([a, b, c].map((r) => r.error)).toEqual([null, null, null]);
    expect((await entries()).map((e) => [e.position, e.body])).toEqual([[0, "A"], [1, "B"], [2, "C"]]);

    const bId = (b.data as { id: string }).id;
    expect((await dev.rpc("update_changelog_entry", { p_id: bId, p_entry_type: "FIXED", p_body: "B2", p_source_ea_version_id: VMAX_EA_VERSION, p_is_feature_change: true, p_open_position_impact: null })).error).toBeNull();
    let rows = await entries();
    expect(rows.find((e) => e.id === bId)).toMatchObject({ entry_type: "FIXED", body: "B2", is_feature_change: true, position: 1 });

    // delete the middle -> repack to 0,1
    expect((await dev.rpc("delete_changelog_entry", { p_id: bId })).error).toBeNull();
    rows = await entries();
    expect(rows.map((e) => [e.position, e.body])).toEqual([[0, "A"], [1, "C"]]);

    // reorder [C, A]
    const ids = rows.map((e) => e.id).reverse();
    expect((await dev.rpc("reorder_changelog_entries", { p_manual_version_id: MV4, p_ordered_ids: ids })).error).toBeNull();
    expect((await entries()).map((e) => [e.position, e.body])).toEqual([[0, "C"], [1, "A"]]);
  });

  it("reorder rejects a wrong / short / duplicated id set", { retry: 2 }, async () => {
    const a = (await create(dev, { p_body: "A" })).data as { id: string };
    await create(dev, { p_body: "B" });
    expect((await dev.rpc("reorder_changelog_entries", { p_manual_version_id: MV4, p_ordered_ids: [a.id] })).error, "short list").toBeTruthy();
    expect((await dev.rpc("reorder_changelog_entries", { p_manual_version_id: MV4, p_ordered_ids: [a.id, a.id] })).error, "duplicate").toBeTruthy();
    expect((await dev.rpc("reorder_changelog_entries", { p_manual_version_id: MV4, p_ordered_ids: [a.id, "99999999-9999-4999-8999-999999999941"] })).error, "foreign id").toBeTruthy();
  });

  // ---- contributor provenance ----
  it("a changelog write records the author as a contributor; reading does not", { retry: 2 }, async () => {
    await create(dev, { p_body: "X" });
    const rows = await svc().from("manual_version_contributors").select("user_id, contribution_count").eq("manual_version_id", MV4);
    expect(rows.data).toHaveLength(1);
    expect(rows.data![0].user_id).toBe(DEV);
    // reviewer reads the changelog -> still no contributor row for reviewer
    await reviewer.from("changelog_entries").select("id").eq("manual_version_id", MV4);
    const after = await svc().from("manual_version_contributors").select("user_id").eq("manual_version_id", MV4);
    expect((after.data ?? []).map((r) => r.user_id)).toEqual([DEV]);
  });

  // ---- source EA version lineage ----
  it("source EA version must be same-org AND same EA product lineage", { retry: 2 }, async () => {
    expect((await create(dev, { p_source_ea_version_id: EAV2 })).error, "same product -> ok").toBeNull();
    expect((await create(dev, { p_source_ea_version_id: null })).error?.message, "null -> rejected (mandatory)").toMatch(/source EA version is required/i);
    expect((await create(dev, { p_source_ea_version_id: EAV_OTHER })).error?.message, "unrelated ORG_A product").toMatch(/invalid source/i);
    expect((await create(dev, { p_source_ea_version_id: EAV_B })).error?.message, "cross-org").toMatch(/invalid source/i);
  });

  // ---- BREAKING impact ----
  it("a BREAKING entry must describe the open-position impact (RPC + DB CHECK)", { retry: 2 }, async () => {
    expect((await create(dev, { p_entry_type: "BREAKING", p_body: "ubah SL", p_open_position_impact: null })).error?.message).toMatch(/open positions|impact/i);
    expect((await create(dev, { p_entry_type: "BREAKING", p_body: "ubah SL", p_open_position_impact: "   " })).error?.message).toMatch(/open positions|impact/i);
    expect((await create(dev, { p_entry_type: "BREAKING", p_body: "ubah SL", p_open_position_impact: "Tutup posisi dulu." })).error).toBeNull();
    // forged direct insert bypassing the RPC -> the DB CHECK still rejects
    const forged = await svc().from("changelog_entries").insert({
      organization_id: ORG_A, manual_version_id: MV4, position: 9, entry_type: "BREAKING", body: "x", source_ea_version_id: VMAX_EA_VERSION, open_position_impact: null,
    }).select("id");
    expect(forged.error?.code, "check_violation").toBe("23514");
  });

  // ---- permissions ----
  it("only an author may mutate the changelog; reviewer / outsider / anon and forged direct writes are rejected", { retry: 2 }, async () => {
    expect((await create(dev)).error, "developer/author").toBeNull();
    expect((await create(reviewer)).error?.message, "reviewer").toMatch(/DEVELOPER or ADMIN|forbidden/i);
    expect((await create(outsider)).error, "outsider (org B)").toBeTruthy();
    expect((await create(anon)).error, "anon").toBeTruthy();
    // no client write policy on changelog_entries
    const forged = await dev.from("changelog_entries").insert({ organization_id: ORG_A, manual_version_id: MV4, position: 5, entry_type: "ADDED", body: "forged" }).select("id");
    expect((forged.data ?? []), "direct client insert denied by RLS").toHaveLength(0);
  });

  // ---- DRAFT-only ----
  it("changelog mutation is rejected in every non-DRAFT state and allowed again after beginRevision", { retry: 2 }, async () => {
    const e = (await create(dev, { p_body: "keep" })).data as { id: string };

    await dev.rpc("submit_for_technical_review", { p_manual_version_id: MV4, p_expected_round: 0, p_content_hash: H });
    expect((await mv4()).status).toBe("TECHNICAL_REVIEW");
    expect((await create(dev, { p_body: "no" })).error?.message).toMatch(/DRAFT/i);
    expect((await dev.rpc("update_changelog_entry", { p_id: e.id, p_entry_type: "ADDED", p_body: "no", p_source_ea_version_id: null, p_is_feature_change: false, p_open_position_impact: null })).error?.message).toMatch(/DRAFT/i);
    expect((await dev.rpc("delete_changelog_entry", { p_id: e.id })).error?.message).toMatch(/DRAFT/i);
    expect((await dev.rpc("reorder_changelog_entries", { p_manual_version_id: MV4, p_ordered_ids: [e.id] })).error?.message).toMatch(/DRAFT/i);
    // forged direct write in review -> blocked (RLS has no client write policy; the DB
    // draft-guard trigger is the defence-in-depth layer behind it)
    const forged = await dev.from("changelog_entries").update({ body: "hacked" }).eq("id", e.id).select("id");
    expect(forged.error?.message ?? "", "forged direct changelog write blocked").toMatch(/permission denied|DRAFT|policy/i);

    for (const st of ["COMPLIANCE_REVIEW", "CHANGES_REQUESTED", "APPROVED"] as const) {
      await svc().from("manual_versions").update({ status: st }).eq("id", MV4);
      expect((await create(dev, { p_body: "no" })).error, `rejected in ${st}`).toBeTruthy();
    }

    // CHANGES_REQUESTED -> beginRevision -> DRAFT -> editable again
    await svc().from("manual_versions").update({ status: "CHANGES_REQUESTED", review_round: 1 }).eq("id", MV4);
    await dev.rpc("begin_revision", { p_manual_version_id: MV4, p_expected_round: 1 });
    expect((await mv4()).status).toBe("DRAFT");
    expect((await create(dev, { p_body: "revised" })).error, "editable after beginRevision").toBeNull();
  });

  // ---- no workflow side effect / no audit spam ----
  it("changelog CRUD never changes status / round / submitted_content_hash and writes no audit_events", { retry: 2 }, async () => {
    const before = await mv4();
    const auditBefore = await auditCount();
    const e = (await create(dev, { p_body: "one" })).data as { id: string };
    await dev.rpc("update_changelog_entry", { p_id: e.id, p_entry_type: "CHANGED", p_body: "two", p_source_ea_version_id: EAV2, p_is_feature_change: true, p_open_position_impact: null });
    await create(dev, { p_body: "three" });
    await dev.rpc("reorder_changelog_entries", { p_manual_version_id: MV4, p_ordered_ids: (await entries()).map((x) => x.id).reverse() });
    await dev.rpc("delete_changelog_entry", { p_id: e.id });

    const after = await mv4();
    expect(after.status).toBe(before.status);
    expect(after.review_round).toBe(before.review_round);
    expect(after.submitted_content_hash).toBe(before.submitted_content_hash);
    expect(await auditCount()).toBe(auditBefore);
  });
});

// ===========================================================================
// Phase 6 slice 5 — clone_manual_version: atomic clone + parameter-group remap by name.
// Source EA version SRC (Risk default 0.01, setup XAUUSD@M15) vs target TGT (Risk default 0.02,
// setup EURUSD.pro@H1). Proves: copied vs NOT copied, target-data ownership, missing-group
// rollback, lineage guard, concurrency, audit exactly-once. AC-P6-11.
// ===========================================================================
describe.skipIf(!HAS_SERVICE)("Phase 6 slice 5 — clone manual version", () => {
  const P = "60000000-0000-4000-8000-000000005a01"; // EA product (ORG_A)
  const SRC = "60000000-0000-4000-8000-000000005b01"; // source EA version
  const TGT = "60000000-0000-4000-8000-000000005c01"; // target EA version (same product)
  const NOGRP = "60000000-0000-4000-8000-000000005d01"; // target missing the "Trailing" group
  const PX = "60000000-0000-4000-8000-000000005e01"; // unrelated product
  const EAVX = "60000000-0000-4000-8000-000000005f01"; // its version
  const PB = "60000000-0000-4000-8000-000000005a11"; // ORG_B product
  const EAVB = "60000000-0000-4000-8000-000000005b11"; // its version
  const M5 = "60000000-0000-4000-8000-000000005c11"; // source manual
  const MV_SRC = "60000000-0000-4000-8000-000000005d11"; // source manual version
  const IMG = "60000000-0000-4000-8000-000000005e11"; // an ORG_A image asset
  const CT = "c5000000-0000-4000-8000-000000000001"; // checklist template

  let dev: SupabaseClient, reviewer: SupabaseClient, anon: SupabaseClient;
  let DEV = "", REV = "", COMP = "";
  // fixture ids captured in beforeAll
  let gSrcRisk = "", gSrcTrail = "", gTgtRisk = "", gTgtTrail = "";
  let secCover = "", secCustom = "";

  const svc = () => service();
  const clone = (c: SupabaseClient, over: Record<string, unknown> = {}) =>
    c.rpc("clone_manual_version", { p_source_manual_version_id: MV_SRC, p_target_ea_version_id: TGT, p_new_version: "2.0.0", ...over });
  const newMvByVersion = async (v: string) =>
    (await svc().from("manual_versions").select("*").eq("manual_id", M5).eq("version", v).maybeSingle()).data;

  const mkEaVersion = async (id: string, org: string, product: string, ver: string) =>
    svc().from("ea_versions").insert({ id, organization_id: org, ea_product_id: product, version: ver, platform: "MT5", release_date: "2026-01-01", requirements: {}, support: {} });
  const mkGroup = async (org: string, eav: string, name: string) =>
    (await svc().from("parameter_groups").insert({ organization_id: org, ea_version_id: eav, name, position: 0 }).select("id").single()).data!.id as string;
  const mkParam = async (org: string, group: string, tname: string, def: string) =>
    svc().from("ea_parameters").insert({ organization_id: org, parameter_group_id: group, display_name: tname, technical_name: tname, param_type: "double", default_value: def, position: 0 });

  beforeAll(async () => {
    dev = await signIn("developer@smartin.demo");
    reviewer = await signIn("reviewer@smartin.demo");
    anon = createClient(URL!, ANON!, { global: { fetch: boundFetch } });
    DEV = (await dev.auth.getUser()).data.user!.id;
    REV = (await reviewer.auth.getUser()).data.user!.id;
    COMP = (await (await signIn("compliance@smartin.demo")).auth.getUser()).data.user!.id;

    // clean earlier run
    for (const mv of [MV_SRC]) await svc().from("manual_versions").delete().eq("id", mv);
    await svc().from("manual_versions").delete().eq("manual_id", M5);
    await svc().from("manuals").delete().eq("id", M5);
    for (const id of [SRC, TGT, NOGRP, EAVX]) await svc().from("ea_versions").delete().eq("id", id);
    for (const id of [P, PX]) await svc().from("ea_products").delete().eq("id", id);
    await svc().from("ea_versions").delete().eq("id", EAVB);
    await svc().from("ea_products").delete().eq("id", PB);
    await svc().from("image_assets").delete().eq("id", IMG);

    // --- EA products + versions ---
    await svc().from("ea_products").insert({ id: P, organization_id: ORG_A, owner_id: DEV, name: "Clone Src (DEMO)", slug: "clone-src-demo", description: "x" });
    await mkEaVersion(SRC, ORG_A, P, "1.0.0");
    await mkEaVersion(TGT, ORG_A, P, "2.0.0");
    await mkEaVersion(NOGRP, ORG_A, P, "3.0.0");
    await svc().from("ea_products").insert({ id: PX, organization_id: ORG_A, owner_id: DEV, name: "Other Prod (DEMO)", slug: "other-prod-demo", description: "x" });
    await mkEaVersion(EAVX, ORG_A, PX, "1.0.0");
    await svc().from("ea_products").insert({ id: PB, organization_id: ORG_B, owner_id: COMP, name: "B5 (DEMO)", slug: "b5-demo", description: "x" });
    await mkEaVersion(EAVB, ORG_B, PB, "1.0.0");

    // --- parameter groups (same names, different UUIDs + defaults) ---
    gSrcRisk = await mkGroup(ORG_A, SRC, "Risk");
    gSrcTrail = await mkGroup(ORG_A, SRC, "Trailing");
    gTgtRisk = await mkGroup(ORG_A, TGT, "Risk");
    gTgtTrail = await mkGroup(ORG_A, TGT, "Trailing");
    await mkGroup(ORG_A, NOGRP, "Risk"); // NOGRP has Risk but NOT Trailing
    await mkParam(ORG_A, gSrcRisk, "RiskPercent", "0.01");
    await mkParam(ORG_A, gTgtRisk, "RiskPercent", "0.02");

    // --- setups (source XAUUSD@M15, target EURUSD.pro@H1) ---
    await svc().from("ea_version_setups").insert([
      { organization_id: ORG_A, ea_version_id: SRC, symbol: "XAUUSD", timeframe: "M15", preset_ref: "x.set", tested_minimum_lot: 0.01, notes: "src", is_supported: true, position: 0 },
      { organization_id: ORG_A, ea_version_id: TGT, symbol: "EURUSD.pro", timeframe: "H1", preset_ref: "y.set", tested_minimum_lot: 0.01, notes: "tgt", is_supported: true, position: 0 },
    ]);

    // --- image asset (ORG_A) ---
    await svc().from("image_assets").insert({ id: IMG, organization_id: ORG_A, owner_id: DEV, storage_key: `clone5/${IMG}.png`, mime_type: "image/png", byte_size: 1234, width: 10, height: 10 });

    // --- source manual + version linked to SRC ---
    await svc().from("manuals").insert({ id: M5, organization_id: ORG_A, ea_product_id: P, template_id: SYSTEM_TEMPLATE, locale: "id" });
    await svc().from("manual_versions").insert({
      id: MV_SRC, organization_id: ORG_A, manual_id: M5, ea_version_id: SRC, version: "1.0.0",
      status: "TECHNICAL_REVIEW", review_round: 1, submitted_content_hash: "s".repeat(64), reviewed_at: new Date().toISOString(),
      template_id: SYSTEM_TEMPLATE, template_version: 1, technical_reviewer_id: REV, compliance_reviewer_id: COMP,
    });
    secCover = (await svc().from("manual_sections").insert({ organization_id: ORG_A, manual_version_id: MV_SRC, section_key: "cover", title: "Sampul", required: true, is_custom: false, position: 0, completion_state: "complete" }).select("id").single()).data!.id as string;
    secCustom = (await svc().from("manual_sections").insert({ organization_id: ORG_A, manual_version_id: MV_SRC, section_key: "custom-tim", title: "Catatan Tim", required: false, is_custom: true, position: 1 }).select("id").single()).data!.id as string;
    const txt = { type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: ["konten sumber"] } };
    // uniform key set — PostgREST rejects a bulk insert whose objects differ in keys (PGRST102)
    const blk = (over: Record<string, unknown>) => ({
      organization_id: ORG_A, manual_section_id: secCover, image_asset_id: null,
      parameter_group_ids: [] as string[], deleted_at: null as string | null, ...over,
    });
    const ins = await svc().from("manual_blocks").insert([
      blk({ block_type: "text", payload: txt, position: 0 }),
      blk({ block_type: "steps", payload: { type: "steps", schemaVersion: 1, steps: [{ title: "L1", instruction: "x" }] }, position: 1 }),
      blk({ block_type: "parameterTable", payload: { type: "parameterTable", schemaVersion: 1, groupIds: [gSrcRisk, gSrcTrail] }, position: 2, parameter_group_ids: [gSrcRisk, gSrcTrail] }),
      blk({ block_type: "image", payload: { type: "image", schemaVersion: 1, imageAssetId: IMG, caption: "c" }, position: 3, image_asset_id: IMG }),
      blk({ block_type: "text", payload: txt, position: 4, deleted_at: new Date().toISOString() }), // soft-deleted -> NOT cloned
    ]);
    if (ins.error) throw new Error(`slice-5 fixture block insert failed: ${ins.error.message}`);
    // one row at a time — each insert's object may carry different optional keys
    await svc().from("changelog_entries").insert({ organization_id: ORG_A, manual_version_id: MV_SRC, position: 0, entry_type: "ADDED", body: "e1", source_ea_version_id: SRC, is_feature_change: true });
    await svc().from("changelog_entries").insert({ organization_id: ORG_A, manual_version_id: MV_SRC, position: 1, entry_type: "FIXED", body: "e2", source_ea_version_id: SRC });
    // review history that must NOT be cloned
    await svc().from("reviews").insert({ organization_id: ORG_A, manual_version_id: MV_SRC, round_number: 1, review_type: "TECHNICAL", reviewer_id: REV, decision: "APPROVE", summary: "", reviewed_content_hash: "s".repeat(64) });
    await svc().from("review_comments").insert({ organization_id: ORG_A, manual_version_id: MV_SRC, round_number: 1, review_type: "TECHNICAL", author_id: REV, body: "komentar sumber" });
    await svc().from("checklist_results").insert({ organization_id: ORG_A, manual_version_id: MV_SRC, checklist_template_id: CT, checklist_template_version: 1, check_key: "CHK-VERSI-MATCH", category: "identity", required: true, state: "PASS", evaluator: "system" });
    await svc().from("checklist_results").insert({ organization_id: ORG_A, manual_version_id: MV_SRC, checklist_template_id: CT, checklist_template_version: 1, check_key: "CHK-VERSI-DUA", category: "identity", required: true, state: "NOT_APPLICABLE", evaluator: "reviewer", override_actor_id: REV, override_reason: "tidak berlaku", override_at: new Date().toISOString() });
    await svc().from("ai_revisions").insert({ organization_id: ORG_A, manual_version_id: MV_SRC, operation: "improveText", input_hash: "h", status: "PROPOSAL", provider: "mock" });
  });

  afterAll(async () => {
    await svc().from("manual_versions").delete().eq("manual_id", M5);
    await svc().from("manuals").delete().eq("id", M5);
    for (const id of [SRC, TGT, NOGRP, EAVX]) await svc().from("ea_versions").delete().eq("id", id);
    for (const id of [P, PX]) await svc().from("ea_products").delete().eq("id", id);
    await svc().from("ea_versions").delete().eq("id", EAVB);
    await svc().from("ea_products").delete().eq("id", PB);
    await svc().from("image_assets").delete().eq("id", IMG);
    await svc().from("audit_events").delete().eq("organization_id", ORG_A).eq("action", "manual_version:clone");
  });

  it("happy path: fresh DRAFT linked to the target; structure + changelog copied; workflow/review/AI/checklist NOT copied; one audit row", { retry: 2 }, async () => {
    const before = (await svc().from("audit_events").select("id", { count: "exact", head: true }).eq("action", "manual_version:clone")).count ?? 0;
    const r = await clone(dev);
    expect(r.error, "clone succeeds").toBeNull();
    const nid = (r.data as { newManualVersionId: string }).newManualVersionId;

    const mv = await newMvByVersion("2.0.0");
    expect(mv, "new version row exists").toBeTruthy();
    expect(mv!.id).toBe(nid);
    expect(mv!.ea_version_id).toBe(TGT);
    expect(mv!.status).toBe("DRAFT");
    expect(mv!.review_round).toBe(0);
    expect(mv!.submitted_content_hash).toBeNull();
    expect(mv!.reviewed_at).toBeNull();
    expect(mv!.published_at).toBeNull();
    expect(mv!.technical_reviewer_id).toBeNull();
    expect(mv!.compliance_reviewer_id).toBeNull();
    expect(mv!.template_id).toBe(SYSTEM_TEMPLATE);

    // sections: same key/title/required/is_custom/position, NEW ids, completion reset
    const secs = (await svc().from("manual_sections").select("id, section_key, title, required, is_custom, position, completion_state").eq("manual_version_id", nid).order("position")).data ?? [];
    expect(secs.map((s) => [s.section_key, s.required, s.is_custom, s.position])).toEqual([
      ["cover", true, false, 0],
      ["custom-tim", false, true, 1],
    ]);
    expect(secs.every((s) => s.completion_state === "incomplete")).toBe(true);
    expect(secs.some((s) => s.id === secCover || s.id === secCustom)).toBe(false);

    // blocks: only the 4 ACTIVE ones cloned (soft-deleted text block excluded)
    const newCover = secs.find((s) => s.section_key === "cover")!.id;
    const blks = (await svc().from("manual_blocks").select("id, block_type, payload, position, image_asset_id, parameter_group_ids, deleted_at, row_version").eq("manual_section_id", newCover).order("position")).data ?? [];
    expect(blks.map((b) => b.block_type)).toEqual(["text", "steps", "parameterTable", "image"]);
    expect(blks.every((b) => b.deleted_at === null && b.row_version === 1)).toBe(true);

    // parameterTable: group ids + payload.groupIds remapped to TARGET groups
    const pt = blks.find((b) => b.block_type === "parameterTable")!;
    expect(new Set(pt.parameter_group_ids as string[])).toEqual(new Set([gTgtRisk, gTgtTrail]));
    expect(new Set((pt.payload as { groupIds: string[] }).groupIds)).toEqual(new Set([gTgtRisk, gTgtTrail]));
    // image: same asset reference (no byte copy)
    expect(blks.find((b) => b.block_type === "image")!.image_asset_id).toBe(IMG);

    // changelog: cloned, order + source_ea_version_id preserved (NOT rewritten to TGT)
    const cl = (await svc().from("changelog_entries").select("position, entry_type, body, source_ea_version_id, is_feature_change").eq("manual_version_id", nid).order("position")).data ?? [];
    expect(cl.map((e) => [e.position, e.entry_type, e.body, e.source_ea_version_id])).toEqual([
      [0, "ADDED", "e1", SRC],
      [1, "FIXED", "e2", SRC],
    ]);

    // NOT cloned
    expect((await svc().from("reviews").select("id").eq("manual_version_id", nid)).data ?? []).toHaveLength(0);
    expect((await svc().from("review_comments").select("id").eq("manual_version_id", nid)).data ?? []).toHaveLength(0);
    expect((await svc().from("checklist_results").select("id").eq("manual_version_id", nid)).data ?? []).toHaveLength(0);
    expect((await svc().from("ai_revisions").select("id").eq("manual_version_id", nid)).data ?? []).toHaveLength(0);
    expect((await svc().from("published_snapshots").select("id").eq("manual_version_id", nid)).data ?? []).toHaveLength(0);

    // contributor: exactly the clone actor
    const contribs = (await svc().from("manual_version_contributors").select("user_id").eq("manual_version_id", nid)).data ?? [];
    expect(contribs.map((c) => c.user_id)).toEqual([DEV]);

    // one clone audit row
    expect((await svc().from("audit_events").select("id", { count: "exact", head: true }).eq("action", "manual_version:clone")).count ?? 0).toBe(before + 1);

    // source unchanged
    const src = await svc().from("manual_versions").select("status, review_round").eq("id", MV_SRC).single();
    expect(src.data!.status).toBe("TECHNICAL_REVIEW");
    expect((await svc().from("reviews").select("id").eq("manual_version_id", MV_SRC)).data ?? []).toHaveLength(1);
    expect((await svc().from("checklist_results").select("id").eq("manual_version_id", MV_SRC)).data ?? []).toHaveLength(2);

    await svc().from("manual_versions").delete().eq("id", nid);
  });

  it("target data ownership: the cloned parameterTable resolves TARGET Risk (default 0.02), never source 0.01; setups follow the target", { retry: 2 }, async () => {
    const r = await clone(dev, { p_new_version: "2.1.0" });
    expect(r.error).toBeNull();
    const nid = (r.data as { newManualVersionId: string }).newManualVersionId;

    const newCover = (await svc().from("manual_sections").select("id").eq("manual_version_id", nid).eq("section_key", "cover").single()).data!.id;
    const pt = (await svc().from("manual_blocks").select("parameter_group_ids").eq("manual_section_id", newCover).eq("block_type", "parameterTable").single()).data!;
    const gids = pt.parameter_group_ids as string[];
    const params = (await svc().from("ea_parameters").select("technical_name, default_value, parameter_group_id").in("parameter_group_id", gids)).data ?? [];
    const risk = params.find((p) => p.technical_name === "RiskPercent")!;
    expect(risk.default_value).toBe("0.02"); // TARGET default — proves NO parameter copy (GI-11)
    expect(risk.parameter_group_id).toBe(gTgtRisk);

    // setups resolve from the target EA version
    const setups = (await svc().from("ea_version_setups").select("symbol, timeframe").eq("ea_version_id", TGT)).data ?? [];
    expect(setups).toEqual([{ symbol: "EURUSD.pro", timeframe: "H1" }]);

    await svc().from("manual_versions").delete().eq("id", nid);
  });

  it("atomic failure — target missing a mapped parameter group: typed error names it and NOTHING is written", { retry: 2 }, async () => {
    const r = await clone(dev, { p_target_ea_version_id: NOGRP, p_new_version: "9.9.9" });
    expect(r.error?.message ?? "", "names the missing group").toMatch(/Trailing/);
    // full rollback
    expect(await newMvByVersion("9.9.9"), "no new manual_versions row").toBeNull();
    const anyOrphan = (await svc().from("manual_sections").select("id").eq("section_key", "custom-tim").neq("manual_version_id", MV_SRC)).data ?? [];
    expect(anyOrphan, "no orphan sections").toHaveLength(0);
    expect((await svc().from("audit_events").select("id").eq("action", "manual_version:clone").filter("metadata->>newManualVersionString", "eq", "9.9.9")).data ?? []).toHaveLength(0);
  });

  it("atomic failure — invalid target lineage (unrelated product / cross-org) is rejected before any write", { retry: 2 }, async () => {
    expect((await clone(dev, { p_target_ea_version_id: EAVX, p_new_version: "8.8.8" })).error?.message).toMatch(/different EA product/i);
    expect((await clone(dev, { p_target_ea_version_id: EAVB, p_new_version: "8.8.9" })).error?.message).toMatch(/not found in this organisation|different EA product/i);
    expect(await newMvByVersion("8.8.8")).toBeNull();
    expect(await newMvByVersion("8.8.9")).toBeNull();
  });

  it("clone concurrency: two requests for the same new version — one wins, one typed conflict, one audit row", { retry: 2 }, async () => {
    const before = (await svc().from("audit_events").select("id", { count: "exact", head: true }).eq("action", "manual_version:clone")).count ?? 0;
    const [a, b] = await Promise.all([clone(dev, { p_new_version: "5.0.0" }), clone(dev, { p_new_version: "5.0.0" })]);
    const errs = [a.error, b.error].filter(Boolean);
    expect(errs, "exactly one loses").toHaveLength(1);
    expect((await svc().from("manual_versions").select("id").eq("manual_id", M5).eq("version", "5.0.0")).data ?? [], "one new version row").toHaveLength(1);
    expect(((await svc().from("audit_events").select("id", { count: "exact", head: true }).eq("action", "manual_version:clone")).count ?? 0) - before, "one clone audit").toBe(1);
    await svc().from("manual_versions").delete().eq("manual_id", M5).eq("version", "5.0.0");
  });

  it("only an author may clone; a reviewer and anon are rejected", { retry: 2 }, async () => {
    expect((await clone(reviewer, { p_new_version: "6.0.0" })).error?.message).toMatch(/DEVELOPER or ADMIN|forbidden/i);
    expect((await clone(anon, { p_new_version: "6.0.1" })).error).toBeTruthy();
    expect(await newMvByVersion("6.0.0")).toBeNull();
    expect(await newMvByVersion("6.0.1")).toBeNull();
  });
});

// ===========================================================================
// Phase 6 slice 5 (final correction) — clone integrity:
//   (1) the source MUST be the CURRENT latest Manual Version of its lineage;
//   (2) clones of one lineage are serialised by a `manuals` FOR UPDATE lock, so two concurrent
//       clones of the same latest — even with DIFFERENT requested version strings — cannot both
//       create a sibling: the loser sees a stale source and is rejected;
//   (3) the RPC resolves + returns the source result set's CHECKLIST-TEMPLATE version (distinct
//       from the manual template_version), rejects a mixed-version source, and falls back to the
//       current active checklist template when the source has no results yet.
// The application-side "fresh eval actually uses that version" behaviour is covered by the
// browser spot-check (refreshValidation is app-side and not exercised by this pure-supabase suite).
// ===========================================================================
describe.skipIf(!HAS_SERVICE)("Phase 6 slice 5 (final) — clone integrity: latest-source + checklist-template version", () => {
  const CP = "60000000-0000-4000-8000-000000006a01"; // EA product (ORG_A)
  const CSRC = "60000000-0000-4000-8000-000000006b01"; // source EA version
  const CTGT = "60000000-0000-4000-8000-000000006c01"; // target EA version (same product)
  const CM = "60000000-0000-4000-8000-000000006d01"; // manual lineage
  const CMV1 = "60000000-0000-4000-8000-000000006e01"; // older manual version (stale source)
  const CMV2 = "60000000-0000-4000-8000-000000006f01"; // latest manual version (valid source)
  const CT1 = "c5000000-0000-4000-8000-000000000001"; // system checklist template v1 (seeded, active)
  const CT2 = "c5000000-0000-4000-8000-000000000002"; // checklist template v2 (created here)

  let dev: SupabaseClient;
  let DEV = "";
  const svc = () => service();

  const cloneFrom = (source: string, over: Record<string, unknown> = {}) =>
    dev.rpc("clone_manual_version", { p_source_manual_version_id: source, p_target_ea_version_id: CTGT, p_new_version: "9.0.0", ...over });
  const childVersions = async () =>
    (await svc().from("manual_versions").select("id, version").eq("manual_id", CM).order("created_at")).data ?? [];
  const cloneAudits = async () =>
    (await svc().from("audit_events").select("id, metadata").eq("action", "manual_version:clone").eq("organization_id", ORG_A)
      .filter("metadata->>sourceManualVersionId", "in", `(${CMV1},${CMV2})`)).data ?? [];
  const dropChild = async (version: string) => { await svc().from("manual_versions").delete().eq("manual_id", CM).eq("version", version); };
  const clResult = (mv: string, tid: string, ver: number, key: string, over: Record<string, unknown> = {}) => ({
    organization_id: ORG_A, manual_version_id: mv, checklist_template_id: tid, checklist_template_version: ver,
    check_key: key, category: "identity", required: true, state: "PASS", evaluator: "system", ...over,
  });

  beforeAll(async () => {
    dev = await signIn("developer@smartin.demo");
    DEV = (await dev.auth.getUser()).data.user!.id;

    // clean any earlier run
    await svc().from("manual_versions").delete().eq("manual_id", CM);
    await svc().from("manuals").delete().eq("id", CM);
    for (const id of [CSRC, CTGT]) await svc().from("ea_versions").delete().eq("id", id);
    await svc().from("ea_products").delete().eq("id", CP);
    await svc().from("checklist_items").delete().eq("checklist_template_id", CT2);
    await svc().from("checklist_results").delete().eq("checklist_template_id", CT2);
    await svc().from("checklist_templates").delete().eq("id", CT2);

    await svc().from("ea_products").insert({ id: CP, organization_id: ORG_A, owner_id: DEV, name: "Clone Integ (DEMO)", slug: "clone-integ-demo", description: "x" });
    await svc().from("ea_versions").insert([
      { id: CSRC, organization_id: ORG_A, ea_product_id: CP, version: "1.0.0", platform: "MT5", release_date: "2026-01-01", requirements: {}, support: {} },
      { id: CTGT, organization_id: ORG_A, ea_product_id: CP, version: "2.0.0", platform: "MT5", release_date: "2026-01-01", requirements: {}, support: {} },
    ]);

    await svc().from("manuals").insert({ id: CM, organization_id: ORG_A, ea_product_id: CP, template_id: SYSTEM_TEMPLATE, locale: "id" });
    // CMV1 older, CMV2 newer — explicit created_at so "latest" (created_at desc) is deterministic
    await svc().from("manual_versions").insert([
      { id: CMV1, organization_id: ORG_A, manual_id: CM, ea_version_id: CSRC, version: "1.0.0", status: "DRAFT", template_id: SYSTEM_TEMPLATE, template_version: 1, created_at: "2026-01-01T00:00:00Z" },
      { id: CMV2, organization_id: ORG_A, manual_id: CM, ea_version_id: CSRC, version: "1.1.0", status: "DRAFT", template_id: SYSTEM_TEMPLATE, template_version: 1, created_at: "2026-02-01T00:00:00Z" },
    ]);
    for (const mv of [CMV1, CMV2]) {
      await svc().from("manual_sections").insert({ organization_id: ORG_A, manual_version_id: mv, section_key: "cover", title: "Sampul", required: true, is_custom: false, position: 0, completion_state: "complete" });
    }
    // CMV2 (the valid source) carries a v1-evaluated result set
    await svc().from("checklist_results").insert(clResult(CMV2, CT1, 1, "CHK-VERSI-MATCH"));
    await svc().from("checklist_results").insert(clResult(CMV2, CT1, 1, "CHK-VERSI-DUA", { state: "NOT_APPLICABLE", evaluator: "reviewer", override_actor_id: DEV, override_reason: "n/a", override_at: new Date().toISOString() }));

    // checklist template v2 — created inactive; individual tests flip active as needed.
    // One item so a v2 result row can satisfy checklist_results' (template_id, check_key) FK.
    await svc().from("checklist_templates").insert({ id: CT2, organization_id: null, key: "smartin-documentation-checklist", version: 2, title: "Smartin Documentation Checklist v2", is_active: false });
    await svc().from("checklist_items").insert({ checklist_template_id: CT2, check_key: "CHK-CARA-KERJA", label: "Cara kerja", category: "content", rule_key: "CHK-CARA-KERJA", position: 0 });
  });

  // Each test starts from a known state: CMV2 is the only "latest" (prune any sibling a prior
  // test or a retry created), no stray clone audits, v1 active / v2 inactive.
  beforeEach(async () => {
    await svc().from("manual_versions").delete().eq("manual_id", CM).not("version", "in", "(1.0.0,1.1.0)");
    await svc().from("audit_events").delete().eq("action", "manual_version:clone").eq("organization_id", ORG_A)
      .filter("metadata->>sourceManualVersionId", "in", `(${CMV1},${CMV2})`);
    await svc().from("checklist_templates").update({ is_active: true }).eq("id", CT1);
    await svc().from("checklist_templates").update({ is_active: false }).eq("id", CT2);
  });

  afterAll(async () => {
    await svc().from("audit_events").delete().eq("action", "manual_version:clone").eq("organization_id", ORG_A)
      .filter("metadata->>sourceManualVersionId", "in", `(${CMV1},${CMV2})`);
    await svc().from("manual_versions").delete().eq("manual_id", CM);
    await svc().from("manuals").delete().eq("id", CM);
    for (const id of [CSRC, CTGT]) await svc().from("ea_versions").delete().eq("id", id);
    await svc().from("ea_products").delete().eq("id", CP);
    await svc().from("checklist_items").delete().eq("checklist_template_id", CT2);
    await svc().from("checklist_results").delete().eq("checklist_template_id", CT2);
    await svc().from("checklist_templates").delete().eq("id", CT2);
    // safety net: restore the seeded template's active flags
    await svc().from("checklist_templates").update({ is_active: true }).eq("id", CT1);
  });

  it("rejects a stale (non-latest) source before any write; the latest source then succeeds", { retry: 2 }, async () => {
    const auditsBefore = (await cloneAudits()).length;

    // CMV1 is NOT the latest (CMV2 is) -> typed rejection, nothing written
    const stale = await cloneFrom(CMV1, { p_new_version: "9.1.0" });
    expect(stale.error?.message ?? "", "typed stale-source error").toMatch(/no longer the latest version/i);
    expect((await childVersions()).map((v) => v.version).sort(), "no new child version").toEqual(["1.0.0", "1.1.0"]);
    expect((await svc().from("manual_version_contributors").select("id").eq("manual_version_id", CMV1)).data ?? [], "no contributor on stale source").toHaveLength(0);
    expect((await cloneAudits()).length, "no clone audit for the stale attempt").toBe(auditsBefore);

    // CMV2 IS the latest -> success
    const okr = await cloneFrom(CMV2, { p_new_version: "9.1.0" });
    expect(okr.error, "latest source clones").toBeNull();
    expect((okr.data as { newVersion: string }).newVersion).toBe("9.1.0");
    expect((await childVersions()).map((v) => v.version).sort()).toEqual(["1.0.0", "1.1.0", "9.1.0"]);
    expect((await cloneAudits()).length, "exactly one new clone audit").toBe(auditsBefore + 1);

    await dropChild("9.1.0"); // reset latest = CMV2 for the remaining tests
  });

  it("serialises concurrent clones of one lineage: two requests with DIFFERENT versions -> one wins, one stale", { retry: 2 }, async () => {
    const auditsBefore = (await cloneAudits()).length;

    const [a, b] = await Promise.all([
      cloneFrom(CMV2, { p_new_version: "9.2.0" }),
      cloneFrom(CMV2, { p_new_version: "9.3.0" }),
    ]);
    const errs = [a.error, b.error].filter(Boolean);
    expect(errs, "exactly one concurrent clone loses").toHaveLength(1);
    expect(errs[0]!.message, "loser is rejected as a stale source").toMatch(/no longer the latest version/i);

    const created = (await childVersions()).map((v) => v.version).filter((v) => v === "9.2.0" || v === "9.3.0");
    expect(created, "only one sibling version created").toHaveLength(1);
    expect((await cloneAudits()).length - auditsBefore, "one clone audit event").toBe(1);

    await dropChild("9.2.0");
    await dropChild("9.3.0");
  });

  it("resolves the source result set's checklist-template version (v1) and records it in the audit", { retry: 2 }, async () => {
    const r = await cloneFrom(CMV2, { p_new_version: "9.4.0" });
    expect(r.error).toBeNull();
    const data = r.data as { sourceChecklistTemplateVersion: number; sourceChecklistTemplateId: string };
    expect(data.sourceChecklistTemplateVersion, "returns the source's v1 binding — NOT the active template").toBe(1);
    expect(data.sourceChecklistTemplateId).toBe(CT1);

    const audit = (await cloneAudits()).find((a) => (a.metadata as { newManualVersionString?: string }).newManualVersionString === "9.4.0");
    expect((audit!.metadata as { checklistTemplateVersion: number }).checklistTemplateVersion).toBe(1);

    // clone did NOT copy result states / evidence / overrides onto the new version
    const nid = (r.data as { newManualVersionId: string }).newManualVersionId;
    expect((await svc().from("checklist_results").select("id").eq("manual_version_id", nid)).data ?? [], "no checklist rows copied").toHaveLength(0);

    await dropChild("9.4.0");
  });

  it("a mixed-version source result set is a typed integrity error (before any write)", { retry: 2 }, async () => {
    const mix = await svc().from("checklist_results").insert(clResult(CMV2, CT2, 2, "CHK-CARA-KERJA", { category: "content" }));
    expect(mix.error, "v2 result row inserted").toBeNull();
    try {
      const r = await cloneFrom(CMV2, { p_new_version: "9.5.0" });
      expect(r.error?.message ?? "", "mixed checklist versions rejected").toMatch(/mixed checklist template versions/i);
      expect((await childVersions()).map((v) => v.version), "no child created").not.toContain("9.5.0");
    } finally {
      await svc().from("checklist_results").delete().eq("manual_version_id", CMV2).eq("check_key", "CHK-CARA-KERJA");
    }
  });

  it("a source with NO checklist results yet falls back to the current active checklist template version", { retry: 2 }, async () => {
    // temporarily strip CMV2's result set and make v2 the active template
    const saved = (await svc().from("checklist_results").select("*").eq("manual_version_id", CMV2)).data ?? [];
    await svc().from("checklist_results").delete().eq("manual_version_id", CMV2);
    await svc().from("checklist_templates").update({ is_active: false }).eq("id", CT1);
    await svc().from("checklist_templates").update({ is_active: true }).eq("id", CT2);
    try {
      const r = await cloneFrom(CMV2, { p_new_version: "9.6.0" });
      expect(r.error).toBeNull();
      const data = r.data as { sourceChecklistTemplateVersion: number; sourceChecklistTemplateId: string };
      expect(data.sourceChecklistTemplateVersion, "falls back to the active v2").toBe(2);
      expect(data.sourceChecklistTemplateId).toBe(CT2);
      await dropChild("9.6.0");
    } finally {
      await svc().from("checklist_templates").update({ is_active: true }).eq("id", CT1);
      await svc().from("checklist_templates").update({ is_active: false }).eq("id", CT2);
      for (const row of saved) {
        delete (row as { id?: string }).id;
        delete (row as { created_at?: string }).created_at;
        delete (row as { evaluated_at?: string }).evaluated_at;
        await svc().from("checklist_results").insert(row);
      }
    }
  });

  it("source result states are untouched by a clone (no upgrade, no override loss)", { retry: 2 }, async () => {
    const before = (await svc().from("checklist_results").select("check_key, state, checklist_template_version, override_actor_id, override_reason").eq("manual_version_id", CMV2).order("check_key")).data ?? [];
    const r = await cloneFrom(CMV2, { p_new_version: "9.7.0" });
    expect(r.error).toBeNull();
    const after = (await svc().from("checklist_results").select("check_key, state, checklist_template_version, override_actor_id, override_reason").eq("manual_version_id", CMV2).order("check_key")).data ?? [];
    expect(after, "source checklist results unchanged").toEqual(before);
    await dropChild("9.7.0");
  });
});

// ===========================================================================
// Phase 6 slice 6 — publication transaction: immutable snapshot + publish gate + archive.
// A dedicated throwaway manual version is driven to APPROVED through the REAL slice-2 workflow
// RPCs, then published via the SERVICE-ROLE-ONLY publish_manual_version RPC (the browser can
// never reach it). Proves: ADMIN-only, APPROVED-only, review-hash integrity, the persisted
// Phase 5 publish gate (required MISSING / publish-blocking WARNING / non-blocking WARNING),
// checklist result-set coherence, ONE atomic transaction with real fault-injection rollback,
// published + archived + snapshot immutability, source-drift freeze, and the archive command.
// AC-P6-2 (final 2 edges) / AC-P6-9 / AC-P6-10 / AC-P6-12.
// ===========================================================================
describe.skipIf(!HAS_SERVICE)("Phase 6 slice 6 — publication", () => {
  const PMANUAL = "60000000-0000-4000-8000-000000006301";
  const PMV = "60000000-0000-4000-8000-000000006311";
  const PMV_OTHER = "60000000-0000-4000-8000-000000006312"; // fault-injection slug squatter
  const CT1 = "c5000000-0000-4000-8000-000000000001";
  const SLUG = "slice6-pub-ea";
  const PUBVER = "9.9.6";
  const H1 = "a".repeat(64);
  const H2 = "b".repeat(64);
  // a plausible frozen render_json; its exact shape is irrelevant to the RPC (server builds the
  // real one) — what matters is that the STORED bytes round-trip to the STORED hash.
  const RJSON = {
    snapshotVersion: 1,
    public: { slug: SLUG, version: PUBVER },
    template: { id: SYSTEM_TEMPLATE, version: 1 },
    content: { sections: [{ key: "cover", blocks: [{ type: "text", position: 0 }] }], changelog: [] },
    images: {},
  };
  const SNAP = computeSnapshotHash(RJSON);

  let dev: SupabaseClient, admin: SupabaseClient, reviewer: SupabaseClient, compliance: SupabaseClient, outsider: SupabaseClient;
  let DEV = "", ADMIN = "", REV = "", COMP = "", OUT = "";
  let coverSection = "";
  let ITEMS: { check_key: string; category: string; required: boolean }[] = [];

  const svc = () => service();
  const mv = async () =>
    (await svc().from("manual_versions").select("status, review_round, submitted_content_hash, published_at, archived_at").eq("id", PMV).single()).data!;
  const snapshotRow = async () =>
    (await svc().from("published_snapshots").select("*").eq("manual_version_id", PMV).maybeSingle()).data;
  const auditCount = async (action: string) =>
    (await svc().from("audit_events").select("id", { count: "exact", head: true }).eq("entity_id", PMV).eq("action", action)).count ?? 0;

  const publish = (actorId: string, o: Partial<{ hash: string; render: unknown; snap: string; slug: string; ver: string }> = {}) =>
    svc().rpc("publish_manual_version", {
      p_manual_version_id: PMV,
      p_actor_id: actorId,
      p_expected_content_hash: o.hash ?? H1,
      p_render_json: o.render ?? RJSON,
      p_snapshot_hash: o.snap ?? SNAP,
      p_public_slug: o.slug ?? SLUG,
      p_public_version: o.ver ?? PUBVER,
    });

  // full, coherent 31-row result set on CT1 v1; `over` flips individual states
  const seedChecklist = async (over: Record<string, string> = {}) => {
    await svc().from("checklist_results").delete().eq("manual_version_id", PMV);
    for (const it of ITEMS) {
      await svc().from("checklist_results").insert({
        organization_id: ORG_A, manual_version_id: PMV, checklist_template_id: CT1, checklist_template_version: 1,
        check_key: it.check_key, category: it.category, required: it.required,
        state: over[it.check_key] ?? "PASS", evaluator: "system",
      });
    }
  };

  const driveToApproved = async () => {
    await svc().from("published_snapshots").delete().eq("manual_version_id", PMV); // survives a body-only retry
    await svc().from("reviews").delete().eq("manual_version_id", PMV);
    await svc().from("manual_versions").update({
      status: "DRAFT", review_round: 0, submitted_content_hash: null, published_at: null, archived_at: null, reviewed_at: null,
      technical_reviewer_id: REV, compliance_reviewer_id: COMP,
    }).eq("id", PMV);
    await svc().from("manual_version_contributors").delete().eq("manual_version_id", PMV);
    let r = await dev.rpc("submit_for_technical_review", { p_manual_version_id: PMV, p_expected_round: 0, p_content_hash: H1 });
    expect(r.error, "submit").toBeNull();
    r = await reviewer.rpc("record_technical_decision", { p_manual_version_id: PMV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    expect(r.error, "tech approve").toBeNull();
    r = await compliance.rpc("record_compliance_decision", { p_manual_version_id: PMV, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    expect(r.error, "compliance approve").toBeNull();
    expect((await mv()).status).toBe("APPROVED");
  };

  beforeAll(async () => {
    dev = await signIn("developer@smartin.demo");
    admin = await signIn("admin@smartin.demo");
    reviewer = await signIn("reviewer@smartin.demo");
    compliance = await signIn("compliance@smartin.demo");
    outsider = await signIn("outsider@smartin.demo");
    DEV = (await dev.auth.getUser()).data.user!.id;
    ADMIN = (await admin.auth.getUser()).data.user!.id;
    REV = (await reviewer.auth.getUser()).data.user!.id;
    COMP = (await compliance.auth.getUser()).data.user!.id;
    OUT = (await outsider.auth.getUser()).data.user!.id;

    ITEMS = ((await svc().from("checklist_items").select("check_key, category, required").eq("checklist_template_id", CT1)).data ?? []) as typeof ITEMS;
    expect(ITEMS.length, "31 v1 checklist items").toBe(31);

    // robust reset — a prior crashed run may have left PMV PUBLISHED with a snapshot (FK RESTRICT)
    await svc().from("published_snapshots").delete().in("manual_version_id", [PMV, PMV_OTHER]);
    await svc().from("published_snapshots").delete().eq("organization_id", ORG_A).eq("public_slug", SLUG);
    await svc().from("checklist_results").delete().in("manual_version_id", [PMV, PMV_OTHER]);
    await svc().from("reviews").delete().in("manual_version_id", [PMV, PMV_OTHER]);
    for (const id of [PMV, PMV_OTHER]) {
      await svc().from("manual_versions").update({ status: "DRAFT" }).eq("id", id);
      await svc().from("manual_versions").delete().eq("id", id);
    }
    await svc().from("manuals").delete().eq("id", PMANUAL);
    await svc().from("manuals").insert({ id: PMANUAL, organization_id: ORG_A, ea_product_id: VMAX_PRODUCT, template_id: SYSTEM_TEMPLATE, locale: "id" });
    await svc().from("manual_versions").insert([
      { id: PMV, organization_id: ORG_A, manual_id: PMANUAL, ea_version_id: VMAX_EA_VERSION, version: PUBVER, status: "DRAFT", template_id: SYSTEM_TEMPLATE, template_version: 1 },
      { id: PMV_OTHER, organization_id: ORG_A, manual_id: PMANUAL, ea_version_id: VMAX_EA_VERSION, version: "9.9.7", status: "DRAFT", template_id: SYSTEM_TEMPLATE, template_version: 1 },
    ]);
    coverSection = (await svc().from("manual_sections").insert({ organization_id: ORG_A, manual_version_id: PMV, section_key: "cover", title: "Sampul", required: true, is_custom: false, position: 0 }).select("id").single()).data!.id as string;
  });

  afterAll(async () => {
    await svc().from("published_snapshots").delete().in("manual_version_id", [PMV, PMV_OTHER]);
    await svc().from("published_snapshots").delete().eq("organization_id", ORG_A).eq("public_slug", SLUG);
    await svc().from("reviews").delete().eq("manual_version_id", PMV);
    await svc().from("checklist_results").delete().eq("manual_version_id", PMV);
    for (const id of [PMV, PMV_OTHER]) {
      await svc().from("manual_versions").update({ status: "DRAFT" }).eq("id", id); // clear the delete guard
      await svc().from("manual_versions").delete().eq("id", id);
    }
    await svc().from("manuals").delete().eq("id", PMANUAL);
    // `audit_events` is strictly append-only (20260901002400) — the `manual_version:publish` /
    // `:archive` rows from these runs are RETAINED DEV/QA evidence. Every count assertion below is
    // delta-based (before/after) so accumulation across runs is harmless.
  });

  beforeEach(async () => {
    await svc().from("published_snapshots").delete().in("manual_version_id", [PMV, PMV_OTHER]);
    await svc().from("published_snapshots").delete().eq("organization_id", ORG_A).eq("public_slug", SLUG);
    await svc().from("manual_blocks").delete().eq("manual_section_id", coverSection);
  });

  // ---- happy path (spec §41) ----
  it("APPROVED + clean gate -> ONE atomic publish: PUBLISHED, published_at, one snapshot, one audit, stored hash recomputes", { retry: 2 }, async () => {
    await driveToApproved();
    await seedChecklist();
    const submitted = (await mv()).submitted_content_hash;
    const pubAuditBefore = await auditCount("manual_version:publish");

    const r = await publish(ADMIN);
    expect(r.error, "admin publishes").toBeNull();
    const out = r.data as { status: string; snapshotId: string; contentHash: string; publicSlug: string; publicVersion: string };
    expect(out.status).toBe("PUBLISHED");

    const row = await mv();
    expect(row.status).toBe("PUBLISHED");
    expect(row.published_at).not.toBeNull();

    const snaps = (await svc().from("published_snapshots").select("*").eq("manual_version_id", PMV)).data ?? [];
    expect(snaps, "exactly one snapshot").toHaveLength(1);
    expect(snaps[0].content_hash).toBe(SNAP);
    expect(snaps[0].public_slug).toBe(SLUG);
    expect(snaps[0].public_version).toBe(PUBVER);
    // recompute the canonical hash FROM THE STORED render_json (AC-P6-10)
    expect(computeSnapshotHash(snaps[0].render_json)).toBe(snaps[0].content_hash);
    expect(computeSnapshotHash(snaps[0].render_json)).toBe(computeSnapshotHash(snaps[0].render_json)); // byte-stable, repeat

    expect(await auditCount("manual_version:publish"), "exactly one NEW publish audit").toBe(pubAuditBefore + 1);
    const meta = (await svc().from("audit_events").select("metadata").eq("entity_id", PMV).eq("action", "manual_version:publish").order("created_at", { ascending: false }).limit(1).single()).data!.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({ publicSlug: SLUG, publicVersion: PUBVER, contentHash: SNAP });
    expect(JSON.stringify(meta)).not.toMatch(/render_json|paragraph|blocks/i); // no snapshot body in audit

    // review history + submitted hash untouched (spec §28)
    expect((await svc().from("reviews").select("id").eq("manual_version_id", PMV)).data ?? [], "reviews unchanged").toHaveLength(2);
    expect((await mv()).submitted_content_hash).toBe(submitted);
  });

  // ---- ADMIN-only (spec §42) ----
  it("only an ADMIN may publish; a forged non-admin actor id is rejected; anon/authenticated cannot invoke the RPC", { retry: 2 }, async () => {
    await driveToApproved();
    await seedChecklist();
    for (const [who, id] of [["developer", DEV], ["technical reviewer", REV], ["compliance reviewer", COMP], ["outsider", OUT]] as const) {
      const r = await publish(id);
      expect(r.error?.message ?? "", `${who} rejected`).toMatch(/only an ADMIN/i);
    }
    // the privileged RPC is service-role-only — an authenticated client cannot execute it at all
    const forbidden = await dev.rpc("publish_manual_version", {
      p_manual_version_id: PMV, p_actor_id: ADMIN, p_expected_content_hash: H1, p_render_json: RJSON, p_snapshot_hash: SNAP, p_public_slug: SLUG, p_public_version: PUBVER,
    });
    expect(forbidden.error, "authenticated cannot call publish_manual_version").toBeTruthy();

    expect(await snapshotRow(), "no snapshot from any rejected attempt").toBeNull();
    expect((await mv()).status).toBe("APPROVED");

    expect((await publish(ADMIN)).error, "admin succeeds").toBeNull();
    expect((await mv()).status).toBe("PUBLISHED");
  });

  // ---- wrong state (spec §43) ----
  it("publish is rejected from every non-APPROVED state", { retry: 2 }, async () => {
    await seedChecklist();
    for (const st of ["DRAFT", "TECHNICAL_REVIEW", "COMPLIANCE_REVIEW", "CHANGES_REQUESTED", "PUBLISHED", "ARCHIVED"] as const) {
      await svc().from("manual_versions").update({ status: st, review_round: 1 }).eq("id", PMV);
      const r = await publish(ADMIN);
      expect(r.error?.message ?? "", `from ${st}`).toMatch(/only an APPROVED/i);
    }
    expect(await snapshotRow()).toBeNull();
    await svc().from("manual_versions").update({ status: "DRAFT", review_round: 0 }).eq("id", PMV);
  });

  // ---- approval precondition (spec §44) ----
  it("publish requires valid CURRENT-round technical + compliance approvals whose hashes match", { retry: 2 }, async () => {
    await seedChecklist();
    // (a) APPROVED-looking but no reviews rows
    await svc().from("reviews").delete().eq("manual_version_id", PMV);
    await svc().from("manual_versions").update({ status: "APPROVED", review_round: 1, submitted_content_hash: H1 }).eq("id", PMV);
    expect((await publish(ADMIN)).error?.message ?? "", "no technical approval").toMatch(/no current-round technical approval/i);

    // (b) approvals exist but only for an OLD round
    await svc().from("reviews").insert([
      { organization_id: ORG_A, manual_version_id: PMV, round_number: 1, review_type: "TECHNICAL", reviewer_id: REV, decision: "APPROVE", summary: "", reviewed_content_hash: H1 },
      { organization_id: ORG_A, manual_version_id: PMV, round_number: 1, review_type: "COMPLIANCE", reviewer_id: COMP, decision: "APPROVE", summary: "", reviewed_content_hash: H1 },
    ]);
    await svc().from("manual_versions").update({ review_round: 2 }).eq("id", PMV);
    expect((await publish(ADMIN)).error?.message ?? "", "old-round approval only").toMatch(/no current-round technical approval/i);

    // (c) current-round approvals exist but the server-computed hash disagrees
    await svc().from("manual_versions").update({ review_round: 1 }).eq("id", PMV);
    expect((await publish(ADMIN, { hash: H2 })).error?.message ?? "", "hash mismatch").toMatch(/stale content/i);

    expect(await snapshotRow()).toBeNull();
    await svc().from("reviews").delete().eq("manual_version_id", PMV);
  });

  // ---- Phase 5 publish gate: required MISSING (spec §45) ----
  it("a required in-scope MISSING checklist result blocks publish and names the blocker", { retry: 2 }, async () => {
    await driveToApproved();
    await seedChecklist({ "CHK-PARAM-COMPLETE": "MISSING" });
    const before = await auditCount("manual_version:publish");
    const r = await publish(ADMIN);
    expect(r.error?.message ?? "", "blocked").toMatch(/publication is blocked/i);
    expect(r.error?.details ?? "", "blocker key surfaced").toMatch(/CHK-PARAM-COMPLETE/);
    expect(await snapshotRow()).toBeNull();
    expect((await mv()).status).toBe("APPROVED");
    expect(await auditCount("manual_version:publish"), "no NEW publish audit").toBe(before);
  });

  // ---- Phase 5 publish gate: publish-blocking WARNING (spec §46) ----
  it("a publish-blocking WARNING (CHK-NO-PROHIBITED-CLAIMS) blocks publish", { retry: 2 }, async () => {
    await driveToApproved();
    await seedChecklist({ "CHK-NO-PROHIBITED-CLAIMS": "WARNING" });
    const r = await publish(ADMIN);
    expect(r.error?.message ?? "", "blocked").toMatch(/publication is blocked/i);
    expect(r.error?.details ?? "").toMatch(/CHK-NO-PROHIBITED-CLAIMS/);
    expect(await snapshotRow()).toBeNull();
  });

  // ---- Phase 5 publish gate: ORDINARY WARNING does NOT block (spec §47) ----
  it("a WARNING on a NON-publish-blocking item does NOT block publish", { retry: 2 }, async () => {
    await driveToApproved();
    await seedChecklist({ "CHK-CHANGELOG-VERSI": "WARNING" }); // required but publish_blocking = false
    const r = await publish(ADMIN);
    expect(r.error, "non-blocking warning still publishes").toBeNull();
    expect((await mv()).status).toBe("PUBLISHED");
  });

  // ---- result-set coherence (spec §48) ----
  it("publish is rejected when the checklist result set is incomplete or mixes template versions", { retry: 2 }, async () => {
    await driveToApproved();
    await seedChecklist();
    await svc().from("checklist_results").delete().eq("manual_version_id", PMV).eq("check_key", "CHK-INTERFACE");
    expect((await publish(ADMIN)).error?.message ?? "", "incomplete set").toMatch(/does not cover every checklist item/i);

    await seedChecklist();
    await svc().from("checklist_results").update({ checklist_template_version: 2 }).eq("manual_version_id", PMV).eq("check_key", "CHK-INTERFACE");
    expect((await publish(ADMIN)).error?.message ?? "", "mixed versions").toMatch(/mixes template versions/i);
    expect(await snapshotRow()).toBeNull();
  });

  // ---- atomic fault injection (spec §22 / §49) ----
  it("a real uniqueness failure on the snapshot INSERT rolls the WHOLE transaction back", { retry: 2 }, async () => {
    await driveToApproved();
    await seedChecklist();
    // a DIFFERENT manual version already owns (ORG_A, SLUG, PUBVER) -> our snapshot INSERT will
    // violate the (organization_id, public_slug, public_version) unique AFTER the status UPDATE
    // already ran inside the same transaction.
    await svc().from("published_snapshots").insert({
      organization_id: ORG_A, manual_version_id: PMV_OTHER, render_json: { x: 1 }, content_hash: "z".repeat(64),
      public_slug: SLUG, public_version: PUBVER,
    });
    const before = await auditCount("manual_version:publish");

    const r = await publish(ADMIN);
    expect(r.error, "publish fails on the slug/version conflict").toBeTruthy();

    const row = await mv();
    expect(row.status, "target still APPROVED (rolled back)").toBe("APPROVED");
    expect(row.published_at, "published_at still NULL").toBeNull();
    expect((await svc().from("published_snapshots").select("id").eq("manual_version_id", PMV)).data ?? [], "no target snapshot").toHaveLength(0);
    expect(await auditCount("manual_version:publish"), "no NEW target publish audit (full rollback)").toBe(before);

    await svc().from("published_snapshots").delete().eq("manual_version_id", PMV_OTHER);
  });

  // ---- published immutability + archive carve-out (spec §50) ----
  it("after publish, ordinary app writes to the frozen content are all rejected; then ADMIN archive succeeds", { retry: 2 }, async () => {
    await driveToApproved();
    await seedChecklist();
    expect((await publish(ADMIN)).error).toBeNull();

    // manual_versions: no ordinary UPDATE / DELETE
    const mvUpd = await dev.from("manual_versions").update({ version: "9.9.9" }).eq("id", PMV).select("id");
    expect((mvUpd.data ?? []).length === 0 || mvUpd.error, "mv update blocked").toBeTruthy();
    const del = await dev.from("manual_versions").delete().eq("id", PMV).select("id");
    expect((del.data ?? []).length === 0 || del.error, "mv delete blocked").toBeTruthy();

    // manual_sections / manual_blocks / changelog_entries: no insert / update / delete
    const sIns = await dev.from("manual_sections").insert({ organization_id: ORG_A, manual_version_id: PMV, section_key: "x", title: "x", position: 9 }).select("id");
    expect((sIns.data ?? []).length === 0 || sIns.error, "section insert blocked").toBeTruthy();
    const sUpd = await dev.from("manual_sections").update({ title: "hax" }).eq("id", coverSection).select("id");
    expect((sUpd.data ?? []).length === 0 || sUpd.error, "section update blocked").toBeTruthy();
    const bIns = await dev.from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: coverSection, block_type: "text", payload: {}, position: 0 }).select("id");
    expect((bIns.data ?? []).length === 0 || bIns.error, "block insert blocked").toBeTruthy();
    const clIns = await dev.from("changelog_entries").insert({ organization_id: ORG_A, manual_version_id: PMV, position: 0, entry_type: "ADDED", body: "x", source_ea_version_id: VMAX_EA_VERSION }).select("id");
    expect((clIns.data ?? []).length === 0 || clIns.error, "changelog insert blocked").toBeTruthy();

    // the controlled carve-out still works
    const arch = await svc().rpc("archive_manual_version", { p_manual_version_id: PMV, p_actor_id: ADMIN });
    expect(arch.error, "admin archive").toBeNull();
    expect((await mv()).status).toBe("ARCHIVED");
  });

  // ---- snapshot immutability (spec §51) ----
  it("published_snapshots rows reject ordinary UPDATE / DELETE and stay byte-identical", { retry: 2 }, async () => {
    await driveToApproved();
    await seedChecklist();
    expect((await publish(ADMIN)).error).toBeNull();
    const before = await snapshotRow();

    const u1 = await admin.from("published_snapshots").update({ render_json: { hacked: true } }).eq("manual_version_id", PMV).select("id");
    expect((u1.data ?? []).length === 0 || u1.error, "render_json update blocked").toBeTruthy();
    const u2 = await admin.from("published_snapshots").update({ content_hash: "0".repeat(64) }).eq("manual_version_id", PMV).select("id");
    expect((u2.data ?? []).length === 0 || u2.error, "content_hash update blocked").toBeTruthy();
    const d1 = await admin.from("published_snapshots").delete().eq("manual_version_id", PMV).select("id");
    expect((d1.data ?? []).length === 0 || d1.error, "delete blocked").toBeTruthy();

    const after = await snapshotRow();
    expect(after!.content_hash).toBe(before!.content_hash);
    expect(JSON.stringify(after!.render_json)).toBe(JSON.stringify(before!.render_json));
  });

  // ---- source drift after publish (spec §53) ----
  it("mutating a live EA fact after publish does NOT change the stored snapshot or its hash", { retry: 2 }, async () => {
    await driveToApproved();
    await seedChecklist();
    expect((await publish(ADMIN)).error).toBeNull();
    const before = await snapshotRow();

    const param = (await svc().from("ea_parameters").select("id, default_value").eq("parameter_group_id", VMAX_GROUP).limit(1).maybeSingle()).data;
    if (param) {
      await svc().from("ea_parameters").update({ default_value: "999.999" }).eq("id", param.id);
      const after = await snapshotRow();
      expect(JSON.stringify(after!.render_json), "stored render_json unchanged").toBe(JSON.stringify(before!.render_json));
      expect(after!.content_hash, "stored hash unchanged").toBe(before!.content_hash);
      expect(computeSnapshotHash(after!.render_json), "recompute from stored still matches").toBe(after!.content_hash);
      await svc().from("ea_parameters").update({ default_value: param.default_value }).eq("id", param.id); // restore
    }
  });

  // ---- archive command (spec §52) ----
  it("archive: non-admin rejected; ADMIN -> ARCHIVED + archived_at, snapshot intact, one audit; second archive rejected", { retry: 2 }, async () => {
    await driveToApproved();
    await seedChecklist();
    expect((await publish(ADMIN)).error).toBeNull();
    const snapBefore = await snapshotRow();
    const archAuditBefore = await auditCount("manual_version:archive");

    expect((await svc().rpc("archive_manual_version", { p_manual_version_id: PMV, p_actor_id: DEV })).error?.message ?? "", "non-admin").toMatch(/only an ADMIN/i);

    const a = await svc().rpc("archive_manual_version", { p_manual_version_id: PMV, p_actor_id: ADMIN });
    expect(a.error, "admin archives").toBeNull();
    const row = await mv();
    expect(row.status).toBe("ARCHIVED");
    expect(row.archived_at).not.toBeNull();

    const snapAfter = await snapshotRow();
    expect(snapAfter, "snapshot still exists").not.toBeNull();
    expect(snapAfter!.content_hash).toBe(snapBefore!.content_hash);
    expect(JSON.stringify(snapAfter!.render_json)).toBe(JSON.stringify(snapBefore!.render_json));
    expect(await auditCount("manual_version:archive"), "exactly one NEW archive audit").toBe(archAuditBefore + 1);

    expect((await svc().rpc("archive_manual_version", { p_manual_version_id: PMV, p_actor_id: ADMIN })).error?.message ?? "", "second archive").toMatch(/only a PUBLISHED/i);
    // review history untouched by archive
    expect((await svc().from("reviews").select("id").eq("manual_version_id", PMV)).data ?? []).toHaveLength(2);
  });

  // ---- the full 8-edge workflow now has real command coverage (spec §54, AC-P6-2) ----
  it("all EIGHT workflow edges execute through real server commands; forged illegal transitions are rejected", { retry: 2 }, async () => {
    const seen: string[] = [];
    await svc().from("reviews").delete().eq("manual_version_id", PMV);
    await svc().from("manual_versions").update({
      status: "DRAFT", review_round: 0, submitted_content_hash: null, published_at: null, archived_at: null, reviewed_at: null,
      technical_reviewer_id: REV, compliance_reviewer_id: COMP,
    }).eq("id", PMV);
    await svc().from("manual_version_contributors").delete().eq("manual_version_id", PMV);
    await seedChecklist();

    // 1. DRAFT -> TECHNICAL_REVIEW
    await dev.rpc("submit_for_technical_review", { p_manual_version_id: PMV, p_expected_round: 0, p_content_hash: H1 });
    seen.push("DRAFT->TECHNICAL_REVIEW=" + (await mv()).status);
    // 2. TECHNICAL_REVIEW -> CHANGES_REQUESTED
    await reviewer.rpc("record_technical_decision", { p_manual_version_id: PMV, p_expected_round: 1, p_decision: "REQUEST_CHANGES", p_summary: "perbaiki", p_current_hash: H1 });
    seen.push("TECHNICAL_REVIEW->CHANGES_REQUESTED=" + (await mv()).status);
    // 3. CHANGES_REQUESTED -> DRAFT
    await dev.rpc("begin_revision", { p_manual_version_id: PMV, p_expected_round: 1 });
    seen.push("CHANGES_REQUESTED->DRAFT=" + (await mv()).status);
    // 4. DRAFT -> TECHNICAL_REVIEW (again) then TECHNICAL_REVIEW -> COMPLIANCE_REVIEW
    await dev.rpc("submit_for_technical_review", { p_manual_version_id: PMV, p_expected_round: 1, p_content_hash: H1 });
    await reviewer.rpc("record_technical_decision", { p_manual_version_id: PMV, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    seen.push("TECHNICAL_REVIEW->COMPLIANCE_REVIEW=" + (await mv()).status);
    // 5. COMPLIANCE_REVIEW -> CHANGES_REQUESTED
    await compliance.rpc("record_compliance_decision", { p_manual_version_id: PMV, p_expected_round: 2, p_decision: "REQUEST_CHANGES", p_summary: "kutipan", p_current_hash: H1 });
    seen.push("COMPLIANCE_REVIEW->CHANGES_REQUESTED=" + (await mv()).status);
    // 6. back to DRAFT, resubmit, tech approve, COMPLIANCE_REVIEW -> APPROVED
    await dev.rpc("begin_revision", { p_manual_version_id: PMV, p_expected_round: 2 });
    await dev.rpc("submit_for_technical_review", { p_manual_version_id: PMV, p_expected_round: 2, p_content_hash: H1 });
    await reviewer.rpc("record_technical_decision", { p_manual_version_id: PMV, p_expected_round: 3, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    await compliance.rpc("record_compliance_decision", { p_manual_version_id: PMV, p_expected_round: 3, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    seen.push("COMPLIANCE_REVIEW->APPROVED=" + (await mv()).status);
    // 7. APPROVED -> PUBLISHED
    expect((await publish(ADMIN)).error, "publish edge").toBeNull();
    seen.push("APPROVED->PUBLISHED=" + (await mv()).status);
    // 8. PUBLISHED -> ARCHIVED
    await svc().rpc("archive_manual_version", { p_manual_version_id: PMV, p_actor_id: ADMIN });
    seen.push("PUBLISHED->ARCHIVED=" + (await mv()).status);

    expect(seen).toEqual([
      "DRAFT->TECHNICAL_REVIEW=TECHNICAL_REVIEW",
      "TECHNICAL_REVIEW->CHANGES_REQUESTED=CHANGES_REQUESTED",
      "CHANGES_REQUESTED->DRAFT=DRAFT",
      "TECHNICAL_REVIEW->COMPLIANCE_REVIEW=COMPLIANCE_REVIEW",
      "COMPLIANCE_REVIEW->CHANGES_REQUESTED=CHANGES_REQUESTED",
      "COMPLIANCE_REVIEW->APPROVED=APPROVED",
      "APPROVED->PUBLISHED=PUBLISHED",
      "PUBLISHED->ARCHIVED=ARCHIVED",
    ]);

    // forged illegal transitions via a direct client UPDATE are rejected by the DB guards
    const f1 = await dev.from("manual_versions").update({ status: "PUBLISHED" }).eq("id", PMV).select("id");
    expect((f1.data ?? []).length === 0 || f1.error, "forged ARCHIVED->PUBLISHED blocked").toBeTruthy();
    await svc().from("manual_versions").update({ status: "DRAFT" }).eq("id", PMV);
    const f2 = await dev.from("manual_versions").update({ status: "APPROVED" }).eq("id", PMV).select("id");
    expect((f2.data ?? []).length === 0 || f2.error, "forged DRAFT->APPROVED blocked").toBeTruthy();
  });
});

// ===========================================================================
// Phase 6 slice 7 (final gate) — review history data + the template/member audit sweep.
// A dedicated fixture is driven through TWO real review rounds (round 1: technical comments +
// Request Changes; round 2: technical Approve, compliance comment, compliance Approve, publish,
// archive) so the history query has real evidence. Then the pre-existing ADMIN-only DB mutation
// paths for `manual_templates` + `memberships` (no UI, but `*_write_admin` RLS permits a direct
// PostgREST write) are exercised and asserted to emit exactly ONE append-only audit row each
// (AC-P6-13), with `audit_events` proven append-only for every ordinary caller.
// ===========================================================================
describe.skipIf(!HAS_SERVICE)("Phase 6 slice 7 — review history + template/member audit", () => {
  // `audit_events` is strictly append-only (20260901002400) — it can never be cleaned, not even
  // by the service role. So every entity that gets audited uses a PER-RUN random id: the audit
  // rows a run leaves behind are isolated (RETAINED DEV/QA evidence) and never collide with
  // another run's assertions. The mutable entity rows themselves are still deleted in afterAll.
  let HMANUAL = "", HMV = "";
  const CT1 = "c5000000-0000-4000-8000-000000000001";
  const H = "e".repeat(64);
  const SLUG = `slice7-hist-ea-${crypto.randomUUID().slice(0, 8)}`;

  let dev: SupabaseClient, admin: SupabaseClient, reviewer: SupabaseClient, compliance: SupabaseClient, outsider: SupabaseClient, anon: SupabaseClient;
  let DEV = "", ADMIN = "", REV = "", COMP = "";
  let secCover = "", blk1 = "";
  let ITEMS: { check_key: string; category: string; required: boolean }[] = [];

  const svc = () => service();
  const mv = async () => (await svc().from("manual_versions").select("status, review_round").eq("id", HMV).single()).data!;
  const seedChecklistNA = async () => {
    await svc().from("checklist_results").delete().eq("manual_version_id", HMV);
    for (const it of ITEMS) {
      await svc().from("checklist_results").insert({
        organization_id: ORG_A, manual_version_id: HMV, checklist_template_id: CT1, checklist_template_version: 1,
        check_key: it.check_key, category: it.category, required: it.required,
        state: "NOT_APPLICABLE", evaluator: "reviewer", override_actor_id: REV, override_reason: "qa", override_at: "2026-08-01T00:00:00Z",
      });
    }
  };

  beforeAll(async () => {
    dev = await signIn("developer@smartin.demo");
    admin = await signIn("admin@smartin.demo");
    reviewer = await signIn("reviewer@smartin.demo");
    compliance = await signIn("compliance@smartin.demo");
    outsider = await signIn("outsider@smartin.demo");
    anon = createClient(URL!, ANON!, { global: { fetch: boundFetch } });
    DEV = (await dev.auth.getUser()).data.user!.id;
    ADMIN = (await admin.auth.getUser()).data.user!.id;
    REV = (await reviewer.auth.getUser()).data.user!.id;
    COMP = (await compliance.auth.getUser()).data.user!.id;
    ITEMS = ((await svc().from("checklist_items").select("check_key, category, required").eq("checklist_template_id", CT1)).data ?? []) as typeof ITEMS;

    HMANUAL = crypto.randomUUID();
    HMV = crypto.randomUUID();
    await svc().from("memberships").delete().eq("organization_id", ORG_A).eq("user_id", COMP).eq("role", "DEVELOPER");

    await svc().from("manuals").insert({ id: HMANUAL, organization_id: ORG_A, ea_product_id: VMAX_PRODUCT, template_id: SYSTEM_TEMPLATE, locale: "id" });
    await svc().from("manual_versions").insert({
      id: HMV, organization_id: ORG_A, manual_id: HMANUAL, ea_version_id: VMAX_EA_VERSION, version: "9.9.7",
      status: "DRAFT", review_round: 0, template_id: SYSTEM_TEMPLATE, template_version: 1,
      technical_reviewer_id: REV, compliance_reviewer_id: COMP,
    });
    secCover = (await svc().from("manual_sections").insert({ organization_id: ORG_A, manual_version_id: HMV, section_key: "cover", title: "Sampul", required: true, position: 0 }).select("id").single()).data!.id as string;
    blk1 = (await svc().from("manual_blocks").insert({ organization_id: ORG_A, manual_section_id: secCover, block_type: "text", payload: { type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: ["x"] } }, position: 0 }).select("id").single()).data!.id as string;
    await seedChecklistNA();
  });

  afterAll(async () => {
    await svc().from("published_snapshots").delete().eq("manual_version_id", HMV);
    await svc().from("checklist_results").delete().eq("manual_version_id", HMV);
    await svc().from("reviews").delete().eq("manual_version_id", HMV);
    await svc().from("review_comments").delete().eq("manual_version_id", HMV);
    await svc().from("manual_version_contributors").delete().eq("manual_version_id", HMV);
    await svc().from("manual_versions").update({ status: "DRAFT" }).eq("id", HMV);
    await svc().from("manual_versions").delete().eq("id", HMV);
    await svc().from("manuals").delete().eq("id", HMANUAL);
    await svc().from("memberships").delete().eq("organization_id", ORG_A).eq("user_id", COMP).eq("role", "DEVELOPER");
    // The mutable entity rows above are cleaned; their `audit_events` rows are STRICTLY APPEND-ONLY
    // (20260901002400 — not even the service role can delete them) and are RETAINED as DEV/QA
    // evidence with safe metadata (per-run random `entity_id`, so no cross-run collision).
  });

  // clean assigned DRAFT before each test / body-only retry (audit rows stay — append-only)
  beforeEach(async () => {
    await svc().from("published_snapshots").delete().eq("manual_version_id", HMV);
    await svc().from("reviews").delete().eq("manual_version_id", HMV);
    await svc().from("review_comments").delete().eq("manual_version_id", HMV);
    await svc().from("manual_version_contributors").delete().eq("manual_version_id", HMV);
    await svc().from("manual_versions").update({
      status: "DRAFT", review_round: 0, submitted_content_hash: null, published_at: null, archived_at: null, reviewed_at: null,
      technical_reviewer_id: REV, compliance_reviewer_id: COMP,
    }).eq("id", HMV);
    await svc().from("manual_blocks").update({ deleted_at: null }).eq("id", blk1);
  });

  // ---- review history data across two real rounds (AC-P6-15 evidence) ----
  it("two real review rounds produce a complete, org-scoped decision + comment history", { retry: 2 }, async () => {
    // ROUND 1 — submit, technical comments (manual + block), Request Changes
    expect((await dev.rpc("submit_for_technical_review", { p_manual_version_id: HMV, p_expected_round: 0, p_content_hash: H })).error).toBeNull();
    expect((await reviewer.rpc("create_review_comment", { p_manual_version_id: HMV, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: null, p_body: "Perlu perbaikan bab sampul." })).error).toBeNull();
    const bc = await reviewer.rpc("create_review_comment", { p_manual_version_id: HMV, p_review_type: "TECHNICAL", p_round: 1, p_section_id: null, p_block_id: blk1, p_body: "Blok ini kurang jelas." });
    expect(bc.error).toBeNull();
    expect((await reviewer.rpc("record_technical_decision", { p_manual_version_id: HMV, p_expected_round: 1, p_decision: "REQUEST_CHANGES", p_summary: "Lengkapi identitas versi pada bab sampul.", p_current_hash: H })).error).toBeNull();
    expect((await mv()).status).toBe("CHANGES_REQUESTED");

    // developer revises, soft-deletes the commented block, resubmits -> ROUND 2
    expect((await dev.rpc("begin_revision", { p_manual_version_id: HMV, p_expected_round: 1 })).error).toBeNull();
    await svc().from("manual_blocks").update({ deleted_at: new Date().toISOString() }).eq("id", blk1);
    expect((await dev.rpc("submit_for_technical_review", { p_manual_version_id: HMV, p_expected_round: 1, p_content_hash: H })).error).toBeNull();

    // ROUND 2 — technical Approve, compliance comment, compliance Approve
    expect((await reviewer.rpc("record_technical_decision", { p_manual_version_id: HMV, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H })).error).toBeNull();
    expect((await compliance.rpc("create_review_comment", { p_manual_version_id: HMV, p_review_type: "COMPLIANCE", p_round: 2, p_section_id: secCover, p_block_id: null, p_body: "Rujukan disclosure sudah memadai." })).error).toBeNull();
    expect((await compliance.rpc("record_compliance_decision", { p_manual_version_id: HMV, p_expected_round: 2, p_decision: "APPROVE", p_summary: "", p_current_hash: H })).error).toBeNull();
    expect((await mv()).status).toBe("APPROVED");

    // publish + archive so the history shows the terminal states
    expect((await svc().rpc("publish_manual_version", {
      p_manual_version_id: HMV, p_actor_id: ADMIN, p_expected_content_hash: H,
      p_render_json: { snapshotVersion: 1, public: { slug: SLUG, version: "9.9.7" }, content: {}, images: {} },
      p_snapshot_hash: "f".repeat(64), p_public_slug: SLUG, p_public_version: "9.9.7",
    })).error).toBeNull();
    expect((await svc().rpc("archive_manual_version", { p_manual_version_id: HMV, p_actor_id: ADMIN })).error).toBeNull();

    // --- history data: decisions ---
    const decisions = (await svc().from("reviews").select("round_number, review_type, decision, summary").eq("manual_version_id", HMV).order("round_number").order("review_type")).data ?? [];
    expect(decisions).toEqual([
      { round_number: 1, review_type: "TECHNICAL", decision: "REQUEST_CHANGES", summary: "Lengkapi identitas versi pada bab sampul." },
      { round_number: 2, review_type: "COMPLIANCE", decision: "APPROVE", summary: "" },
      { round_number: 2, review_type: "TECHNICAL", decision: "APPROVE", summary: "" },
    ]);

    // --- history data: comments span both rounds; round-1 comments still present; block-anchor
    //     comment survives its block being soft-deleted ---
    const comments = (await svc().from("review_comments").select("round_number, review_type, body, section_id, block_id, resolved").eq("manual_version_id", HMV).order("round_number").order("created_at")).data ?? [];
    expect(comments.map((c) => [c.round_number, c.review_type])).toEqual([
      [1, "TECHNICAL"], [1, "TECHNICAL"], [2, "COMPLIANCE"],
    ]);
    expect(comments[1].block_id, "block-anchored round-1 comment retained").toBe(blk1);
    const delBlk = (await svc().from("manual_blocks").select("deleted_at").eq("id", blk1).single()).data!;
    expect(delBlk.deleted_at, "the anchored block is soft-deleted").not.toBeNull();

    // --- org isolation: an org-B authenticated user sees no history rows ---
    expect((await outsider.from("reviews").select("id").eq("manual_version_id", HMV)).data ?? [], "org B sees no reviews").toHaveLength(0);
    expect((await outsider.from("review_comments").select("id").eq("manual_version_id", HMV)).data ?? [], "org B sees no comments").toHaveLength(0);
    expect((await outsider.from("manual_versions").select("id").eq("id", HMV)).data ?? [], "org B sees no version").toHaveLength(0);
    // --- anon denial ---
    expect((await anon.from("reviews").select("id").eq("manual_version_id", HMV)).data ?? [], "anon sees no reviews").toHaveLength(0);
    expect((await anon.from("review_comments").select("id").eq("manual_version_id", HMV)).data ?? [], "anon sees no comments").toHaveLength(0);
  });

  // ---- template mutation audit + retention after entity deletion (AC-P6-13, §10-A) ----
  it("an ADMIN's manual_templates mutation writes exactly one audit row per row-change; the audit SURVIVES deleting the template; non-admin + cross-org rejected", { retry: 2 }, async () => {
    const tplId = crypto.randomUUID();
    const tplKey = `slice7-qa-tpl-${crypto.randomUUID().slice(0, 8)}`;

    const ins = await admin.from("manual_templates").insert({ id: tplId, organization_id: ORG_A, key: tplKey, version: 1, title: "QA Template (DEV/QA evidence)", is_active: false }).select("id");
    expect(ins.error, "admin creates an org template").toBeNull();
    let audits: Record<string, unknown>[] = (await svc().from("audit_events").select("action, actor_id, entity_type, metadata, created_at").eq("entity_id", tplId).order("created_at")).data ?? [];
    expect(audits, "exactly one template:insert audit").toHaveLength(1);
    expect(audits[0].action).toBe("template:insert");
    expect(audits[0].entity_type).toBe("manual_template");
    expect(audits[0].actor_id, "actor is the authenticated admin").toBe(ADMIN);
    expect((audits[0].metadata as { templateKind: string }).templateKind).toBe("manual");
    expect(JSON.stringify(audits[0].metadata)).not.toMatch(/paragraph|render_json|section|block|token|secret/i);

    const upd = await admin.from("manual_templates").update({ is_active: true }).eq("id", tplId).select("id");
    expect(upd.error).toBeNull();
    audits = (await svc().from("audit_events").select("action").eq("entity_id", tplId).order("created_at")).data ?? [];
    expect(audits.map((a) => a.action), "one insert + one update audit").toEqual(["template:insert", "template:update"]);

    // §10-A — clean up the ENTITY via the trusted fixture path; the AUDIT ROWS MUST REMAIN.
    const del = await svc().from("manual_templates").delete().eq("id", tplId).select("id");
    expect(del.error, "service can delete the throwaway template entity").toBeNull();
    expect((await svc().from("manual_templates").select("id").eq("id", tplId)).data ?? [], "template entity gone").toHaveLength(0);
    const kept = (await svc().from("audit_events").select("action").eq("entity_id", tplId).order("created_at")).data ?? [];
    expect(kept.map((a) => a.action), "audit history survives entity deletion (no cascade)").toEqual(["template:insert", "template:update"]);

    // non-admin cannot mutate org templates (RLS)
    const devIns = await dev.from("manual_templates").insert({ organization_id: ORG_A, key: `slice7-x-${crypto.randomUUID().slice(0, 6)}`, version: 1, title: "x" }).select("id");
    expect((devIns.data ?? []).length === 0 || devIns.error, "developer cannot create a template").toBeTruthy();
    // cross-org: org-B admin cannot create an ORG_A template
    const xIns = await outsider.from("manual_templates").insert({ organization_id: ORG_A, key: `slice7-xorg-${crypto.randomUUID().slice(0, 6)}`, version: 1, title: "x" }).select("id");
    expect((xIns.data ?? []).length === 0 || xIns.error, "org B admin cannot create an ORG_A template").toBeTruthy();
  });

  // ---- member mutation audit + retention after entity deletion (AC-P6-13, §10-B, §17) ----
  it("an ADMIN's memberships mutation writes exactly one audit row per row-change (actor from auth.uid(), not forgeable); the audit SURVIVES deleting the membership; non-admin + cross-org rejected", { retry: 2 }, async () => {
    await svc().from("memberships").delete().eq("organization_id", ORG_A).eq("user_id", COMP).eq("role", "DEVELOPER");

    const ins = await admin.from("memberships").insert({ organization_id: ORG_A, user_id: COMP, role: "DEVELOPER", is_active: true }).select("id");
    expect(ins.error, "admin adds a membership row").toBeNull();
    const memId = ins.data![0].id as string; // fresh per run -> audit rows isolated by entity_id

    let audits: Record<string, unknown>[] = (await svc().from("audit_events").select("action, actor_id, entity_type, metadata").eq("entity_id", memId).order("created_at")).data ?? [];
    expect(audits, "exactly one member:insert audit").toHaveLength(1);
    expect(audits[0].action).toBe("member:insert");
    expect(audits[0].entity_type).toBe("membership");
    expect(audits[0].actor_id, "actor is the authenticated admin — no client-forgeable actor_id param").toBe(ADMIN);
    const meta = audits[0].metadata as Record<string, unknown>;
    expect(meta.targetUserId).toBe(COMP);
    expect(meta.role).toBe("DEVELOPER");
    expect(JSON.stringify(meta)).not.toMatch(/token|secret|password|apikey|paragraph|render_json/i);

    const upd = await admin.from("memberships").update({ is_active: false }).eq("id", memId).select("id");
    expect(upd.error).toBeNull();
    audits = (await svc().from("audit_events").select("action").eq("entity_id", memId).order("created_at")).data ?? [];
    expect(audits.map((a) => a.action), "one insert + one update audit").toEqual(["member:insert", "member:update"]);

    // §10-B — clean up the ENTITY via the trusted fixture path; the AUDIT ROWS MUST REMAIN.
    const del = await svc().from("memberships").delete().eq("id", memId).select("id");
    expect(del.error, "service can delete the throwaway membership entity").toBeNull();
    expect((await svc().from("memberships").select("id").eq("id", memId)).data ?? [], "membership entity gone").toHaveLength(0);
    const kept = (await svc().from("audit_events").select("action").eq("entity_id", memId).order("created_at")).data ?? [];
    expect(kept.map((a) => a.action), "audit history survives entity deletion (no cascade)").toEqual(["member:insert", "member:update"]);

    // non-admin cannot mutate memberships (RLS membership_write_admin)
    const devIns = await dev.from("memberships").insert({ organization_id: ORG_A, user_id: DEV, role: "ADMIN", is_active: true }).select("id");
    expect((devIns.data ?? []).length === 0 || devIns.error, "developer cannot grant itself ADMIN").toBeTruthy();
    // cross-org: org-B admin cannot add an ORG_A membership
    const xIns = await outsider.from("memberships").insert({ organization_id: ORG_A, user_id: COMP, role: "ADMIN", is_active: true }).select("id");
    expect((xIns.data ?? []).length === 0 || xIns.error, "org B admin cannot touch ORG_A memberships").toBeTruthy();

    await svc().from("memberships").delete().eq("organization_id", ORG_A).eq("user_id", COMP).eq("role", "DEVELOPER");
  });

  // ---- audit_events is STRICTLY append-only — no application identity, service_role included (§5/§6) ----
  it("neither an authenticated caller NOR the service_role can UPDATE or DELETE an audit_events row", { retry: 2 }, async () => {
    // a dedicated fixture audit row (INSERT still works — this is a legitimate privileged action)
    const fx = await svc().rpc("assign_reviewers", { p_manual_version_id: HMV, p_technical_reviewer_id: REV, p_compliance_reviewer_id: COMP });
    expect(fx.error, "assign_reviewers INSERTs an audit row").toBeNull();
    const row = (await svc().from("audit_events").select("id, action, metadata").eq("entity_id", HMV).eq("action", "manual_version:assign_reviewers").order("created_at", { ascending: false }).limit(1).single()).data!;
    const beforeJson = JSON.stringify(row);

    // (a) service_role — the trusted server credential — CANNOT mutate audit history
    const sUpd = await svc().from("audit_events").update({ action: "hacked" }).eq("id", row.id).select("id");
    expect(sUpd.error, "service_role UPDATE audit_events rejected").toBeTruthy();
    expect(sUpd.error!.message).toMatch(/append-only/i);
    const sDel = await svc().from("audit_events").delete().eq("id", row.id).select("id");
    expect(sDel.error, "service_role DELETE audit_events rejected").toBeTruthy();
    expect(sDel.error!.message).toMatch(/append-only/i);

    // (b) authenticated ADMIN / developer — rejected
    for (const [who, c] of [["admin", admin], ["developer", dev]] as const) {
      const u = await c.from("audit_events").update({ action: "hacked" }).eq("id", row.id).select("id");
      expect((u.data ?? []).length === 0 || u.error, `${who} cannot UPDATE audit_events`).toBeTruthy();
      const d = await c.from("audit_events").delete().eq("id", row.id).select("id");
      expect((d.data ?? []).length === 0 || d.error, `${who} cannot DELETE audit_events`).toBeTruthy();
    }
    // (c) anon — no access at all
    const aSel = await anon.from("audit_events").select("id").eq("id", row.id);
    expect(aSel.data ?? [], "anon reads no audit rows").toHaveLength(0);
    const aDel = await anon.from("audit_events").delete().eq("id", row.id).select("id");
    expect((aDel.data ?? []).length === 0 || aDel.error, "anon cannot DELETE audit_events").toBeTruthy();

    // (d) the row is byte-for-byte unchanged
    const after = (await svc().from("audit_events").select("id, action, metadata").eq("id", row.id).single()).data!;
    expect(JSON.stringify(after), "audit row byte-identical after every failed mutation").toBe(beforeJson);
  });
});

// ===========================================================================
// Phase 7 slice 1 — global public namespace + publication-safe index (20260901002500).
// The public slug is a LINEAGE identity: claimed on FIRST publication and FROZEN there even if the
// mutable EA-product slug later changes. `publish_manual_version` / `archive_manual_version` now
// also maintain `public_manuals` + `public_manual_versions` inside the SAME transaction. The index
// tables have SELECT-only grants (org-member RLS) — the ONLY writer is the publication RPC pair.
// AC-P7-2. Every fixture entity id is per-run random so retained append-only audit rows never
// collide across runs.
// ===========================================================================
describe.skipIf(!HAS_SERVICE)("Phase 7 slice 1 — global publication namespace", () => {
  const CT1 = "c5000000-0000-4000-8000-000000000001";
  const HASH = "a".repeat(64);

  let admin: SupabaseClient, outsider: SupabaseClient, anon: SupabaseClient;
  let ADMIN_A = "", ADMIN_B = "", OWNER_A = "", OWNER_B = "";
  let ITEMS: { check_key: string; category: string; required: boolean }[] = [];
  const fixtureProducts: string[] = [];
  const fixtureManuals: string[] = [];
  const fixtureMvs: string[] = [];

  const svc = () => service();

  // Build an isolated publication lineage. `opts.prod`/`opts.ver` reuse an existing EA product
  // (org A reuses the seeded VMax product — creating one needs a real profile owner id); otherwise
  // a throwaway product is created for `opts.ownerId`. Every insert is checked so a fixture failure
  // is LOUD, not a later "manual version not found".
  const mkLineage = async (
    orgId: string,
    opts: { prod?: string; ver?: string; slug?: string; ownerId?: string; versions: string[] },
  ) => {
    let prod = opts.prod;
    let ver = opts.ver;
    let slug = opts.slug ?? "";
    if (!prod) {
      prod = crypto.randomUUID();
      ver = crypto.randomUUID();
      slug = `p7-${crypto.randomUUID().slice(0, 12)}`;
      const e1 = await svc().from("ea_products").insert({ id: prod, organization_id: orgId, owner_id: opts.ownerId, name: `P7 ${slug}`, slug, description: "phase7 fixture" }).select("id").single();
      if (e1.error) throw new Error(`mkLineage ea_products: ${e1.error.message}`);
      const e2 = await svc().from("ea_versions").insert({ id: ver, organization_id: orgId, ea_product_id: prod, version: "1.0.0", platform: "MT5", release_date: "2026-01-01", requirements: {}, support: {} }).select("id").single();
      if (e2.error) throw new Error(`mkLineage ea_versions: ${e2.error.message}`);
      fixtureProducts.push(prod);
    }
    const manual = crypto.randomUUID();
    const m = await svc().from("manuals").insert({ id: manual, organization_id: orgId, ea_product_id: prod, template_id: SYSTEM_TEMPLATE, locale: "id" }).select("id").single();
    if (m.error) throw new Error(`mkLineage manuals: ${m.error.message}`);
    fixtureManuals.push(manual);
    const mvs: { id: string; version: string }[] = [];
    for (const v of opts.versions) {
      const id = crypto.randomUUID();
      const mv = await svc().from("manual_versions").insert({ id, organization_id: orgId, manual_id: manual, ea_version_id: ver, version: v, status: "DRAFT", review_round: 0, template_id: SYSTEM_TEMPLATE, template_version: 1 }).select("id").single();
      if (mv.error) throw new Error(`mkLineage manual_versions: ${mv.error.message}`);
      mvs.push({ id, version: v });
      fixtureMvs.push(id);
    }
    return { prod: prod!, slug, ver: ver!, manual, mvs };
  };

  // Force a manual version into a clean, publishable APPROVED state (bypasses the review workflow;
  // the publish RPC's own gates are exercised elsewhere). Deleting the snapshot cascades away any
  // prior `public_manual_versions` row, so this is retry-safe; a `public_manuals` claim legitimately
  // survives — it belongs to the lineage, not the version.
  const forceApproved = async (mvId: string, orgId: string, reviewerId: string) => {
    await svc().from("published_snapshots").delete().eq("manual_version_id", mvId);
    await svc().from("reviews").delete().eq("manual_version_id", mvId);
    await svc().from("checklist_results").delete().eq("manual_version_id", mvId);
    await svc().from("manual_versions").update({ status: "APPROVED", review_round: 1, submitted_content_hash: HASH, published_at: null, archived_at: null }).eq("id", mvId);
    await svc().from("reviews").insert([
      { organization_id: orgId, manual_version_id: mvId, round_number: 1, review_type: "TECHNICAL", reviewer_id: reviewerId, decision: "APPROVE", summary: "", reviewed_content_hash: HASH },
      { organization_id: orgId, manual_version_id: mvId, round_number: 1, review_type: "COMPLIANCE", reviewer_id: reviewerId, decision: "APPROVE", summary: "", reviewed_content_hash: HASH },
    ]);
    await svc().from("checklist_results").insert(ITEMS.map((it) => ({
      organization_id: orgId, manual_version_id: mvId, checklist_template_id: CT1, checklist_template_version: 1,
      check_key: it.check_key, category: it.category, required: it.required, state: "PASS", evaluator: "system",
    })));
  };

  type SnapImage = { storageKey: string; altText?: string | null; caption?: string | null };
  const rjson = (slug: string, version: string, images: SnapImage[] = []) => ({
    snapshotVersion: 2,
    public: { slug, version },
    template: { id: SYSTEM_TEMPLATE, version: 1 },
    content: {
      manual: { locale: "id" }, manualVersion: { version }, organization: { name: "Org" },
      eaProduct: { name: "P7", slug, description: "" },
      eaVersion: { version: "1.0.0", platform: "MT5", releaseDate: "2026-01-01", requirements: {}, support: {} },
      developer: null, supportedSetups: [], parameterGroups: [], sections: [], images: [], changelog: [],
    },
    images: images.map((m) => ({ storageKey: m.storageKey, altText: m.altText ?? null, caption: m.caption ?? null })),
  });
  // `o.snapSlug` / `o.snapVersion` let a test deliberately hand the RPC a render_json whose public
  // identity disagrees with `p_public_slug` / `p_public_version` (stale-snapshot / lost-race case).
  const publishRPC = (
    mvId: string,
    actorId: string,
    slug: string,
    version: string,
    o: { storageKey?: string; images?: SnapImage[]; snapSlug?: string; snapVersion?: string } = {},
  ) => {
    const imgs = o.images ?? (o.storageKey ? [{ storageKey: o.storageKey }] : []);
    const rj = rjson(o.snapSlug ?? slug, o.snapVersion ?? version, imgs);
    return svc().rpc("publish_manual_version", {
      p_manual_version_id: mvId, p_actor_id: actorId, p_expected_content_hash: HASH,
      p_render_json: rj, p_snapshot_hash: computeSnapshotHash(rj), p_public_slug: slug, p_public_version: version,
    });
  };

  const pmRow = async (slug: string) => (await svc().from("public_manuals").select("*").eq("public_slug", slug).maybeSingle()).data as Record<string, unknown> | null;
  const pmvRows = async (pmId: string) => ((await svc().from("public_manual_versions").select("*").eq("public_manual_id", pmId).order("published_at")).data ?? []) as Record<string, unknown>[];
  const snapRow = async (mvId: string) => (await svc().from("published_snapshots").select("*").eq("manual_version_id", mvId).maybeSingle()).data as Record<string, unknown> | null;
  const pubAudit = async (mvId: string) => (await svc().from("audit_events").select("id", { count: "exact", head: true }).eq("entity_id", mvId).eq("action", "manual_version:publish")).count ?? 0;
  const archiveAudit = async (mvId: string) => (await svc().from("audit_events").select("id", { count: "exact", head: true }).eq("entity_id", mvId).eq("action", "manual_version:archive")).count ?? 0;

  const VMAX = { prod: VMAX_PRODUCT, ver: VMAX_EA_VERSION };
  // Every test builds its OWN fresh lineage(s): a lineage's public slug is claimed permanently on
  // first publication, so "first publication" assertions must never reuse a lineage across retries.

  beforeAll(async () => {
    admin = await signIn("admin@smartin.demo");
    outsider = await signIn("outsider@smartin.demo");
    anon = createClient(URL!, ANON!, { global: { fetch: boundFetch } });
    ADMIN_A = (await admin.auth.getUser()).data.user!.id;
    ADMIN_B = (await outsider.auth.getUser()).data.user!.id;
    OWNER_B = ADMIN_B; // outsider owns the throwaway org-B product
    const profs = (await svc().from("profiles").select("id, email")).data ?? [];
    OWNER_A = (profs.find((p) => p.email === "developer@smartin.demo")?.id as string) ?? "";
    expect(OWNER_A, "org-A product owner profile").toBeTruthy();
    ITEMS = ((await svc().from("checklist_items").select("check_key, category, required").eq("checklist_template_id", CT1)).data ?? []) as typeof ITEMS;
    expect(ITEMS.length, "checklist template CT1 loaded").toBeGreaterThan(0);
  });

  afterAll(async () => {
    // bulk + fault-tolerant: a transient network error on one row must not strand the rest.
    const tryOp = async (fn: () => PromiseLike<unknown>) => { try { await fn(); } catch { /* best effort */ } };
    if (fixtureMvs.length) {
      await tryOp(() => svc().from("published_snapshots").delete().in("manual_version_id", fixtureMvs));
      await tryOp(() => svc().from("manual_versions").update({ status: "DRAFT" }).in("id", fixtureMvs));
      await tryOp(() => svc().from("manual_versions").delete().in("id", fixtureMvs));
    }
    for (const id of fixtureManuals) await tryOp(() => svc().from("manuals").delete().eq("id", id)); // cascades public_manuals
    for (const p of fixtureProducts) await tryOp(() => svc().from("ea_products").delete().eq("id", p));
    // append-only `audit_events` rows (per-run random entity ids) are retained DEV/QA evidence.
  });

  // resolve the frozen slug the way the trusted server action does (pre-read the index)
  const frozenSlug = async (orgId: string, manualId: string, fallback: string) =>
    ((await svc().from("public_manuals").select("public_slug").eq("organization_id", orgId).eq("manual_id", manualId).maybeSingle()).data?.public_slug as string | undefined) ?? fallback;

  // -------------------------------------------------------------------------
  it("EA-product rename: public_manuals + published_snapshots + render_json.public.slug + audit + RPC return all stay coherent under the FROZEN slug", { retry: 2 }, async () => {
    // throwaway ORG-A product so the real rename is isolated
    const L = await mkLineage(ORG_A, { ownerId: OWNER_A, versions: ["1.0.0", "2.0.0"] });
    const [mv1, mv2] = L.mvs;
    const alpha = L.slug; // the product's real slug at first publication

    await forceApproved(mv1.id, ORG_A, ADMIN_A);
    const r1 = await publishRPC(mv1.id, ADMIN_A, alpha, "1.0.0");
    expect(r1.error, "v1 publishes").toBeNull();
    expect((r1.data as { publicSlug: string }).publicSlug).toBe(alpha);

    // RENAME the EA product with the real column semantics (updateEaProduct recomputes slug)
    const beta = `p7-beta-${crypto.randomUUID().slice(0, 8)}`;
    expect((await svc().from("ea_products").update({ slug: beta }).eq("id", L.prod).select("id")).error, "rename ea_products.slug").toBeNull();

    // the server action pre-resolves the frozen slug from the index -> passes `alpha`, not `beta`
    await forceApproved(mv2.id, ORG_A, ADMIN_A);
    const slugForSnapshot = await frozenSlug(ORG_A, L.manual, beta);
    expect(slugForSnapshot, "pre-resolved slug is the frozen one").toBe(alpha);
    const r2 = await publishRPC(mv2.id, ADMIN_A, slugForSnapshot, "2.0.0");
    expect(r2.error, "v2 publishes").toBeNull();

    // ---- full coherence: everything agrees on `alpha` ----
    expect((r2.data as { publicSlug: string }).publicSlug, "RPC return publicSlug").toBe(alpha);
    const pm = await pmRow(alpha);
    expect(pm!.public_slug, "public_manuals.public_slug").toBe(alpha);
    expect(pm!.manual_id).toBe(L.manual);
    expect(await pmRow(beta), "nothing under the renamed slug").toBeNull();

    for (const [mv, ver] of [[mv1, "1.0.0"], [mv2, "2.0.0"]] as const) {
      const s = await snapRow(mv.id);
      expect(s!.public_slug, `published_snapshots.public_slug ${ver}`).toBe(alpha);
      expect((s!.render_json as { public?: { slug?: string; version?: string } }).public?.slug, `render_json.public.slug ${ver}`).toBe(alpha);
      expect((s!.render_json as { public?: { version?: string } }).public?.version, `render_json.public.version ${ver}`).toBe(ver);
      expect(computeSnapshotHash(s!.render_json as Record<string, unknown>), `hash ${ver}`).toBe(s!.content_hash);
      const meta = (await svc().from("audit_events").select("metadata").eq("entity_id", mv.id).eq("action", "manual_version:publish").order("created_at", { ascending: false }).limit(1).single()).data!.metadata as Record<string, unknown>;
      expect(meta.publicSlug, `audit metadata publicSlug ${ver}`).toBe(alpha);
    }

    const versions = await pmvRows(pm!.id as string);
    expect(versions.map((v) => v.public_version).sort()).toEqual(["1.0.0", "2.0.0"]);
    expect(versions.every((v) => v.publication_state === "PUBLISHED"), "both index rows PUBLISHED").toBe(true);
  });

  // -------------------------------------------------------------------------
  it("RPC identity guard: a render_json whose public slug / version disagrees with the frozen lineage identity is rejected and rolls back; a rebuilt snapshot with the frozen slug then succeeds", { retry: 2 }, async () => {
    const L = await mkLineage(ORG_A, { ownerId: OWNER_A, versions: ["1.0.0", "2.0.0"] });
    const [mv1, mv2] = L.mvs;
    const frozen = L.slug;

    await forceApproved(mv1.id, ORG_A, ADMIN_A);
    expect((await publishRPC(mv1.id, ADMIN_A, frozen, "1.0.0")).error, "v1 claims the slug").toBeNull();

    await forceApproved(mv2.id, ORG_A, ADMIN_A);
    const auditBefore = await pubAudit(mv2.id);

    // (a) stale snapshot slug — render_json.public.slug says a different slug than the frozen one
    const bad1 = await publishRPC(mv2.id, ADMIN_A, frozen, "2.0.0", { snapSlug: `p7-stale-${crypto.randomUUID().slice(0, 8)}` });
    expect(bad1.error?.message ?? "", "stale snapshot slug rejected").toMatch(/stale content/i);

    // (b) stale snapshot version — render_json.public.version != the actual manual version
    const bad2 = await publishRPC(mv2.id, ADMIN_A, frozen, "2.0.0", { snapVersion: "9.9.9" });
    expect(bad2.error?.message ?? "", "stale snapshot version rejected").toMatch(/stale content/i);

    // (c) publish version != the locked manual_versions.version
    const bad3 = await publishRPC(mv2.id, ADMIN_A, frozen, "9.9.9");
    expect(bad3.error?.message ?? "", "wrong publish version rejected").toMatch(/stale content/i);

    // every rejected attempt rolled back fully
    expect((await svc().from("manual_versions").select("status").eq("id", mv2.id).single()).data!.status, "still APPROVED").toBe("APPROVED");
    expect(await snapRow(mv2.id), "no snapshot from a rejected attempt").toBeNull();
    expect(await pubAudit(mv2.id), "no publish audit from a rejected attempt").toBe(auditBefore);
    const pm = await pmRow(frozen);
    expect((await pmvRows(pm!.id as string)).length, "only v1 indexed").toBe(1);

    // rebuilt snapshot with the frozen slug + correct version -> succeeds
    const good = await publishRPC(mv2.id, ADMIN_A, frozen, "2.0.0");
    expect(good.error, "rebuilt snapshot publishes").toBeNull();
    expect((good.data as { publicSlug: string }).publicSlug).toBe(frozen);
    expect((await pmvRows(pm!.id as string)).length, "now v1 + v2 indexed").toBe(2);
  });

  // -------------------------------------------------------------------------
  it("a PUBLISHED version resolves through the index only; anon + cross-org have no DB access; every direct index write is rejected", { retry: 2 }, async () => {
    const L2 = await mkLineage(ORG_A, { ...VMAX, versions: ["1.0.0"] });
    const mv = L2.mvs[0];
    await forceApproved(mv.id, ORG_A, ADMIN_A);
    const claimed = `p7-pub-${crypto.randomUUID().slice(0, 8)}`;
    expect((await publishRPC(mv.id, ADMIN_A, claimed, "1.0.0")).error).toBeNull();

    const pm = await pmRow(claimed);
    const [v] = await pmvRows(pm!.id as string);
    expect(v.publication_state).toBe("PUBLISHED");
    expect(v.published_at).toBeTruthy();
    expect(v.archived_at).toBeNull();

    // slug -> public_manuals -> public_manual_versions -> published_snapshots (the ONLY public path)
    const snap = (await svc().from("published_snapshots").select("render_json, content_hash").eq("id", v.published_snapshot_id as string).single()).data!;
    expect(computeSnapshotHash(snap.render_json as Record<string, unknown>), "stored snapshot re-verifies").toBe(snap.content_hash);

    // anon: nothing on any of the three tables
    expect((await anon.from("public_manuals").select("id").eq("public_slug", claimed)).data ?? [], "anon public_manuals").toHaveLength(0);
    expect((await anon.from("public_manual_versions").select("id").eq("public_manual_id", pm!.id as string)).data ?? [], "anon public_manual_versions").toHaveLength(0);
    expect((await anon.from("published_snapshots").select("id").eq("id", v.published_snapshot_id as string)).data ?? [], "anon published_snapshots").toHaveLength(0);
    // org-B authenticated user: org-scoped RLS hides it
    expect((await outsider.from("public_manuals").select("id").eq("public_slug", claimed)).data ?? [], "org B public_manuals").toHaveLength(0);

    // direct service_role writes to the index are all rejected (SELECT-only grant); RPC is sole writer
    const iIns = await svc().from("public_manuals").insert({ public_slug: `x-${crypto.randomUUID().slice(0, 8)}`, organization_id: ORG_A, manual_id: L2.manual }).select("id");
    expect((iIns.data ?? []).length === 0 || iIns.error, "direct public_manuals INSERT rejected").toBeTruthy();
    const vUpd = await svc().from("public_manual_versions").update({ publication_state: "ARCHIVED" }).eq("id", v.id as string).select("id");
    expect((vUpd.data ?? []).length === 0 || vUpd.error, "direct public_manual_versions UPDATE rejected").toBeTruthy();
    const vDel = await svc().from("public_manual_versions").delete().eq("id", v.id as string).select("id");
    expect((vDel.data ?? []).length === 0 || vDel.error, "direct public_manual_versions DELETE rejected").toBeTruthy();
    const mDel = await svc().from("public_manuals").delete().eq("id", pm!.id as string).select("id");
    expect((mDel.data ?? []).length === 0 || mDel.error, "direct public_manuals DELETE rejected").toBeTruthy();

    const [again] = await pmvRows(pm!.id as string);
    expect(again.publication_state, "index row untouched by rejected writes").toBe("PUBLISHED");
  });

  // -------------------------------------------------------------------------
  it("archive flips exactly its own public index row to ARCHIVED (with archived_at) and leaves sibling versions PUBLISHED; snapshot bytes unchanged", { retry: 2 }, async () => {
    const L1 = await mkLineage(ORG_A, { ...VMAX, versions: ["1.0.0", "2.0.0"] });
    const [mv1, mv2] = L1.mvs;
    const claimed = `p7-arch-${crypto.randomUUID().slice(0, 8)}`;
    for (const [mv, ver] of [[mv1, "1.0.0"], [mv2, "2.0.0"]] as const) {
      await forceApproved(mv.id, ORG_A, ADMIN_A);
      expect((await publishRPC(mv.id, ADMIN_A, claimed, ver)).error, `re-publish ${ver}`).toBeNull();
    }
    const pm = await pmRow(claimed);
    const archBefore = await archiveAudit(mv1.id);

    const a = await svc().rpc("archive_manual_version", { p_manual_version_id: mv1.id, p_actor_id: ADMIN_A });
    expect(a.error, "admin archives v1").toBeNull();

    const rows = await pmvRows(pm!.id as string);
    const byVer = Object.fromEntries(rows.map((r) => [r.public_version, r]));
    expect(byVer["1.0.0"].publication_state).toBe("ARCHIVED");
    expect(byVer["1.0.0"].archived_at, "archived_at set").toBeTruthy();
    expect(byVer["2.0.0"].publication_state, "sibling stays PUBLISHED").toBe("PUBLISHED");

    const s = await snapRow(mv1.id);
    expect(computeSnapshotHash(s!.render_json as Record<string, unknown>), "archived snapshot still verifies").toBe(s!.content_hash);
    expect(await archiveAudit(mv1.id), "exactly one NEW archive audit").toBe(archBefore + 1);
  });

  // -------------------------------------------------------------------------
  it("a second organisation cannot claim a public slug already owned by another org's lineage; the loser rolls back completely", { retry: 2 }, async () => {
    const slug = `p7-collide-${crypto.randomUUID().slice(0, 8)}`;
    const la = await mkLineage(ORG_A, { ...VMAX, versions: ["1.0.0"] });
    const lb = await mkLineage(ORG_B, { ownerId: OWNER_B, versions: ["1.0.0"] });

    await forceApproved(la.mvs[0].id, ORG_A, ADMIN_A);
    expect((await publishRPC(la.mvs[0].id, ADMIN_A, slug, "1.0.0")).error, "org A claims the slug").toBeNull();

    await forceApproved(lb.mvs[0].id, ORG_B, ADMIN_B);
    const bAuditBefore = await pubAudit(lb.mvs[0].id);
    const rB = await publishRPC(lb.mvs[0].id, ADMIN_B, slug, "1.0.0");
    expect(rB.error, "org B is rejected").toBeTruthy();
    expect(((rB.error!.message ?? "") + (rB.error!.details ?? "")).toLowerCase()).toMatch(/already claimed|conflict|unique/);

    expect((await svc().from("manual_versions").select("status").eq("id", lb.mvs[0].id).single()).data!.status, "org B version still APPROVED").toBe("APPROVED");
    expect(await snapRow(lb.mvs[0].id), "no org-B snapshot").toBeNull();
    const pm = await pmRow(slug);
    expect(pm!.organization_id, "slug owned by org A only").toBe(ORG_A);
    expect(pm!.manual_id).toBe(la.manual);
    expect(await pubAudit(lb.mvs[0].id), "no org-B publish audit").toBe(bAuditBefore);
    expect((await pmvRows(pm!.id as string)).length, "only org A's version indexed").toBe(1);
  });

  // -------------------------------------------------------------------------
  it("a concurrent first-publication race for one global slug yields exactly one winner; the loser rolls back completely", { retry: 2 }, async () => {
    const slug = `p7-race-${crypto.randomUUID().slice(0, 8)}`;
    const la = await mkLineage(ORG_A, { ...VMAX, versions: ["1.0.0"] });
    const lb = await mkLineage(ORG_B, { ownerId: OWNER_B, versions: ["2.0.0"] });
    await forceApproved(la.mvs[0].id, ORG_A, ADMIN_A);
    await forceApproved(lb.mvs[0].id, ORG_B, ADMIN_B);
    const aAuditBefore = await pubAudit(la.mvs[0].id);
    const bAuditBefore = await pubAudit(lb.mvs[0].id);

    const [rA, rB] = await Promise.all([
      publishRPC(la.mvs[0].id, ADMIN_A, slug, "1.0.0"),
      publishRPC(lb.mvs[0].id, ADMIN_B, slug, "2.0.0"),
    ]);
    expect([rA.error, rB.error].filter((e) => e == null), "exactly one winner").toHaveLength(1);
    expect([rA.error, rB.error].filter((e) => e != null), "exactly one loser").toHaveLength(1);

    const aWon = rA.error == null;
    const win = aWon ? { l: la, mv: la.mvs[0].id, org: ORG_A, before: aAuditBefore } : { l: lb, mv: lb.mvs[0].id, org: ORG_B, before: bAuditBefore };
    const lose = aWon ? { l: lb, mv: lb.mvs[0].id, org: ORG_B, before: bAuditBefore } : { l: la, mv: la.mvs[0].id, org: ORG_A, before: aAuditBefore };

    const pm = await pmRow(slug);
    expect(pm, "exactly one namespace owner").toBeTruthy();
    expect(pm!.organization_id).toBe(win.org);
    expect(pm!.manual_id).toBe(win.l.manual);
    expect(await snapRow(win.mv), "winner has a snapshot").toBeTruthy();
    expect(await pubAudit(win.mv), "winner: one new publish audit").toBe(win.before + 1);

    expect((await svc().from("manual_versions").select("status").eq("id", lose.mv).single()).data!.status, "loser still APPROVED").toBe("APPROVED");
    expect(await snapRow(lose.mv), "loser has no snapshot").toBeNull();
    expect(await pubAudit(lose.mv), "loser has no publish audit").toBe(lose.before);
    expect((await svc().from("public_manuals").select("id").eq("organization_id", lose.org).eq("manual_id", lose.l.manual)).data ?? [], "loser lineage claimed no slug").toHaveLength(0);
    expect((await pmvRows(pm!.id as string)).length, "winner has exactly one indexed version").toBe(1);
  });

  // -------------------------------------------------------------------------
  // Slice 2 — the version-switcher query: PUBLISHED-only, publication-chronology order, older
  // published URLs stay addressable, and every version's snapshot public_slug stays frozen after
  // an EA-product rename (spec §17/§18/§21/§31/§32).
  it("published-version list is PUBLISHED-only in published_at DESC order; ARCHIVED excluded; slug frozen across all versions after an EA rename", { retry: 2 }, async () => {
    const L = await mkLineage(ORG_A, { ownerId: OWNER_A, versions: ["1.0.0", "1.1.0", "2.0.0"] });
    const alpha = L.slug;
    const byVer = Object.fromEntries(L.mvs.map((m) => [m.version, m.id]));

    for (const v of ["1.0.0", "1.1.0", "2.0.0"]) {
      await forceApproved(byVer[v], ORG_A, ADMIN_A);
      expect((await publishRPC(byVer[v], ADMIN_A, alpha, v)).error, `publish ${v}`).toBeNull();
    }
    // archive the middle version
    expect((await svc().rpc("archive_manual_version", { p_manual_version_id: byVer["1.1.0"], p_actor_id: ADMIN_A })).error, "archive 1.1.0").toBeNull();

    // rename the EA product — public identity must not move
    const beta = `p7-beta-${crypto.randomUUID().slice(0, 8)}`;
    await svc().from("ea_products").update({ slug: beta }).eq("id", L.prod);

    const pm = await pmRow(alpha);
    // this is exactly the query getPublicManual runs for the switcher
    const pub = (await svc().from("public_manual_versions")
      .select("public_version, publication_state, published_at")
      .eq("public_manual_id", pm!.id as string)
      .eq("publication_state", "PUBLISHED")
      .order("published_at", { ascending: false })).data ?? [];
    expect(pub.map((r) => r.public_version), "PUBLISHED only, newest first").toEqual(["2.0.0", "1.0.0"]);
    expect(pub.some((r) => r.public_version === "1.1.0"), "archived version excluded").toBe(false);

    // the archived row still exists and is directly addressable (state ARCHIVED)
    const arch = (await svc().from("public_manual_versions").select("publication_state")
      .eq("public_manual_id", pm!.id as string).eq("public_version", "1.1.0").single()).data!;
    expect(arch.publication_state).toBe("ARCHIVED");

    // every version's frozen public_slug is `alpha`, not the renamed `beta`
    for (const v of ["1.0.0", "1.1.0", "2.0.0"]) {
      const s = (await svc().from("published_snapshots").select("public_slug, render_json").eq("manual_version_id", byVer[v]).single()).data!;
      expect(s.public_slug, `snapshot public_slug ${v}`).toBe(alpha);
      expect((s.render_json as { public?: { slug?: string } }).public?.slug, `render_json slug ${v}`).toBe(alpha);
    }
    expect(await pmRow(beta), "nothing under the renamed slug").toBeNull();
  });

  // -------------------------------------------------------------------------
  // Slice 3 — published image delivery. Proves the boundary the /image/[idx] proxy runs on:
  // snapshot-membership resolution via the SHARED `snapshotImageDescriptors`, real DEV-Storage
  // bytes/MIME, cross-version + cross-org isolation, archived access, snapshot-frozen metadata,
  // the bucket stays private, and no storage key / sentinel escapes the sanitized model. The HTTP
  // route wiring + headers + out-of-range + unknown-publication are browser-verified. (Spec §38.)
  it("published image delivery: membership resolution, real bytes/MIME, isolation, archived access, frozen metadata, private bucket, no storage-key leak", { retry: 2 }, async () => {
    const rand = crypto.randomUUID().slice(0, 8);
    const SENT = "PRIVATE-STORAGE-P7-S3-SENTINEL";
    const keyA = `${ORG_A}/p7s3-${SENT}-${rand}-a.png`;
    const keyB = `${ORG_A}/p7s3-${SENT}-${rand}-b.gif`;
    const keyOrgB = `${ORG_B}/p7s3-${rand}-c.png`;
    const store = svc().storage.from("manual-images");
    expect((await store.upload(keyA, PNG_1x1, { contentType: "image/png", upsert: true })).error, "upload A").toBeNull();
    expect((await store.upload(keyB, GIF_1x1, { contentType: "image/gif", upsert: true })).error, "upload B").toBeNull();
    expect((await store.upload(keyOrgB, PNG_1x1, { contentType: "image/png", upsert: true })).error, "upload org-B").toBeNull();

    // an `image_assets` row for keyA whose LIVE alt/caption differ from the frozen snapshot values
    const assetA = crypto.randomUUID();
    await svc().from("image_assets").insert({
      id: assetA, organization_id: ORG_A, owner_id: OWNER_A, storage_key: keyA,
      mime_type: "image/png", byte_size: PNG_1x1.byteLength, width: 1, height: 1,
      alt_text: "LIVE ALT — MUST NOT SURFACE", caption: "LIVE CAPTION — MUST NOT SURFACE", scan_status: "clean",
    });

    const L = await mkLineage(ORG_A, { ownerId: OWNER_A, versions: ["1.0.0", "2.0.0"] });
    const slug = L.slug;
    const [mv1, mv2] = L.mvs;

    await forceApproved(mv1.id, ORG_A, ADMIN_A);
    expect((await publishRPC(mv1.id, ADMIN_A, slug, "1.0.0", { images: [
      { storageKey: keyA, altText: "Diagram alur", caption: "Gambar 1" },
      { storageKey: keyB, altText: "Langkah pasang", caption: null },
    ] })).error, "publish v1").toBeNull();
    await forceApproved(mv2.id, ORG_A, ADMIN_A);
    expect((await publishRPC(mv2.id, ADMIN_A, slug, "2.0.0", { images: [
      { storageKey: keyB, altText: "Hanya di v2", caption: "cap v2" },
    ] })).error, "publish v2").toBeNull();

    const rj1 = (await svc().from("published_snapshots").select("render_json, content_hash").eq("manual_version_id", mv1.id).single()).data!;
    const rj2 = (await svc().from("published_snapshots").select("render_json, content_hash").eq("manual_version_id", mv2.id).single()).data!;

    // hash re-verifies (the loader boundary), storageKey stored server-side
    expect(computeSnapshotHash(rj1.render_json as Record<string, unknown>)).toBe(rj1.content_hash);
    expect(JSON.stringify(rj1.render_json)).toContain(SENT);

    // sanitized adapter output: no storageKey / sentinel / Supabase URL — only same-origin proxy URLs
    const vm1 = snapshotToViewModel(rj1.render_json, { slug, version: "1.0.0", status: "PUBLISHED" });
    const vm1json = JSON.stringify(vm1);
    expect(vm1json).not.toContain(SENT);
    expect(vm1json).not.toMatch(/storageKey|supabase|\/object\/sign|\/object\/authenticated|token=/i);
    expect(vm1.images["img-0"].signedUrl).toBe(`/manual/${slug}/1.0.0/image/0`);
    expect(vm1.images["img-1"].signedUrl).toBe(`/manual/${slug}/1.0.0/image/1`);
    // frozen metadata — NOT the live image_assets values
    expect(vm1.images["img-0"]).toMatchObject({ altText: "Diagram alur", caption: "Gambar 1" });
    expect(vm1json).not.toMatch(/MUST NOT SURFACE/);

    // descriptor resolution == what the route does; download real bytes; check MIME
    const d1 = snapshotImageDescriptors(rj1.render_json);
    expect(d1.map((x) => x.storageKey)).toEqual([keyA, keyB]);
    const b0 = await store.download(d1[0].storageKey!);
    expect(b0.error).toBeNull();
    expect(sha256(new Uint8Array(await b0.data!.arrayBuffer())), "img-0 == uploaded PNG").toBe(sha256(PNG_1x1));
    expect(mimeForStorageKey(d1[0].storageKey!)).toBe("image/png");
    const b1 = await store.download(d1[1].storageKey!);
    expect(sha256(new Uint8Array(await b1.data!.arrayBuffer())), "img-1 == uploaded GIF").toBe(sha256(GIF_1x1));
    expect(mimeForStorageKey(d1[1].storageKey!)).toBe("image/gif");

    // cross-version isolation: v2 image 0 is B, never v1's A
    const d2 = snapshotImageDescriptors(rj2.render_json);
    expect(d2.map((x) => x.storageKey)).toEqual([keyB]);
    expect(d2.length).toBe(1); // /image/1+ on v2 is out of range -> 404 (HTTP-verified)

    // cross-org isolation: org-A descriptors never reference an org-B object; only selector is snapshot+idx
    expect([...d1, ...d2].every((x) => x.storageKey!.startsWith(`${ORG_A}/`))).toBe(true);
    expect(JSON.stringify([rj1.render_json, rj2.render_json])).not.toContain(ORG_B);

    // archived access: archive v1 -> snapshot + descriptors byte-identical
    expect((await svc().rpc("archive_manual_version", { p_manual_version_id: mv1.id, p_actor_id: ADMIN_A })).error).toBeNull();
    const rj1b = (await svc().from("published_snapshots").select("render_json").eq("manual_version_id", mv1.id).single()).data!;
    expect(JSON.stringify(rj1b.render_json)).toBe(JSON.stringify(rj1.render_json));
    expect(snapshotImageDescriptors(rj1b.render_json).map((x) => x.storageKey)).toEqual([keyA, keyB]);

    // the bucket stays private: an anon storage client cannot download the object
    const anonStore = createClient(URL!, ANON!, { global: { fetch: boundFetch } });
    const anonDl = await anonStore.storage.from("manual-images").download(keyA);
    expect(anonDl.error, "anon cannot download the private object").toBeTruthy();
    expect(anonDl.data, "anon gets no bytes").toBeFalsy();

    // cleanup: storage objects + the extra image_assets row (fixture products handled by afterAll)
    await store.remove([keyA, keyB, keyOrgB]);
    await svc().from("image_assets").delete().eq("id", assetA);
  });

  // -------------------------------------------------------------------------
  // Phase 7 slice 4B — immutable PDF artifact lifecycle (20260901002700).
  //   ensure_pdf_artifact / claim_pdf_artifact_generation / complete_/fail_ RPCs, the
  //   PENDING->GENERATING->READY lifecycle, the DB generation lock, READY immutability, the
  //   private `manual-pdf-artifacts` bucket, cross-org isolation, and the "no anon/public write"
  //   boundary. Chromium generation + download concurrency are exercised by the deployed e2e.
  // -------------------------------------------------------------------------
  const HEX64 = "a".repeat(64); // valid ^[0-9a-f]{64}$
  const artRow = async (snapId: string) =>
    (await svc().from("published_pdf_artifacts").select("*").eq("published_snapshot_id", snapId).maybeSingle())
      .data as Record<string, unknown> | null;

  it("PDF artifact: lifecycle, DB generation lock, READY immutability, private bucket, cross-org + anon isolation", { retry: 2 }, async () => {
    const L = await mkLineage(ORG_A, { ownerId: OWNER_A, versions: ["1.0.0", "2.0.0"] });
    const [mv1] = L.mvs;
    await forceApproved(mv1.id, ORG_A, ADMIN_A);
    expect((await publishRPC(mv1.id, ADMIN_A, L.slug, "1.0.0")).error, "publish v1").toBeNull();

    const snap = (await svc().from("published_snapshots").select("id, content_hash").eq("manual_version_id", mv1.id).single()).data!;
    const snapId = snap.id as string;
    const contentHash = snap.content_hash as string;
    const storageKey = `pdf/v1/${contentHash}.pdf`;

    // ---- (a) ensure_pdf_artifact is idempotent: exactly ONE PENDING artifact row per snapshot ----
    // (this test drives the RPCs directly — publishRPC is the raw RPC, not the server action, so
    //  no artifact exists until ensure creates one).
    expect((await svc().rpc("ensure_pdf_artifact", { p_published_snapshot_id: snapId })).error).toBeNull();
    expect((await svc().rpc("ensure_pdf_artifact", { p_published_snapshot_id: snapId })).error).toBeNull();
    expect((await svc().from("published_pdf_artifacts").select("id", { count: "exact", head: true }).eq("published_snapshot_id", snapId)).count).toBe(1);
    expect((await artRow(snapId))!.status).toBe("PENDING");

    // The FIRST claim grants a lease (PENDING -> GENERATING).
    const c1 = await svc().rpc("claim_pdf_artifact_generation", { p_published_snapshot_id: snapId, p_lease_seconds: 300 });
    expect(c1.error).toBeNull();
    expect((c1.data as { outcome: string }).outcome, "first claim").toBe("claimed");
    const lease = (c1.data as { leaseToken: string }).leaseToken;
    const afterClaim = await artRow(snapId);
    expect(afterClaim!.status).toBe("GENERATING");
    expect(afterClaim!.lease_token).toBe(lease);
    const attemptAfterClaim = afterClaim!.attempt_count as number;
    expect(attemptAfterClaim).toBeGreaterThanOrEqual(1);

    // ---- (b) a live GENERATING lease cannot be stolen: 2nd claim -> in_progress, attempt unchanged ----
    const c2 = await svc().rpc("claim_pdf_artifact_generation", { p_published_snapshot_id: snapId, p_lease_seconds: 300 });
    expect((c2.data as { outcome: string }).outcome).toBe("in_progress");
    expect((await artRow(snapId))!.attempt_count).toBe(attemptAfterClaim);

    // ---- (c) complete rejects a wrong lease token / wrong snapshot hash ----
    const badLease = await svc().rpc("complete_pdf_artifact_generation", {
      p_published_snapshot_id: snapId, p_lease_token: crypto.randomUUID(),
      p_snapshot_content_hash: contentHash, p_storage_key: storageKey,
      p_pdf_sha256: HEX64, p_byte_size: 1000, p_page_count: 3,
    });
    expect(badLease.error, "wrong lease cannot complete").toBeTruthy();
    const badHash = await svc().rpc("complete_pdf_artifact_generation", {
      p_published_snapshot_id: snapId, p_lease_token: lease,
      p_snapshot_content_hash: "b".repeat(64), p_storage_key: storageKey,
      p_pdf_sha256: HEX64, p_byte_size: 1000, p_page_count: 3,
    });
    expect(badHash.error, "wrong snapshot hash cannot complete").toBeTruthy();
    // fail rejects a wrong lease token too
    expect((await svc().rpc("fail_pdf_artifact_generation", {
      p_published_snapshot_id: snapId, p_lease_token: crypto.randomUUID(),
      p_failure_code: "x", p_failure_message: "y",
    })).error, "wrong lease cannot fail").toBeTruthy();
    // a mismatched storage-key shape is rejected
    expect((await svc().rpc("complete_pdf_artifact_generation", {
      p_published_snapshot_id: snapId, p_lease_token: lease, p_snapshot_content_hash: contentHash,
      p_storage_key: "pdf/v1/not-a-hash.pdf", p_pdf_sha256: HEX64, p_byte_size: 1000, p_page_count: 3,
    })).error, "bad storage key shape rejected").toBeTruthy();

    // ---- (d) FAILED -> claim retry increments attempt_count ----
    expect((await svc().rpc("fail_pdf_artifact_generation", {
      p_published_snapshot_id: snapId, p_lease_token: lease,
      p_failure_code: "generation_error", p_failure_message: "chromium OOM (sanitized)",
    })).error).toBeNull();
    expect((await artRow(snapId))!.status).toBe("FAILED");
    expect((await artRow(snapId))!.lease_token).toBeNull();
    const cRetry = await svc().rpc("claim_pdf_artifact_generation", { p_published_snapshot_id: snapId, p_lease_seconds: 300 });
    expect((cRetry.data as { outcome: string }).outcome).toBe("claimed");
    const lease2 = (cRetry.data as { leaseToken: string }).leaseToken;
    expect((await artRow(snapId))!.attempt_count).toBe(attemptAfterClaim + 1);

    // ---- (e) complete -> READY ----
    const done = await svc().rpc("complete_pdf_artifact_generation", {
      p_published_snapshot_id: snapId, p_lease_token: lease2, p_snapshot_content_hash: contentHash,
      p_storage_key: storageKey, p_pdf_sha256: HEX64, p_byte_size: 123456, p_page_count: 24,
    });
    expect(done.error).toBeNull();
    const ready = await artRow(snapId);
    expect(ready!.status).toBe("READY");
    expect(ready!.storage_key).toBe(storageKey);
    expect(ready!.pdf_sha256).toBe(HEX64);
    expect(ready!.byte_size).toBe(123456);
    expect(ready!.page_count).toBe(24);
    expect(ready!.lease_token).toBeNull();
    expect(ready!.generated_at).toBeTruthy();

    // ---- (f) READY is immutable: claim returns 'ready' (never regenerates), complete/fail rejected ----
    const cReady = await svc().rpc("claim_pdf_artifact_generation", { p_published_snapshot_id: snapId, p_lease_seconds: 300 });
    expect((cReady.data as { outcome: string }).outcome).toBe("ready");
    expect((await artRow(snapId))!.attempt_count, "READY claim does not bump attempt").toBe(attemptAfterClaim + 1);
    expect((await svc().rpc("complete_pdf_artifact_generation", {
      p_published_snapshot_id: snapId, p_lease_token: lease2, p_snapshot_content_hash: contentHash,
      p_storage_key: storageKey, p_pdf_sha256: HEX64, p_byte_size: 999, p_page_count: 1,
    })).error, "cannot re-complete a READY artifact").toBeTruthy();

    // ---- (g) READY row cannot be mutated even by service (no UPDATE grant; trigger is belt) ----
    const svcUpd = await svc().from("published_pdf_artifacts")
      .update({ pdf_sha256: "c".repeat(64), byte_size: 1 }).eq("published_snapshot_id", snapId).select("id");
    expect(svcUpd.error, "service has no UPDATE grant on published_pdf_artifacts").toBeTruthy();

    // ---- (h) archived version keeps its READY artifact byte-identical ----
    expect((await svc().rpc("archive_manual_version", { p_manual_version_id: mv1.id, p_actor_id: ADMIN_A })).error).toBeNull();
    const afterArchive = await artRow(snapId);
    expect(afterArchive!.status).toBe("READY");
    expect(afterArchive!.pdf_sha256).toBe(HEX64);
    expect(afterArchive!.byte_size).toBe(123456);
    expect(afterArchive!.storage_key).toBe(storageKey);

    // ---- (i) cross-org: an org-B authed member cannot SELECT the org-A artifact (RLS) ----
    const bSee = await outsider.from("published_pdf_artifacts").select("id").eq("published_snapshot_id", snapId);
    expect((bSee.data ?? []).length, "org-B cannot see org-A artifact").toBe(0);

    // ---- (j) no anon / authenticated direct writes to the artifact table ----
    for (const [name, client] of [["anon", anon], ["org-B authed", outsider]] as const) {
      const ins = await client.from("published_pdf_artifacts").insert({
        organization_id: ORG_A, published_snapshot_id: crypto.randomUUID(),
        manual_version_id: mv1.id, snapshot_content_hash: HEX64,
      }).select("id");
      expect(ins.error, `${name} cannot INSERT published_pdf_artifacts`).toBeTruthy();
      const upd = await client.from("published_pdf_artifacts")
        .update({ status: "READY" }).eq("published_snapshot_id", snapId).select("id");
      expect((upd.error || (upd.data ?? []).length === 0), `${name} cannot UPDATE published_pdf_artifacts`).toBeTruthy();
    }
    // anon cannot execute the lifecycle RPCs
    expect((await anon.rpc("claim_pdf_artifact_generation", { p_published_snapshot_id: snapId, p_lease_seconds: 300 })).error,
      "anon cannot execute claim_pdf_artifact_generation").toBeTruthy();

    // ---- (k) the manual-pdf-artifacts bucket is private: anon cannot read or write it ----
    const realKey = `pdf/v1/${"e".repeat(64)}.pdf`;
    expect((await svc().storage.from("manual-pdf-artifacts").upload(realKey, new Uint8Array([1, 2, 3]), { upsert: true, contentType: "application/pdf" })).error,
      "service can write the private bucket").toBeNull();
    const anonStore = createClient(URL!, ANON!, { global: { fetch: boundFetch } }).storage.from("manual-pdf-artifacts");
    const anonDl = await anonStore.download(realKey);
    expect(anonDl.error, "anon cannot download a pdf artifact").toBeTruthy();
    expect(anonDl.data, "anon gets no artifact bytes").toBeFalsy();
    const anonUp = await anonStore.upload(`pdf/v1/${"f".repeat(64)}.pdf`, new Uint8Array([9]), { contentType: "application/pdf" });
    expect(anonUp.error, "anon cannot upload to the pdf artifact bucket").toBeTruthy();

    // cleanup
    await svc().storage.from("manual-pdf-artifacts").remove([realKey, storageKey]);
  });
});
