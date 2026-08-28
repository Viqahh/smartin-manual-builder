import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ManualTable } from "@/features/manuals/manual-table";
import { getWorkspaceContext } from "@/lib/auth/context";
import { listManuals } from "@/features/manuals/queries";

export const dynamic = "force-dynamic";

export default async function ManualsPage() {
  const ctx = await getWorkspaceContext();
  const rows = await listManuals(ctx.activeOrg!.id);

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Dokumentasi"
        title="Manual Book"
        description="Kelola versi manual, kelengkapan bab, dan kesiapan review untuk setiap produk EA."
        action={
          <Link className="primary-button" href="/manuals/new">
            <Plus aria-hidden="true" size={18} /> Buat manual
          </Link>
        }
      />
      <section className="card manual-list-card">
        <ManualTable rows={rows} />
      </section>
    </div>
  );
}
