import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Append an audit event (PRD-SEC-007). Best-effort: an audit write failure must not
 * fail the primary mutation, but it is logged server-side.
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
    const supabase = await createSupabaseServerClient();
    await supabase.from("audit_events").insert({
      organization_id: orgId,
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
    });
  } catch (e) {
    console.error("[audit] failed to record", { action, entityType, error: (e as Error).message });
  }
}
