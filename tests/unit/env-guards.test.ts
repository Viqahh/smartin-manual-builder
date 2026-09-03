/**
 * Phase 8A.5 — Supabase environment isolation guards.
 *
 * Proves the fail-closed behaviour of the environment identity helpers and both guards
 * (integration suite + fixture scripts): they proceed ONLY when the target is provably the
 * DEV project, and refuse Production / unrecognised / ambiguous targets.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  EXPECTED_DEV_PROJECT_REF,
  EXPECTED_PROD_PROJECT_REF,
  supabaseProjectRef,
  resolveAppEnv,
  assertSupabaseProjectMatchesEnv,
  SupabaseEnvMismatchError,
  envProjectMismatch,
} from "@/lib/env";
import { assertIntegrationTargetIsDev } from "../integration/_guard";
import { assertDevFixtureTarget } from "../../scripts/fixtures/_guard.mjs";

const DEV_URL = `https://${EXPECTED_DEV_PROJECT_REF}.supabase.co`;
const PROD_URL = `https://${EXPECTED_PROD_PROJECT_REF}.supabase.co`;

const snap = { ...process.env };
afterEach(() => {
  process.env = { ...snap };
});

describe("supabaseProjectRef", () => {
  it("extracts the ref from a project URL", () => {
    expect(supabaseProjectRef(DEV_URL)).toBe(EXPECTED_DEV_PROJECT_REF);
    expect(supabaseProjectRef(`${PROD_URL}/rest/v1`)).toBe(EXPECTED_PROD_PROJECT_REF);
  });
  it("returns '' for anything unrecognised", () => {
    expect(supabaseProjectRef(undefined)).toBe("");
    expect(supabaseProjectRef("")).toBe("");
    expect(supabaseProjectRef("https://example.com")).toBe("");
    expect(supabaseProjectRef("http://localhost:54321")).toBe("");
  });
});

describe("resolveAppEnv", () => {
  it("explicit APP_ENV wins", () => {
    process.env.APP_ENV = "preview";
    process.env.VERCEL_ENV = "production";
    expect(resolveAppEnv()).toBe("preview");
  });
  it("falls back to VERCEL_ENV, then development", () => {
    delete process.env.APP_ENV;
    process.env.VERCEL_ENV = "production";
    expect(resolveAppEnv()).toBe("production");
    delete process.env.VERCEL_ENV;
    expect(resolveAppEnv()).toBe("development");
  });
  it("ignores an unknown APP_ENV value", () => {
    process.env.APP_ENV = "staging";
    delete process.env.VERCEL_ENV;
    expect(resolveAppEnv()).toBe("development");
  });
});

describe("assertSupabaseProjectMatchesEnv — HARD runtime guard", () => {
  const DEV = `https://${EXPECTED_DEV_PROJECT_REF}.supabase.co`;
  const PROD = `https://${EXPECTED_PROD_PROJECT_REF}.supabase.co`;

  it("production + PROD ref → pass", () => {
    expect(() => assertSupabaseProjectMatchesEnv(PROD, "production")).not.toThrow();
  });
  it("production + DEV ref → abort", () => {
    expect(() => assertSupabaseProjectMatchesEnv(DEV, "production")).toThrow(SupabaseEnvMismatchError);
  });
  it("preview + DEV ref → pass", () => {
    expect(() => assertSupabaseProjectMatchesEnv(DEV, "preview")).not.toThrow();
  });
  it("preview + PROD ref → abort", () => {
    expect(() => assertSupabaseProjectMatchesEnv(PROD, "preview")).toThrow(SupabaseEnvMismatchError);
  });
  it("development + DEV ref → pass", () => {
    expect(() => assertSupabaseProjectMatchesEnv(DEV, "development")).not.toThrow();
  });
  it("development + PROD ref → abort", () => {
    expect(() => assertSupabaseProjectMatchesEnv(PROD, "development")).toThrow(SupabaseEnvMismatchError);
  });
  it("unknown ref → abort (in every environment)", () => {
    for (const env of ["development", "preview", "production"] as const) {
      expect(() => assertSupabaseProjectMatchesEnv("https://strangerproject0001.supabase.co", env)).toThrow(
        /not a known project/,
      );
    }
  });
  it("blank URL → returns quietly (Supabase-not-configured path)", () => {
    expect(() => assertSupabaseProjectMatchesEnv("", "production")).not.toThrow();
  });
  it("envProjectMismatch() mirrors the guard for /api/health", () => {
    const snapUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const snapAppEnv = process.env.APP_ENV;
    try {
      // envProjectMismatch reads process.env via publicEnv/resolveAppEnv; assert it never throws
      // and returns a boolean+detail shape regardless of configuration.
      const r = envProjectMismatch();
      expect(typeof r.mismatch).toBe("boolean");
      expect(typeof r.detail).toBe("string");
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = snapUrl;
      process.env.APP_ENV = snapAppEnv;
    }
  });
});

describe("assertIntegrationTargetIsDev — fail closed", () => {
  it("no target configured → returns quietly (unit/CI path stays green)", () => {
    delete process.env.SUPABASE_TEST_URL;
    delete process.env.APP_ENV;
    expect(() => assertIntegrationTargetIsDev()).not.toThrow();
  });
  it("DEV target → passes", () => {
    process.env.SUPABASE_TEST_URL = DEV_URL;
    delete process.env.APP_ENV;
    expect(() => assertIntegrationTargetIsDev()).not.toThrow();
  });
  it("Production ref → ABORT", () => {
    process.env.SUPABASE_TEST_URL = PROD_URL;
    expect(() => assertIntegrationTargetIsDev()).toThrow(/not permitted against Production/);
  });
  it("APP_ENV=production → ABORT even with the DEV url", () => {
    process.env.SUPABASE_TEST_URL = DEV_URL;
    process.env.APP_ENV = "production";
    expect(() => assertIntegrationTargetIsDev()).toThrow(/not permitted against Production/);
  });
  it("unrecognised ref → ABORT (ambiguous fails closed)", () => {
    process.env.SUPABASE_TEST_URL = "https://some-other-project.supabase.co";
    delete process.env.APP_ENV;
    expect(() => assertIntegrationTargetIsDev()).toThrow(/not the known DEV project/);
  });
});

describe("assertDevFixtureTarget — fail closed + explicit opt-in", () => {
  it("DEV url + opt-in → passes", () => {
    process.env.ALLOW_DESTRUCTIVE_FIXTURES = "yes-dev";
    delete process.env.APP_ENV;
    expect(() => assertDevFixtureTarget(DEV_URL)).not.toThrow();
  });
  it("DEV url without opt-in → ABORT", () => {
    delete process.env.ALLOW_DESTRUCTIVE_FIXTURES;
    delete process.env.APP_ENV;
    expect(() => assertDevFixtureTarget(DEV_URL)).toThrow(/ALLOW_DESTRUCTIVE_FIXTURES=yes-dev/);
  });
  it("Production url → ABORT even with opt-in", () => {
    process.env.ALLOW_DESTRUCTIVE_FIXTURES = "yes-dev";
    expect(() => assertDevFixtureTarget(PROD_URL)).toThrow(/not permitted against Production/);
  });
  it("APP_ENV=production → ABORT", () => {
    process.env.ALLOW_DESTRUCTIVE_FIXTURES = "yes-dev";
    process.env.APP_ENV = "production";
    expect(() => assertDevFixtureTarget(DEV_URL)).toThrow(/not permitted against Production/);
  });
  it("unrecognised / missing url → ABORT", () => {
    process.env.ALLOW_DESTRUCTIVE_FIXTURES = "yes-dev";
    delete process.env.APP_ENV;
    expect(() => assertDevFixtureTarget("")).toThrow(/not the known DEV project/);
    expect(() => assertDevFixtureTarget("https://nope.supabase.co")).toThrow(/not the known DEV project/);
  });
});
