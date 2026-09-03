/**
 * Environment contract + startup validation (docs/DEPENDENCIES.md, PRD-PLT-003, AC-P2-2).
 *
 * - `SUPABASE_SECRET_KEY` is read ONLY here and in `lib/supabase/service.ts` (server-only).
 *   It is never referenced from a client component, so it cannot enter the browser bundle (GI-9).
 * - When the Supabase trio is absent the app still boots: `/api/health` reports
 *   `ok:true, ready:false` and the workspace renders a "belum dikonfigurasi" state.
 */

import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional().or(z.literal("")),
  APP_URL: z.string().url().default("http://localhost:3000"),
});

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().optional().or(z.literal("")),
  AI_PROVIDER: z.string().optional().or(z.literal("")),
  AI_API_KEY: z.string().optional().or(z.literal("")),
});

function clean(v: string | undefined): string {
  return (v ?? "").trim();
}

export const publicEnv = {
  supabaseUrl: clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  appUrl: clean(process.env.APP_URL) || "http://localhost:3000",
};

// Parsed for shape validation (throws only on a *malformed* value, e.g. a non-URL APP_URL).
publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: publicEnv.supabaseUrl || undefined,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicEnv.supabasePublishableKey || undefined,
  APP_URL: publicEnv.appUrl,
});

export function serverSecrets() {
  const parsed = serverSchema.parse({
    SUPABASE_SECRET_KEY: clean(process.env.SUPABASE_SECRET_KEY) || undefined,
    AI_PROVIDER: clean(process.env.AI_PROVIDER) || undefined,
    AI_API_KEY: clean(process.env.AI_API_KEY) || undefined,
  });
  return {
    supabaseSecretKey: clean(parsed.SUPABASE_SECRET_KEY),
    aiProvider: clean(parsed.AI_PROVIDER),
    aiApiKey: clean(parsed.AI_API_KEY),
  };
}

/** Browser-safe: does the app have enough to talk to Supabase from the client? */
export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabasePublishableKey);
}

// ---------------------------------------------------------------------------
// Environment identity + hard runtime guard (Phase 8A.5 — Supabase isolation).
//
// DEV/Preview and Production use SEPARATE Supabase projects. These refs are the
// public subdomain of each project URL (NOT secrets). Binding:
//   production            -> ONLY wotidyhpbltoxmzvdqkj
//   development / preview  -> ONLY tmrwhkhydkjaubpuegqa
// An unknown ref or an env/ref that does not match this binding fails closed:
// `assertSupabaseProjectMatchesEnv()` throws at the server/service client
// initialisation boundary so access cannot proceed against the wrong project.
// ---------------------------------------------------------------------------
export const EXPECTED_DEV_PROJECT_REF = "tmrwhkhydkjaubpuegqa";
export const EXPECTED_PROD_PROJECT_REF = "wotidyhpbltoxmzvdqkj";

/** Supabase project ref parsed from a project URL, or "" when unrecognised. */
export function supabaseProjectRef(url: string | undefined): string {
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co(?:\/|$)/i.exec(clean(url));
  return m ? m[1].toLowerCase() : "";
}

export type AppEnv = "development" | "preview" | "production";

/** Explicit `APP_ENV` wins; otherwise derive from Vercel; otherwise `development`. */
export function resolveAppEnv(): AppEnv {
  const explicit = clean(process.env.APP_ENV).toLowerCase();
  if (explicit === "development" || explicit === "preview" || explicit === "production") return explicit;
  const vercel = clean(process.env.VERCEL_ENV).toLowerCase();
  if (vercel === "production") return "production";
  if (vercel === "preview") return "preview";
  return "development";
}

export const appEnv: AppEnv = resolveAppEnv();

/** The one Supabase project ref an environment is allowed to use. */
export function expectedProjectRefFor(env: AppEnv): string {
  return env === "production" ? EXPECTED_PROD_PROJECT_REF : EXPECTED_DEV_PROJECT_REF;
}

export class SupabaseEnvMismatchError extends Error {
  readonly code = "ENV_PROJECT_MISMATCH" as const;
  constructor(message: string) {
    super(message);
    this.name = "SupabaseEnvMismatchError";
  }
}

/**
 * HARD guard. Throws `SupabaseEnvMismatchError` when the configured Supabase URL does not
 * belong to the project this environment is bound to, or when the ref is unknown/ambiguous.
 * A blank URL is the "Supabase not configured" path handled elsewhere — it returns quietly.
 *
 * Called at the server + service client boundary (`lib/supabase/{server,service}.ts`) so
 * server-side data access cannot proceed against the wrong database.
 */
export function assertSupabaseProjectMatchesEnv(
  url: string = publicEnv.supabaseUrl,
  env: AppEnv = resolveAppEnv(),
): void {
  const u = clean(url);
  if (!u) return; // not configured — SupabaseNotConfiguredError covers this path

  const ref = supabaseProjectRef(u);
  if (ref !== EXPECTED_DEV_PROJECT_REF && ref !== EXPECTED_PROD_PROJECT_REF) {
    throw new SupabaseEnvMismatchError(
      `Supabase project ref '${ref || "(unrecognised)"}' is not a known project — refusing to initialise the client.`,
    );
  }
  const expected = expectedProjectRefFor(env);
  if (ref !== expected) {
    throw new SupabaseEnvMismatchError(
      `APP_ENV='${env}' must use Supabase project '${expected}', but the configured URL points at '${ref}'.`,
    );
  }
}

/** Non-fatal observability form of the hard guard, for `/api/health`. */
export function envProjectMismatch(): { mismatch: boolean; detail: string } {
  try {
    assertSupabaseProjectMatchesEnv();
    return { mismatch: false, detail: "" };
  } catch (e) {
    return { mismatch: true, detail: e instanceof Error ? e.message : String(e) };
  }
}

export type ReadinessCheck = { name: string; ok: boolean; detail?: string };

/** Server-only readiness: health = app up; readiness = required config present. */
export function readinessChecks(): { ready: boolean; env: AppEnv; checks: ReadinessCheck[] } {
  const secret = clean(process.env.SUPABASE_SECRET_KEY);
  const mm = envProjectMismatch();
  const checks: ReadinessCheck[] = [
    { name: "NEXT_PUBLIC_SUPABASE_URL", ok: Boolean(publicEnv.supabaseUrl) },
    { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ok: Boolean(publicEnv.supabasePublishableKey) },
    { name: "SUPABASE_SECRET_KEY", ok: Boolean(secret) },
    { name: "APP_URL", ok: Boolean(publicEnv.appUrl) },
    { name: "APP_ENV/project match", ok: !mm.mismatch, detail: mm.detail || undefined },
  ];
  // Readiness is still driven only by required config; a mismatch is surfaced, not fatal.
  const requiredOk = checks.slice(0, 4).every((c) => c.ok);
  return { ready: requiredOk, env: appEnv, checks };
}
