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
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;

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

async function signIn(email: string): Promise<SupabaseClient> {
  const c = createClient(URL!, ANON!);
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  return c;
}
const service = () => createClient(URL!, SECRET!, { auth: { persistSession: false } });

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
    const anon = createClient(URL!, ANON!); // no sign-in
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
    anon = createClient(URL!, ANON!);
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
    anon = createClient(URL!, ANON!);

    // seed one Org A result row via the service role (the only path that may write)
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
