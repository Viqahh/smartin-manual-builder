import { notFound } from "next/navigation";
import { getWorkspaceContext } from "@/lib/auth/context";
import { canAny } from "@/lib/permissions/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getReviewHistory } from "@/features/reviews/queries";
import { ReviewHistoryView } from "@/features/reviews/review-history";

export const dynamic = "force-dynamic";

/**
 * AC-P6-15 — decision + comment history for one Manual Version. Private workspace data:
 * requires `manual:read` in the caller's active org; every query is org-scoped (RLS + explicit
 * `.eq("organization_id", …)`), so a cross-org manual id yields notFound and anon never reaches
 * this route (the workspace layout redirects). Not the Phase 7 public route.
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
  const ctx = await getWorkspaceContext();
  if (!ctx.activeOrg) notFound();
  const orgId = ctx.activeOrg.id;
  if (!canAny(ctx.activeOrg.roles, "manual:read")) notFound();

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
