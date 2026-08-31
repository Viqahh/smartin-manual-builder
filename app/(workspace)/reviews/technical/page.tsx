import { getRequiredWorkspacePageContext } from "@/lib/auth/context";
import { listReviewQueue } from "@/features/reviews/queries";
import { ReviewQueue } from "@/features/reviews/review-queue";

export const dynamic = "force-dynamic";

export default async function TechnicalReviewPage() {
  const ctx = await getRequiredWorkspacePageContext();
  if (!ctx) return null; // Supabase not configured — the workspace layout renders the setup panel
  const { user, activeOrg } = ctx;
  const orgId = activeOrg.id;
  const roles = activeOrg.roles;
  const rows = await listReviewQueue(orgId, user.id, roles, "technical").catch(() => []);

  return (
    <ReviewQueue
      eyebrow="Review"
      title="Review teknis"
      description="Antrean verifikasi kesesuaian manual dengan perilaku Expert Advisor. Anda hanya melihat manual yang ditugaskan kepada Anda; admin melihat seluruh antrean organisasi."
      rows={rows}
      isAdmin={roles.includes("ADMIN")}
    />
  );
}
