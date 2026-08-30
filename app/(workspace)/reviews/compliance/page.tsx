import { getRequiredWorkspacePageContext } from "@/lib/auth/context";
import { listReviewQueue } from "@/features/reviews/queries";
import { ReviewQueue } from "@/features/reviews/review-queue";

export const dynamic = "force-dynamic";

export default async function ComplianceReviewPage() {
  const { user, activeOrg } = await getRequiredWorkspacePageContext();
  const orgId = activeOrg.id;
  const roles = activeOrg.roles;
  const rows = await listReviewQueue(orgId, user.id, roles, "compliance").catch(() => []);

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
