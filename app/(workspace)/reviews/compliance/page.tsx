import { getWorkspaceContext } from "@/lib/auth/context";
import { listReviewQueue } from "@/features/reviews/queries";
import { ReviewQueue } from "@/features/reviews/review-queue";

export const dynamic = "force-dynamic";

export default async function ComplianceReviewPage() {
  const ctx = await getWorkspaceContext();
  const orgId = ctx.activeOrg!.id;
  const roles = ctx.activeOrg?.roles ?? [];
  const rows = await listReviewQueue(orgId, ctx.user!.id, roles, "compliance").catch(() => []);

  return (
    <ReviewQueue
      eyebrow="Review"
      title="Review kepatuhan"
      description="Antrean review dokumentasi terhadap Perba 12/2022. Keputusan di sini adalah tinjauan internal Smartin atas dokumentasi — bukan persetujuan regulator. Anda hanya melihat manual yang ditugaskan kepada Anda; admin melihat seluruh antrean organisasi."
      rows={rows}
      isAdmin={roles.includes("ADMIN")}
    />
  );
}
