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
  it("app.instantiate_manual_sections seeds exactly the canonical sections", () => {
    const sql = read("supabase/migrations/20260901000400_functions_triggers.sql");
    for (const s of CANONICAL_SECTIONS) {
      expect(sql).toContain(`'${s.key}'`);
      expect(sql).toContain(`, ${s.order})`);
    }
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
});
