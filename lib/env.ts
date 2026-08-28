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

export type ReadinessCheck = { name: string; ok: boolean; detail?: string };

/** Server-only readiness: health = app up; readiness = required config present. */
export function readinessChecks(): { ready: boolean; checks: ReadinessCheck[] } {
  const secret = clean(process.env.SUPABASE_SECRET_KEY);
  const checks: ReadinessCheck[] = [
    { name: "NEXT_PUBLIC_SUPABASE_URL", ok: Boolean(publicEnv.supabaseUrl) },
    { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ok: Boolean(publicEnv.supabasePublishableKey) },
    { name: "SUPABASE_SECRET_KEY", ok: Boolean(secret) },
    { name: "APP_URL", ok: Boolean(publicEnv.appUrl) },
  ];
  return { ready: checks.every((c) => c.ok), checks };
}
