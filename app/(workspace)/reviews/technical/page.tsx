import { getWorkspaceContext } from "@/lib/auth/context";
import { listReviewQueue } from "@/features/reviews/queries";
import { ReviewQueue } from "@/features/reviews/review-queue";

export const dynamic = "force-dynamic";

export default async function TechnicalReviewPage() {
  const ctx = await getWorkspaceContext();
  const orgId = ctx.activeOrg!.id;
  const roles = ctx.activeOrg?.roles ?? [];
  const rows = await listReviewQueue(orgId, ctx.user!.id, roles, "technical").catch(() => []);

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
