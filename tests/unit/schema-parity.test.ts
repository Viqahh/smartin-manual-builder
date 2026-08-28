import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CANONICAL_SECTIONS } from "@/lib/domain/canonical-sections";
import { ACTIONS, ORG_ROLES, ROLE_ACTIONS } from "@/lib/permissions/actions";
import { MT_TIMEFRAMES } from "@/lib/domain/timeframes";
import { BLOCK_TYPES } from "@/lib/domain/blocks";
import { EA_PARAM_TYPES } from "@/lib/domain/parameters";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");

const core = () => read("supabase/migrations/20260901000100_core.sql");
const ea = () => read("supabase/migrations/20260901000200_ea.sql");
const manuals = () => read("supabase/migrations/20260901000300_manuals.sql");
const tpl = () => read("supabase/migrations/20260901000350_system_template.sql");
const fns = () => read("supabase/migrations/20260901000400_functions_triggers.sql");
const rls = () => read("supabase/migrations/20260901000500_rls.sql");
const rpc = () => read("supabase/migrations/20260901000600_rpc.sql");

describe("SQL <-> TS parity", () => {
  it("system manual template = canonical section set; instantiation reads the table (AC-P2-10/26)", () => {
    const sql = tpl();
    for (const s of CANONICAL_SECTIONS) {
      expect(sql).toContain(`'${s.key}'`);
      expect(sql).toMatch(new RegExp(`'${s.key}'[^\\n]*,\\s*${s.order}\\)`));
    }
    expect(fns()).toMatch(/instantiate_sections_from_template[\s\S]*from manual_template_sections/);
  });

  it("enums match TS constants", () => {
    for (const tf of MT_TIMEFRAMES) expect(ea()).toContain(`'${tf}'`);
    for (const bt of BLOCK_TYPES) expect(manuals()).toContain(`'${bt}'`);
    for (const t of EA_PARAM_TYPES) expect(ea()).toContain(`'${t}'`);
    for (const r of ORG_ROLES) expect(core()).toContain(`'${r}'`);
  });

  it("parameters/setups belong to ea_versions, never manual_versions (GI-11)", () => {
    expect(ea()).not.toMatch(/parameter_groups[\s\S]*?manual_version_id/);
    expect(ea()).not.toMatch(/ea_parameters[\s\S]*?manual_version_id/);
    expect(ea()).toContain("unique (ea_version_id, symbol, timeframe)");
  });

  it("every action in the map is a declared Action", () => {
    for (const role of ORG_ROLES) for (const a of ROLE_ACTIONS[role]) expect(ACTIONS).toContain(a);
  });

  // ---- Finding 2: same-organisation relational integrity via composite FKs ----
  it("child tables have COMPOSITE (id, organization_id) foreign keys to their parent", () => {
    expect(ea()).toMatch(/ea_versions[\s\S]*?foreign key \(ea_product_id, organization_id\)\s*references ea_products \(id, organization_id\)/);
    expect(ea()).toMatch(/ea_version_setups[\s\S]*?foreign key \(ea_version_id, organization_id\)\s*references ea_versions \(id, organization_id\)/);
    expect(ea()).toMatch(/parameter_groups[\s\S]*?foreign key \(ea_version_id, organization_id\)\s*references ea_versions \(id, organization_id\)/);
    expect(ea()).toMatch(/ea_parameters[\s\S]*?foreign key \(parameter_group_id, organization_id\)\s*references parameter_groups \(id, organization_id\)/);
    expect(manuals()).toMatch(/manuals[\s\S]*?foreign key \(ea_product_id, organization_id\)\s*references ea_products \(id, organization_id\)/);
    expect(manuals()).toMatch(/manual_versions[\s\S]*?foreign key \(manual_id, organization_id\)\s*references manuals \(id, organization_id\)/);
    expect(manuals()).toMatch(/manual_versions[\s\S]*?foreign key \(ea_version_id, organization_id\)\s*references ea_versions \(id, organization_id\)/);
    expect(manuals()).toMatch(/manual_sections[\s\S]*?foreign key \(manual_version_id, organization_id\)\s*references manual_versions \(id, organization_id\)/);
    expect(manuals()).toMatch(/manual_blocks[\s\S]*?foreign key \(manual_section_id, organization_id\)\s*references manual_sections \(id, organization_id\)/);
    expect(manuals()).toMatch(/manual_blocks[\s\S]*?foreign key \(image_asset_id, organization_id\)\s*references image_assets \(id, organization_id\)/);
  });

  it("every composite-FK parent exposes unique (id, organization_id)", () => {
    for (const t of ["ea_products", "ea_versions", "parameter_groups"]) {
      expect(ea()).toMatch(new RegExp(`create table ${t}[\\s\\S]*?unique \\(id, organization_id\\)`));
    }
    for (const t of ["image_assets", "manuals", "manual_versions", "manual_sections"]) {
      expect(manuals()).toMatch(new RegExp(`create table ${t}[\\s\\S]*?unique \\(id, organization_id\\)`));
    }
  });

  // ---- Finding 3: template id is explicit + immutable creation evidence ----
  it("manual_versions.template_id is NOT NULL and recorded by the RPC", () => {
    expect(manuals()).toMatch(/manual_versions[\s\S]*?template_id\s+uuid not null references manual_templates/);
    expect(manuals()).toMatch(/manual_versions[\s\S]*?template_version integer not null/);
    expect(rpc()).toMatch(/insert into manual_versions[\s\S]*?template_id, template_version\)/);
    // the app resolves a concrete template and never sends null
    const action = read("features/manuals/actions.ts");
    expect(action).toMatch(/resolveActiveTemplate/);
    expect(action).toMatch(/p_template_id: template\.id/);
    expect(action).not.toMatch(/p_template_id:\s*null/);
    // create_product_version_manual takes an explicit p_template_id (no internal null)
    expect(rpc()).toMatch(/function public\.create_product_version_manual\([\s\S]*?p_template_id uuid,/);
    expect(rpc()).toMatch(/create_manual_with_version\(p_org, v_product, v_version, p_manual_version, p_template_id, p_locale\)/);
  });

  it("manual/manual_version template must be system or same-org (guard trigger)", () => {
    expect(fns()).toMatch(/function app\.guard_manual_template_org/);
    expect(fns()).toMatch(/manuals_guard_template_org\s*\n\s*before insert or update on manuals/);
    expect(fns()).toMatch(/manual_versions_guard_template_org\s*\n\s*before insert or update on manual_versions/);
  });

  // ---- Finding 1: anonymous / PUBLIC RPC access ----
  it("app.assert_author denies an anonymous caller (null auth.uid, not a service request)", () => {
    const sql = core();
    expect(sql).toMatch(/function app\.is_service_request/);
    const body = sql.slice(sql.indexOf("function app.assert_author"));
    const end = body.indexOf("$$;");
    const gate = body.slice(0, end);
    expect(gate).toMatch(/if app\.is_service_request\(\) then\s*\n\s*return;/);
    expect(gate).toMatch(/if auth\.uid\(\) is null then\s*\n\s*raise exception 'forbidden: authentication required'/);
    // a bare `if auth.uid() is null then return;` (the previous unsafe pattern) must be gone
    expect(gate).not.toMatch(/if auth\.uid\(\) is null then\s*\n\s*return;/);
    // is_service_request keys on the JWT role claim, not merely on a null uid
    const svc = sql.slice(sql.indexOf("function app.is_service_request"));
    expect(svc.slice(0, svc.indexOf("$$;"))).toMatch(/request\.jwt\.claims[\s\S]*?->>\s*'role'\s*=\s*'service_role'/);
  });

  it("every public mutating RPC + privileged app.* helper has EXECUTE revoked from PUBLIC and anon", () => {
    const sql = rpc();
    const publicRpcs = [
      "public.create_ea_version_with_setups",
      "public.replace_ea_version_setups",
      "public.create_manual_with_version",
      "public.create_product_version_manual",
      "public.reorder_manual_blocks",
      "public.reorder_parameter_groups",
      "public.reorder_ea_parameters",
    ];
    const appHelpers = [
      "app.assert_author",
      "app.assert_reorder_list",
      "app.is_service_request",
      "app.instantiate_manual_sections",
      "app.instantiate_sections_from_template",
      "app.copy_parameter_definitions",
    ];
    for (const fn of publicRpcs) {
      expect(sql).toContain(`'${fn}(`); // listed in the revoke/grant do-block
    }
    for (const fn of appHelpers) {
      expect(sql).toContain(`'${fn}(`);
    }
    expect(sql).toMatch(/revoke execute on function %s from public/);
    expect(sql).toMatch(/revoke execute on function %s from anon/);
    expect(sql).toMatch(/grant execute on function %s to authenticated, service_role/); // public RPCs
    expect(sql).toMatch(/grant execute on function %s to service_role/); // app.* helpers -> service_role only
  });

  it("every SECURITY DEFINER mutating RPC gates on app.assert_author (spec §2)", () => {
    const sql = rpc();
    for (const fn of [
      "create_ea_version_with_setups",
      "create_manual_with_version",
      "create_product_version_manual",
      "replace_ea_version_setups",
      "reorder_manual_blocks",
      "reorder_parameter_groups",
      "reorder_ea_parameters",
    ]) {
      const body = sql.slice(sql.indexOf(`function public.${fn}`));
      expect(body.slice(0, body.indexOf("$$;"))).toMatch(/perform app\.assert_author\(/);
    }
    // privileged helpers also gate
    expect(fns()).toMatch(/function app\.instantiate_sections_from_template[\s\S]*?perform app\.assert_author\(v_org\)/);
    expect(fns()).toMatch(/function app\.copy_parameter_definitions[\s\S]*?perform app\.assert_author\(v_target_org\)/);
  });

  // ---- Finding 6: hardened reorder RPCs ----
  it("reorder RPCs independently validate the id list (dup / count / foreign)", () => {
    const sql = rpc();
    const helper = sql.slice(sql.indexOf("function app.assert_reorder_list"));
    const hbody = helper.slice(0, helper.indexOf("$$;"));
    expect(hbody).toMatch(/duplicate ids/);
    expect(hbody).toMatch(/does not match the current rows/);
    expect(hbody).toMatch(/contains a null id/);
    for (const fn of ["reorder_manual_blocks", "reorder_parameter_groups", "reorder_ea_parameters"]) {
      const body = sql.slice(sql.indexOf(`function public.${fn}`));
      expect(body.slice(0, body.indexOf("$$;"))).toMatch(/perform app\.assert_reorder_list\(p_ordered_ids, v_actual\)/);
      expect(body.slice(0, body.indexOf("$$;"))).toMatch(/if not found then\s*\n\s*raise exception/); // foreign-id catch
    }
  });

  // ---- Finding 5: cross-org copy attack path ----
  it("copy_parameter_definitions blocks a cross-organisation copy", () => {
    const body = fns().slice(fns().indexOf("function app.copy_parameter_definitions"));
    expect(body).toMatch(/v_source_org is distinct from v_target_org/);
  });

  // ---- RLS role-awareness ----
  it("RLS: content writes require can_author; admin tables require is_admin; no blanket member write", () => {
    const sql = rls();
    for (const t of [
      "ea_products", "ea_versions", "ea_version_setups", "parameter_groups", "ea_parameters",
      "manuals", "manual_versions", "manual_sections", "manual_blocks", "image_assets", "audit_events",
    ]) {
      expect(sql).toMatch(new RegExp(`alter table\\s+${t}\\s+enable row level security`));
    }
    expect(sql).toMatch(/for insert to authenticated with check \(app\.can_author\(organization_id\)\)/);
    expect(sql).toMatch(/for update to authenticated using \(app\.can_author\(organization_id\)\)/);
    expect(sql).toMatch(/for delete to authenticated using \(app\.can_author\(organization_id\)\)/);
    expect(sql).not.toMatch(/for insert to authenticated with check \(organization_id in \(select app\.member_org_ids\(\)\)\)/);
    expect(sql).toMatch(/membership_write_admin[\s\S]*app\.is_admin\(organization_id\)/);
    expect(sql).toMatch(/manual_images_write[\s\S]*app\.can_author/);
  });

  it("multi-role memberships: unique (organization_id, user_id, role); can_author / member_roles helpers", () => {
    const sql = core();
    expect(sql).toMatch(/create table memberships[\s\S]*unique \(organization_id, user_id, role\)/);
    expect(sql).not.toMatch(/create table memberships[\s\S]*unique \(organization_id, user_id\)\s*\n\s*\)/);
    expect(sql).toMatch(/function app\.can_author/);
    expect(sql).toMatch(/function app\.member_roles/);
    expect(sql).toMatch(/function app\.is_admin/);
  });

  // ---- Findings 7 / 9 ----
  it("uploadManualImage: final storage key up front (no pending state), roll back on upload failure, persists width/height", () => {
    const action = read("features/images/actions.ts");
    expect(action).toMatch(/const storageKey = `\$\{orgId\}\/\$\{assetId\}\./);
    expect(action).not.toMatch(/storage_key:\s*`?pending/);
    expect(action).toMatch(/if \(upErr\) \{[\s\S]*?\.from\("image_assets"\)\.delete\(\)\.eq\("id", assetId\)/);
    expect(action).toMatch(/width: dims\.width/);
    expect(action).toMatch(/height: dims\.height/);
  });

  it("audit rows + server logs carry a request id (AC-P2-23)", () => {
    expect(read("middleware.ts")).toMatch(/x-request-id/);
    expect(read("features/audit/write.ts")).toMatch(/requestId/);
    expect(read("lib/observability/request-id.ts")).toMatch(/getRequestId/);
    expect(read("lib/supabase/errors.ts")).toMatch(/logServerError\("db"/);
  });

  it("replaceSupportedSetups is atomic (RPC, not separate delete+insert); block CRUD actions exist", () => {
    const setupAction = read("features/setups/actions.ts");
    expect(setupAction).toMatch(/rpc\("replace_ea_version_setups"/);
    expect(setupAction).not.toMatch(/\.from\("ea_version_setups"\)\s*\.delete\(\)/);
    const blockAction = read("features/blocks/actions.ts");
    for (const fn of ["createBlock", "updateBlock", "softDeleteBlock", "restoreBlock", "reorderBlocks"]) {
      expect(blockAction).toContain(`export async function ${fn}`);
    }
    expect(blockAction).toMatch(/parseBlockPayload\(/);
    expect(blockAction).toMatch(/rpc\("reorder_manual_blocks"/);
  });
});
