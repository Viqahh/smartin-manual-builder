import { notFound } from "next/navigation";
import { getRequiredWorkspacePageContext } from "@/lib/auth/context";
import { canAny } from "@/lib/permissions/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getReviewHistory } from "@/features/reviews/queries";
import { ReviewHistoryView } from "@/features/reviews/review-history";

export const dynamic = "force-dynamic";

/**
 * AC-P6-15 — decision + comment history for one Manual Version. Private workspace data:
 * `getRequiredWorkspacePageContext()` redirects an unauthenticated / no-membership request (a page
 * renders concurrently with the layout, so the layout redirect alone is not enough); then this
 * page requires `manual:read` in the caller's active org and every query is org-scoped (RLS +
 * explicit `.eq("organization_id", …)`), so a cross-org manual id yields notFound. Not the Phase 7
 * public route.
 */
export default async function ReviewHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ manualId: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { manualId } = await params;
  const { v } = await searchParams;
  const ctx = await getRequiredWorkspacePageContext();
  if (!ctx) return null; // Supabase not configured — the workspace layout renders the setup panel
  const { activeOrg } = ctx;
  const orgId = activeOrg.id;
  if (!canAny(activeOrg.roles, "manual:read")) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: manual } = await supabase
    .from("manuals")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", manualId)
    .maybeSingle();
  if (!manual) notFound();

  // canonical ordering: latest = greatest created_at
  const { data: versions } = await supabase
    .from("manual_versions")
    .select("id, version, created_at")
    .eq("organization_id", orgId)
    .eq("manual_id", manualId)
    .order("created_at", { ascending: false });
  if (!versions || versions.length === 0) notFound();

  const chosen =
    (v && versions.find((x) => x.id === v)?.id) || (versions[0].id as string);
  const history = await getReviewHistory(orgId, manualId, chosen);
  if (!history) notFound();

  return (
    <ReviewHistoryView
      history={history}
      manualId={manualId}
      siblings={versions.map((x) => ({ manualVersionId: x.id as string, version: x.version as string }))}
    />
  );
}
