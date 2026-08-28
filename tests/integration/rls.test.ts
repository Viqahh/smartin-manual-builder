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
    if (data) await service().from("ea_products").delete().eq("id", data.id); // cleanup
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
      await service()
        .from("ea_products")
        .delete()
        .eq("id", bProductId);
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
      await service()
        .from("ea_products")
        .delete()
        .eq("id", bProductId);
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
    await svc().from("manual_blocks").delete().in("id", ids);
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

    await svc().from("manual_blocks").delete().in("id", created); // cleanup
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
    await svc().from("image_assets").delete().eq("id", assetId);
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

    await svc.from("manuals").delete().eq("id", row.manual_id); // cleanup
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

    await svc.from("manuals").delete().eq("id", row.manual_id);
    await svc.from("ea_parameters").update({ default_value: "0.01" }).eq("parameter_group_id", VMAX_GROUP).eq("technical_name", "FixedLot");
  });
});
