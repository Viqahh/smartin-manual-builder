import "server-only";
import { headers } from "next/headers";

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * The current request id, assigned by `middleware.ts`. Used to correlate structured server
 * logs and `audit_events` rows (PRD-NFR-007, AC-P2-23). Falls back to `"no-request-id"` when
 * called outside a request scope (should not happen for server actions / route handlers).
 */
export async function getRequestId(): Promise<string> {
  try {
    const h = await headers();
    return h.get(REQUEST_ID_HEADER) ?? "no-request-id";
  } catch {
    return "no-request-id";
  }
}

/** Structured server log line that carries the request id and never includes secrets/content. */
export async function logServerError(scope: string, message: string, extra?: Record<string, unknown>) {
  const requestId = await getRequestId();
  console.error(JSON.stringify({ level: "error", scope, requestId, message, ...redact(extra) }));
}

function redact(extra?: Record<string, unknown>): Record<string, unknown> {
  if (!extra) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (/token|secret|key|password|authorization|signedurl|signed_url/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}
