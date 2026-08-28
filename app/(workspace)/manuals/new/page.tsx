import { CreateManualWizard } from "@/features/manuals/create-manual-wizard";
import { getWorkspaceContext } from "@/lib/auth/context";
import { listProductsWithVersions } from "@/features/ea-versions/queries";

export const dynamic = "force-dynamic";

export default async function CreateManualPage() {
  const ctx = await getWorkspaceContext();
  const products = await listProductsWithVersions(ctx.activeOrg!.id);

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
