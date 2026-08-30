import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ManualTable } from "@/features/manuals/manual-table";
import { getRequiredWorkspacePageContext } from "@/lib/auth/context";
import { canAny } from "@/lib/permissions/actions";
import { listManuals } from "@/features/manuals/queries";

export const dynamic = "force-dynamic";

export default async function ManualsPage() {
  const { activeOrg } = await getRequiredWorkspacePageContext();
  const rows = await listManuals(activeOrg.id);
  const canCreateManual = canAny(activeOrg.roles, "manual:create");

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Dokumentasi"
        title="Manual Book"
        description="Kelola versi manual, kelengkapan bab, dan kesiapan review untuk setiap produk EA."
        action={
          canCreateManual ? (
            <Link className="primary-button" href="/manuals/new">
              <Plus aria-hidden="true" size={18} /> Buat manual
            </Link>
          ) : undefined
        }
      />
      <section className="card manual-list-card">
        <ManualTable rows={rows} canCreate={canCreateManual} />
      </section>
    </div>
  );
}
