import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateManualWizard } from "@/features/manuals/create-manual-wizard";
import { getRequiredWorkspacePageContext } from "@/lib/auth/context";
import { canAny } from "@/lib/permissions/actions";
import { listProductsWithVersions } from "@/features/ea-versions/queries";

export const dynamic = "force-dynamic";

export default async function CreateManualPage() {
  const { activeOrg } = await getRequiredWorkspacePageContext();
  const canCreateManual = canAny(activeOrg.roles, "manual:create");

  if (!canCreateManual) {
    return (
      <div className="wizard-page">
        <div className="wizard-page-heading">
          <p className="eyebrow">Manual baru</p>
          <h1>Buat Manual Book</h1>
        </div>
        <section className="card system-panel" data-tone="warning">
          <div className="system-panel-body">
            <h2>Tidak tersedia untuk peran Anda</h2>
            <p>Pembuatan manual hanya untuk Developer atau Admin. Peran peninjau memiliki akses baca.</p>
            <Link className="secondary-button" href="/manuals">
              <ArrowLeft aria-hidden="true" size={15} /> Kembali ke daftar manual
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const products = await listProductsWithVersions(activeOrg.id);

  return (
    <div className="wizard-page">
      <div className="wizard-page-heading">
        <p className="eyebrow">Manual baru</p>
        <h1>Buat Manual Book</h1>
        <p>Pilih produk EA yang ada atau buat produk baru, lalu buat versi manual pertama.</p>
      </div>
      <CreateManualWizard products={products} />
    </div>
  );
}
