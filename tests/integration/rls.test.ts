/**
 * Cross-organisation isolation against a LIVE Supabase project (spec §27, AC-P2-21).
 *
 * BLOCKED BY EXTERNAL CREDENTIALS in this environment — there is no Supabase project, CLI,
 * or Docker available, so this suite is skipped. It runs automatically once
 * SUPABASE_TEST_URL + SUPABASE_TEST_ANON_KEY + SUPABASE_SECRET_KEY are set and the schema
 * (supabase/migrations) + seed (supabase/seed.sql) have been applied.
 *
 * Manual run: see docs/PHASE_2.md "Running the RLS integration tests".
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const ready = Boolean(URL && ANON);

// Seed identities (supabase/seed.sql)
const DEV_A = { email: "developer@smartin.demo", password: "demo-password-123" };
const OUTSIDER_B = { email: "outsider@smartin.demo", password: "demo-password-123" };
const ORG_A = "a0000000-0000-4000-8000-00000000000a";
const VMAX_PRODUCT = "d0000000-0000-4000-8000-00000000000d";
const VMAX_MANUAL = "10000000-0000-4000-8000-000000000010";

describe.skipIf(!ready)("RLS cross-org isolation (AC-P2-21)", () => {
  let asA: SupabaseClient;
  let asB: SupabaseClient;

  beforeAll(async () => {
    asA = createClient(URL!, ANON!);
    asB = createClient(URL!, ANON!);
    await asA.auth.signInWithPassword(DEV_A);
    await asB.auth.signInWithPassword(OUTSIDER_B);
  });

  it("User B (org B) cannot read org A's EA products", async () => {
    const { data } = await asB.from("ea_products").select("id").eq("id", VMAX_PRODUCT);
    expect(data ?? []).toHaveLength(0);
  });

  it("User B cannot read org A's manuals / manual_versions / sections", async () => {
    for (const table of ["manuals", "manual_versions", "manual_sections"]) {
      const { data } = await asB.from(table).select("id").eq("organization_id", ORG_A);
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("User B cannot mutate org A's EA product", async () => {
    const { error, data } = await asB
      .from("ea_products")
      .update({ description: "hijacked" })
      .eq("id", VMAX_PRODUCT)
      .select("id");
    // Either an error, or zero rows affected — never a successful write.
    expect(error ?? (data ?? []).length === 0).toBeTruthy();
  });

  it("User A (org A) CAN read org A's data", async () => {
    const { data } = await asA.from("manuals").select("id").eq("id", VMAX_MANUAL);
    expect((data ?? []).length).toBe(1);
  });

  it("User B cannot sign a URL for org A's private images", async () => {
    const { data: assets } = await asA.from("image_assets").select("storage_key").limit(1);
    if (!assets?.length) return; // no image seeded — nothing to prove here
    const { error } = await asB.storage.from("manual-images").createSignedUrl(assets[0].storage_key, 60);
    expect(error).toBeTruthy();
  });
});
