import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverSecrets, assertSupabaseProjectMatchesEnv } from "@/lib/env";

/**
 * Service-role client — BYPASSES RLS. Server-only, used exclusively by trusted jobs:
 *   - atomic multi-table creation (new-EA wizard path) where a single failure must roll back,
 *   - seeding / admin maintenance.
 * The secret key is read only here and in lib/env.ts, so it can never enter the browser bundle
 * (GI-9 / AC-P2-3). Never import this file from a client component.
 */
export function createSupabaseServiceClient() {
  const { supabaseSecretKey } = serverSecrets();
  if (!publicEnv.supabaseUrl || !supabaseSecretKey) {
    throw new Error("Service client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  }
  assertSupabaseProjectMatchesEnv(); // fail closed if this env points at the wrong project
  return createClient(publicEnv.supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function isServiceConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && serverSecrets().supabaseSecretKey);
}
