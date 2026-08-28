import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CANONICAL_SECTIONS } from "@/lib/domain/canonical-sections";
import {
  ACTIONS,
  ORG_ROLES,
  ROLE_ACTIONS,
} from "@/lib/permissions/actions";
import { MT_TIMEFRAMES } from "@/lib/domain/timeframes";
import { BLOCK_TYPES } from "@/lib/domain/blocks";
import { EA_PARAM_TYPES } from "@/lib/domain/parameters";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");

describe("SQL <-> TS parity", () => {
  it("the system manual template seeds exactly the canonical sections (AC-P2-10/26)", () => {
    const sql = read("supabase/migrations/20260901000350_system_template.sql");
    for (const s of CANONICAL_SECTIONS) {
      expect(sql).toContain(`'${s.key}'`);
      expect(sql).toMatch(new RegExp(`'${s.key}'[^\\n]*,\\s*${s.order}\\)`));
    }
    // instantiation reads the template table — it is not a permanently hardcoded 18-row source
    const fns = read("supabase/migrations/20260901000400_functions_triggers.sql");
    expect(fns).toMatch(/instantiate_sections_from_template[\s\S]*from manual_template_sections/);
  });

  it("mt_timeframe enum matches MT_TIMEFRAMES", () => {
    const sql = read("supabase/migrations/20260901000200_ea.sql");
    for (const tf of MT_TIMEFRAMES) expect(sql).toContain(`'${tf}'`);
  });

  it("manual_block_type enum matches BLOCK_TYPES", () => {
    const sql = read("supabase/migrations/20260901000300_manuals.sql");
    for (const bt of BLOCK_TYPES) expect(sql).toContain(`'${bt}'`);
  });

  it("ea_param_type enum matches EA_PARAM_TYPES", () => {
    const sql = read("supabase/migrations/20260901000200_ea.sql");
    for (const t of EA_PARAM_TYPES) expect(sql).toContain(`'${t}'`);
  });

  it("membership_role enum matches ORG_ROLES", () => {
    const sql = read("supabase/migrations/20260901000100_core.sql");
    for (const r of ORG_ROLES) expect(sql).toContain(`'${r}'`);
  });

  it("parameter_groups / ea_version_setups FK ea_versions, never manual_versions (GI-11)", () => {
    const sql = read("supabase/migrations/20260901000200_ea.sql");
    expect(sql).toMatch(/parameter_groups[\s\S]*?ea_version_id\s+uuid not null references ea_versions/);
    expect(sql).toMatch(/ea_version_setups[\s\S]*?ea_version_id\s+uuid not null references ea_versions/);
    expect(sql).not.toMatch(/parameter_groups[\s\S]*?manual_version_id/);
    expect(sql).not.toMatch(/ea_parameters[\s\S]*?manual_version_id/);
  });

  it("ea_version_setups is unique on (ea_version_id, symbol, timeframe)", () => {
    const sql = read("supabase/migrations/20260901000200_ea.sql");
    expect(sql).toContain("unique (ea_version_id, symbol, timeframe)");
  });

  it("every action in the map is a declared Action", () => {
    for (const role of ORG_ROLES) {
      for (const a of ROLE_ACTIONS[role]) {
        expect(ACTIONS).toContain(a);
      }
    }
  });

  it("RLS is enabled on every org-owned table", () => {
    const sql = read("supabase/migrations/20260901000500_rls.sql");
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
      "audit_events",
    ]) {
      expect(sql).toMatch(new RegExp(`alter table\\s+${t}\\s+enable row level security`));
    }
  });

  it("RLS write policies on content tables require app.can_author (reviewers read-only)", () => {
    const sql = read("supabase/migrations/20260901000500_rls.sql");
    // The content-table loop must gate INSERT/UPDATE/DELETE on can_author, and there is
    // no blanket member write policy left.
    expect(sql).toMatch(/for insert to authenticated with check \(app\.can_author\(organization_id\)\)/);
    expect(sql).toMatch(/for update to authenticated using \(app\.can_author\(organization_id\)\)/);
    expect(sql).toMatch(/for delete to authenticated using \(app\.can_author\(organization_id\)\)/);
    expect(sql).not.toMatch(/for insert to authenticated with check \(organization_id in \(select app\.member_org_ids\(\)\)\)/);
    // admin-only for memberships / org / templates
    expect(sql).toMatch(/membership_write_admin[\s\S]*app\.is_admin\(organization_id\)/);
  });

  it("multi-role memberships: unique is (organization_id, user_id, role) — PRD §6", () => {
    const sql = read("supabase/migrations/20260901000100_core.sql");
    expect(sql).toMatch(/create table memberships[\s\S]*unique \(organization_id, user_id, role\)/);
    expect(sql).not.toMatch(/create table memberships[\s\S]*unique \(organization_id, user_id\)\s*\n\s*\)/);
    expect(sql).toMatch(/function app\.can_author/);
    expect(sql).toMatch(/function app\.member_roles/);
  });

  it("every SECURITY DEFINER RPC enforces authoring role, not just membership (spec §2)", () => {
    const rpc = read("supabase/migrations/20260901000600_rpc.sql");
    for (const fn of [
      "create_ea_version_with_setups",
      "create_manual_with_version",
      "create_product_version_manual",
      "replace_ea_version_setups",
      "reorder_manual_blocks",
      "reorder_parameter_groups",
      "reorder_ea_parameters",
    ]) {
      const body = rpc.slice(rpc.indexOf(`function public.${fn}`));
      const next = body.indexOf("$$;");
      expect(body.slice(0, next)).toMatch(/app\.assert_author\(/);
    }
    // untrusted authenticated clients are denied EXECUTE on the privileged app.* helpers
    expect(rpc).toMatch(/revoke execute on function app\.instantiate_sections_from_template\(uuid, uuid\) from public/);
    expect(rpc).toMatch(/revoke execute on function app\.copy_parameter_definitions\(uuid, uuid\) from public/);
  });

  it("copy_parameter_definitions blocks a cross-organisation copy (spec §2)", () => {
    const fns = read("supabase/migrations/20260901000400_functions_triggers.sql");
    const body = fns.slice(fns.indexOf("function app.copy_parameter_definitions"));
    expect(body).toMatch(/v_source_org is distinct from v_target_org/);
    expect(body).toMatch(/app\.can_author\(v_target_org\)/);
  });

  it("instantiate_sections_from_template verifies authoring access to the target org (spec §2)", () => {
    const fns = read("supabase/migrations/20260901000400_functions_triggers.sql");
    const body = fns.slice(fns.indexOf("function app.instantiate_sections_from_template"));
    expect(body.slice(0, body.indexOf("$$;"))).toMatch(/app\.can_author\(v_org\)/);
  });

  it("replaceSupportedSetups is atomic — the action calls the RPC, not separate delete+insert", () => {
    const action = read("features/setups/actions.ts");
    expect(action).toMatch(/rpc\("replace_ea_version_setups"/);
    expect(action).not.toMatch(/\.from\("ea_version_setups"\)\s*\.delete\(\)/);
  });

  it("uploadManualImage persists width/height (AC-P2-19)", () => {
    const action = read("features/images/actions.ts");
    expect(action).toMatch(/imageDimensions\(/);
    expect(action).toMatch(/width: dims\.width/);
    expect(action).toMatch(/height: dims\.height/);
  });

  it("block CRUD server actions exist and validate payloads at the write boundary (AC-P2-15)", () => {
    const action = read("features/blocks/actions.ts");
    for (const fn of ["createBlock", "updateBlock", "softDeleteBlock", "restoreBlock", "reorderBlocks"]) {
      expect(action).toContain(`export async function ${fn}`);
    }
    expect(action).toMatch(/parseBlockPayload\(/);
    expect(action).toMatch(/rpc\("reorder_manual_blocks"/); // transactional multi-block reorder
  });
});
