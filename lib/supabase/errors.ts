import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { type ActionResult, fail, uniqueViolation } from "@/lib/errors";
import { logServerError } from "@/lib/observability/request-id";

/**
 * Translate a Postgrest/Postgres error into a typed ActionResult without leaking
 * SQL, constraint names, or connection details to the client (PRD-SEC-009).
 */
export function mapPostgrestError(
  error: PostgrestError,
  hints: { unique?: Record<string, { path: string; message: string }> } = {},
): ActionResult<never> {
  // 23505 unique_violation, 23503 fk_violation, 23514 check_violation
  if (error.code === "23505") {
    const detail = error.details ?? error.message ?? "";
    for (const [needle, mapped] of Object.entries(hints.unique ?? {})) {
      if (detail.includes(needle)) return uniqueViolation(mapped.path, mapped.message);
    }
    return fail("CONFLICT", "Data serupa sudah ada.");
  }
  if (error.code === "23503") {
    return fail("VALIDATION", "Referensi tidak valid.");
  }
  if (error.code === "23514" || error.message?.includes("check_violation")) {
    return fail("VALIDATION", cleanMessage(error.message));
  }
  if (error.code === "42501" || error.code === "PGRST301") {
    return fail("FORBIDDEN", "Akses ditolak.");
  }
  // Unmapped -> log with the request id (code only, never the raw SQL/message contents).
  void logServerError("db", "unmapped postgrest error", { code: error.code });
  return fail("INTERNAL", "Terjadi kesalahan pada server.");
}

function cleanMessage(message: string): string {
  // surface a domain RAISE message; strip anything that looks like SQL/identifier noise
  const first = message.split("\n")[0]?.trim() ?? "Data tidak valid.";
  return first.length > 200 ? "Data tidak valid." : first;
}
