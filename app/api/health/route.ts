import { NextResponse } from "next/server";
import { readinessChecks } from "@/lib/env";

/**
 * Health vs readiness (AC-P2-2):
 *   - health:   the app process is up  -> always `ok: true`
 *   - readiness: required config present -> `ready: false` when a Supabase/APP_URL var is missing
 * The endpoint itself keeps responding regardless.
 */
export function GET() {
  const { ready, env, checks } = readinessChecks();
  return NextResponse.json(
    { ok: true, ready, env, checks },
    { status: ready ? 200 : 503 },
  );
}
