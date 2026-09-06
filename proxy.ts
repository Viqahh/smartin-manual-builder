import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv, isSupabaseConfigured } from "@/lib/env";

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Next 16 Proxy convention (formerly `middleware.ts` → `middleware()`). Runs on the Node.js
 * runtime; the code here is runtime-agnostic (no Edge-only or Node-only APIs) so the rename is
 * behaviour-preserving. `config.matcher` is unchanged.
 *
 * - Assigns a per-request id (`x-request-id`), reused if the caller/proxy already sent one.
 *   It is placed on the forwarded request headers (so Server Components / Actions can read it
 *   via `headers()`) and echoed on the response. Structured server logs + audit rows key on it
 *   (PRD-NFR-007, AC-P2-23).
 * - Refreshes the Supabase auth session so Server Components see a current session.
 *   No Supabase work when unconfigured.
 */
export async function proxy(request: NextRequest) {
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);

  if (!isSupabaseConfigured()) return response;

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
