import "@testing-library/jest-dom/vitest";

// Deterministic, credential-free test environment. Integration suites that need a
// live Supabase project guard themselves with `describe.skipIf(!process.env.SUPABASE_SECRET_KEY)`.
process.env.TZ = "UTC";

// `@supabase/supabase-js` constructs a RealtimeClient in `createClient()` which needs a global
// `WebSocket`. Node < 22 has none; the integration suite talks only HTTP (PostgREST/RPC) and
// never opens a realtime socket, so a constructor-satisfying polyfill from undici is enough.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  try {
    const { WebSocket } = await import("undici");
    (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
  } catch {
    /* undici unavailable — integration suites will surface a clear error instead */
  }
}
