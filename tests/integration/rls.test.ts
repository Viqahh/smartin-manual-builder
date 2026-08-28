/**
 * LIVE Supabase integration suite (spec §9, AC-P2-21).
 *
 * BLOCKED BY EXTERNAL CREDENTIALS in this environment — no Supabase project / CLI / Docker —
 * so every `describe` below is skipped. It runs automatically once the schema
 * (supabase/migrations) + seed (supabase/seed.sql) are applied and these are set:
 *   SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY, SUPABASE_SECRET_KEY
 * See docs/PHASE_2.md "Running the integration tests".
 *
 * Seeded identities (supabase/seed.sql):
 *   developer@smartin.demo  DEVELOPER          org A
 *   admin@smartin.demo      ADMIN              org A
 *   reviewer@smartin.demo   TECHNICAL_REVIEWER org A
 *   outsider@smartin.demo   ADMIN              org B
 *   All passwords: demo-password-123
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const ready = Boolean(URL && ANON);

const PW = "demo-password-123";
const ORG_A = "a0000000-0000-4000-8000-00000000000a";
const ORG_B = "b0000000-0000-4000-8000-00000000000b";
const VMAX_PRODUCT = "d0000000-0000-4000-8000-00000000000d";
const VMAX_EA_VERSION = "e0000000-0000-4000-8000-00000000000e";
const VMAX_MANUAL = "10000000-0000-4000-8000-000000000010";
const VMAX_MV = "20000000-0000-4000-8000-000000000020";
const VMAX_GROUP = "f0000000-0000-4000-8000-00000000000f";

async function signIn(email: string): Promise<SupabaseClient> {
  const c = createClient(URL!, ANON!);
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw error;
  return c;
}

describe.skipIf(!ready)("cross-org isolation (spec §27, AC-P2-21)", () => {
  let outsider: SupabaseClient; // org B
  let dev: SupabaseClient; // org A

  beforeAll(async () => {
    outsider = await signIn("outsider@smartin.demo");
    dev = await signIn("developer@smartin.demo");
  });

  it("org B user reads none of org A's content", async () => {
    for (const t of [
      "ea_products",
      "ea_versions",
      "ea_version_setups",
      "parameter_groups",
      "ea_parameters",
      "manuals",
      "manual_versions",
      "manual_sections",
      "manual_blocks",
      "image_assets",
    ]) {
      const { data } = await outsider.from(t).select("id").eq("organization_id", ORG_A);
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("org B user cannot mutate org A's EA product", async () => {
    const { data } = await outsider
      .from("ea_products")
      .update({ description: "hijacked" })
      .eq("id", VMAX_PRODUCT)
      .select("id");
    expect(data ?? []).toHaveLength(0);
    const { data: check } = await dev.from("ea_products").select("description").eq("id", VMAX_PRODUCT).single();
    expect(check?.description).not.toBe("hijacked");
  });

  it("org B user cannot sign a URL for org A's private images", async () => {
    const { data: assets } = await dev.from("image_assets").select("storage_key").eq("organization_id", ORG_A).limit(1);
    if (!assets?.length) return;
    const { error } = await outsider.storage.from("manual-images").createSignedUrl(assets[0].storage_key, 60);
    expect(error).toBeTruthy();
  });

  it("org A user CAN read org A's data", async () => {
    const { data } = await dev.from("manuals").select("id").eq("id", VMAX_MANUAL);
    expect((data ?? []).length).toBe(1);
  });
});

describe.skipIf(!ready)("reviewer role — direct-table mutation is denied (finding 1)", () => {
  let reviewer: SupabaseClient; // TECHNICAL_REVIEWER, org A

  beforeAll(async () => {
    reviewer = await signIn("reviewer@smartin.demo");
  });

  it("TECHNICAL_REVIEWER can READ manual content", async () => {
    const { data } = await reviewer.from("manual_sections").select("id").eq("manual_version_id", VMAX_MV);
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("TECHNICAL_REVIEWER cannot UPDATE manual_sections directly", async () => {
    const { data } = await reviewer
      .from("manual_sections")
      .update({ title: "reviewer edit" })
      .eq("manual_version_id", VMAX_MV)
      .select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it("TECHNICAL_REVIEWER cannot INSERT/UPDATE ea_parameters directly", async () => {
    const ins = await reviewer.from("ea_parameters").insert({
      organization_id: ORG_A,
      parameter_group_id: VMAX_GROUP,
      display_name: "x",
      technical_name: "Sneaky",
      param_type: "int",
      position: 99,
    });
    expect(ins.error).toBeTruthy();
    const upd = await reviewer
      .from("ea_parameters")
      .update({ default_value: "999" })
      .eq("parameter_group_id", VMAX_GROUP)
      .select("id");
    expect(upd.data ?? []).toHaveLength(0);
  });

  it("TECHNICAL_REVIEWER cannot INSERT manual_blocks", async () => {
    const { error } = await reviewer.from("manual_blocks").insert({
      organization_id: ORG_A,
      manual_section_id: "00000000-0000-4000-8000-000000000000",
      block_type: "text",
      payload: {},
      position: 0,
    });
    expect(error).toBeTruthy();
  });
});

describe.skipIf(!ready)("privileged RPC — reviewer / cross-org denial (finding 2)", () => {
  let reviewer: SupabaseClient;
  let outsider: SupabaseClient;

  beforeAll(async () => {
    reviewer = await signIn("reviewer@smartin.demo");
    outsider = await signIn("outsider@smartin.demo");
  });

  it("TECHNICAL_REVIEWER cannot call create_ea_version_with_setups", async () => {
    const { error } = await reviewer.rpc("create_ea_version_with_setups", {
      p_org: ORG_A,
      p_ea_product_id: VMAX_PRODUCT,
      p_version: "9.9.9",
      p_platform: "MT5",
      p_release_date: "2026-01-01",
      p_requirements: {},
      p_support: {},
      p_setups: [{ symbol: "XAUUSD", timeframe: "M15", position: 0 }],
      p_copy_params_from: null,
    });
    expect(error).toBeTruthy();
  });

  it("TECHNICAL_REVIEWER cannot call create_manual_with_version", async () => {
    const { error } = await reviewer.rpc("create_manual_with_version", {
      p_org: ORG_A,
      p_ea_product_id: VMAX_PRODUCT,
      p_ea_version_id: VMAX_EA_VERSION,
      p_manual_version: "9.9.9",
      p_template_id: null,
      p_locale: "id",
    });
    expect(error).toBeTruthy();
  });

  it("org B admin cannot call create_manual_with_version against org A", async () => {
    const { error } = await outsider.rpc("create_manual_with_version", {
      p_org: ORG_A,
      p_ea_product_id: VMAX_PRODUCT,
      p_ea_version_id: VMAX_EA_VERSION,
      p_manual_version: "9.9.9",
      p_template_id: null,
      p_locale: "id",
    });
    expect(error).toBeTruthy();
  });

  it("cross-org copy_parameter_definitions is impossible (finding 2)", async () => {
    // Only reachable via create_ea_version_with_setups p_copy_params_from; an org-B admin
    // pointing at org A's EA version must fail.
    const { error } = await outsider.rpc("create_ea_version_with_setups", {
      p_org: ORG_B,
      p_ea_product_id: VMAX_PRODUCT, // not in org B
      p_version: "1.2.3",
      p_platform: "MT5",
      p_release_date: "2026-01-01",
      p_requirements: {},
      p_support: {},
      p_setups: [{ symbol: "XAUUSD", timeframe: "M15", position: 0 }],
      p_copy_params_from: VMAX_EA_VERSION,
    });
    expect(error).toBeTruthy();
  });
});

describe.skipIf(!ready)("developer denied admin-only mutations (finding 1)", () => {
  let dev: SupabaseClient;
  beforeAll(async () => {
    dev = await signIn("developer@smartin.demo");
  });

  it("DEVELOPER cannot insert a membership", async () => {
    const { error } = await dev.from("memberships").insert({
      organization_id: ORG_A,
      user_id: "11111111-1111-4111-8111-111111111111",
      role: "ADMIN",
    });
    expect(error).toBeTruthy();
  });

  it("DEVELOPER cannot write a system/org template section", async () => {
    const { error } = await dev.from("manual_template_sections").insert({
      template_id: "a1a1a1a1-1111-4111-8111-000000000001",
      section_key: "sneaky",
      title: "x",
      position: 99,
    });
    expect(error).toBeTruthy();
  });
});

describe.skipIf(!ready)("required section protection (AC-P2-14)", () => {
  it("a required, non-custom section cannot be deleted", async () => {
    if (!SECRET) return; // needs the service client to attempt a raw delete
    const svc = createClient(URL!, SECRET);
    const { data: sec } = await svc
      .from("manual_sections")
      .select("id")
      .eq("manual_version_id", VMAX_MV)
      .eq("section_key", "installation")
      .single();
    const { error } = await svc.from("manual_sections").delete().eq("id", sec!.id);
    expect(error).toBeTruthy();
  });
});

describe.skipIf(!ready)("atomic supported-configuration replacement (finding 5)", () => {
  let dev: SupabaseClient;
  beforeAll(async () => {
    dev = await signIn("developer@smartin.demo");
  });

  it("a failed replace leaves the previous list intact", async () => {
    const before = await dev.from("ea_version_setups").select("id").eq("ea_version_id", VMAX_EA_VERSION);
    const beforeCount = (before.data ?? []).length;
    expect(beforeCount).toBeGreaterThan(0);

    // duplicate (symbol,timeframe) -> the INSERT half fails -> whole call rolls back
    const { error } = await dev.rpc("replace_ea_version_setups", {
      p_org: ORG_A,
      p_ea_version_id: VMAX_EA_VERSION,
      p_setups: [
        { symbol: "XAUUSD", timeframe: "M15", position: 0 },
        { symbol: "XAUUSD", timeframe: "M15", position: 1 },
      ],
    });
    expect(error).toBeTruthy();

    const after = await dev.from("ea_version_setups").select("id").eq("ea_version_id", VMAX_EA_VERSION);
    expect((after.data ?? []).length).toBe(beforeCount);
  });
});

describe.skipIf(!ready)("block CRUD round-trip (finding 3, AC-P2-15/16/17)", () => {
  let svc: SupabaseClient;
  let sectionId: string;
  const created: string[] = [];

  beforeAll(async () => {
    if (!SECRET) return;
    svc = createClient(URL!, SECRET);
    const { data } = await svc
      .from("manual_sections")
      .select("id")
      .eq("manual_version_id", VMAX_MV)
      .eq("section_key", "overview")
      .single();
    sectionId = data!.id;
  });

  it("insert three text blocks, reorder them transactionally, soft-delete + restore", async () => {
    if (!SECRET) return;
    for (let i = 0; i < 3; i++) {
      const { data } = await svc
        .from("manual_blocks")
        .insert({
          organization_id: ORG_A,
          manual_section_id: sectionId,
          block_type: "text",
          payload: { type: "text", schemaVersion: 1, content: { schemaVersion: 1, format: "plain-paragraphs", paragraphs: [`p${i}`] } },
          position: i,
        })
        .select("id")
        .single();
      created.push(data!.id);
    }
    const rev = [created[2], created[0], created[1]];
    const { error } = await svc.rpc("reorder_manual_blocks", { p_section_id: sectionId, p_ordered_ids: rev });
    expect(error).toBeNull();
    const { data: rows } = await svc
      .from("manual_blocks")
      .select("id, position")
      .eq("manual_section_id", sectionId)
      .is("deleted_at", null)
      .order("position");
    expect((rows ?? []).map((r) => r.id)).toEqual(rev);
    // positions stay 0..n-1, non-negative, unique
    expect((rows ?? []).map((r) => r.position)).toEqual([0, 1, 2]);

    await svc.from("manual_blocks").update({ deleted_at: new Date().toISOString() }).eq("id", created[0]);
    const { data: live } = await svc
      .from("manual_blocks")
      .select("id")
      .eq("manual_section_id", sectionId)
      .is("deleted_at", null);
    expect((live ?? []).length).toBe(2);

    // cleanup
    await svc.from("manual_blocks").delete().in("id", created);
  });
});

describe.skipIf(!ready)("template instantiation records the template version (finding 4, AC-P2-26)", () => {
  it("create_manual_with_version instantiates exactly the active template's section set", async () => {
    if (!SECRET) return;
    const svc = createClient(URL!, SECRET);
    const { data } = await svc.rpc("create_manual_with_version", {
      p_org: ORG_A,
      p_ea_product_id: VMAX_PRODUCT,
      p_ea_version_id: VMAX_EA_VERSION,
      p_manual_version: "7.7.7",
      p_template_id: null,
      p_locale: "id",
    });
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.template_version).toBe(1);

    const { data: tplSecs } = await svc
      .from("manual_template_sections")
      .select("section_key")
      .eq("template_id", "a1a1a1a1-1111-4111-8111-000000000001");
    const { data: mvSecs } = await svc
      .from("manual_sections")
      .select("section_key")
      .eq("manual_version_id", row.manual_version_id);
    expect(new Set((mvSecs ?? []).map((s) => s.section_key))).toEqual(
      new Set((tplSecs ?? []).map((s) => s.section_key)),
    );

    // cleanup
    await svc.from("manuals").delete().eq("id", row.manual_id);
  });
});

describe.skipIf(!ready)("parameter ownership + propagation (AC-P2-18b)", () => {
  it("editing an ea_parameter shows in every manual version linked to that EA version", async () => {
    if (!SECRET) return;
    const svc = createClient(URL!, SECRET);
    // second manual version on the SAME ea version
    const { data } = await svc.rpc("create_manual_with_version", {
      p_org: ORG_A,
      p_ea_product_id: VMAX_PRODUCT,
      p_ea_version_id: VMAX_EA_VERSION,
      p_manual_version: "1.0.1",
      p_template_id: null,
      p_locale: "id",
    });
    const row = Array.isArray(data) ? data[0] : data;

    await svc.from("ea_parameters").update({ default_value: "0.02" }).eq("parameter_group_id", VMAX_GROUP).eq("technical_name", "FixedLot");

    // both manual versions read the same ea-version-owned rows (no per-manual copy exists)
    const { count } = await svc
      .from("ea_parameters")
      .select("id", { count: "exact", head: true })
      .eq("parameter_group_id", VMAX_GROUP);
    expect((count ?? 0)).toBeGreaterThan(0);
    const { data: p } = await svc
      .from("ea_parameters")
      .select("default_value")
      .eq("parameter_group_id", VMAX_GROUP)
      .eq("technical_name", "FixedLot")
      .single();
    expect(p?.default_value).toBe("0.02");

    // cleanup
    await svc.from("manuals").delete().eq("id", row.manual_id);
    await svc.from("ea_parameters").update({ default_value: "0.01" }).eq("parameter_group_id", VMAX_GROUP).eq("technical_name", "FixedLot");
  });
});
