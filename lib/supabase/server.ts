import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { publicEnv, isSupabaseConfigured } from "@/lib/env";

export class SupabaseNotConfiguredError extends Error {
  readonly code = "NOT_CONFIGURED" as const;
  constructor() {
    super("Supabase belum dikonfigurasi. Lihat .env.example / docs/PHASE_2.md.");
    this.name = "SupabaseNotConfiguredError";
  }
}

/**
 * Request-scoped Supabase client bound to the caller's cookie session (RLS applies).
 * Use inside server components, route handlers, and server actions.
 */
export async function createSupabaseServerClient() {
  if (!isSupabaseConfigured()) throw new SupabaseNotConfiguredError();
  const cookieStore = await cookies();
  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `set` throws in a pure Server Component render; middleware refreshes the session instead.
        }
      },
    },
  });
}

/** Returns the client, or `null` when Supabase is not configured (env-gated pages). */
export async function createSupabaseServerClientOrNull() {
  if (!isSupabaseConfigured()) return null;
  return createSupabaseServerClient();
}
