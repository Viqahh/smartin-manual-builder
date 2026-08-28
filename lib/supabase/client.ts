"use client";
import { createBrowserClient } from "@supabase/ssr";
import { publicEnv, isSupabaseConfigured } from "@/lib/env";

let cached: ReturnType<typeof createBrowserClient> | null = null;

/** Browser Supabase client (publishable key only). Returns null when unconfigured. */
export function getSupabaseBrowserClient() {
  if (!isSupabaseConfigured()) return null;
  if (!cached) {
    cached = createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey);
  }
  return cached;
}
