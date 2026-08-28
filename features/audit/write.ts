import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRequestId, logServerError } from "@/lib/observability/request-id";

/**
 * Append an audit event (PRD-SEC-007). Best-effort: an audit write failure must not fail the
 * primary mutation, but it is logged (with the request id, no contents/secrets — PRD-SEC-009).
 * Every audit row carries the request id in `metadata.requestId` (AC-P2-23).
 */
export async function writeAudit(
  orgId: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const requestId = await getRequestId();
    const supabase = await createSupabaseServerClient();
    await supabase.from("audit_events").insert({
      organization_id: orgId,
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata: { ...metadata, requestId },
    });
  } catch (e) {
    await logServerError("audit", "failed to record audit event", {
      action,
      entityType,
      error: (e as Error).message,
    });
  }
}
