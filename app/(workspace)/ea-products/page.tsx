import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { getRequiredWorkspacePageContext } from "@/lib/auth/context";
import { canAny } from "@/lib/permissions/actions";
import { listEaProducts } from "@/features/ea-products/queries";
import { ProductCreateForm } from "@/features/ea-products/product-create-form";

export const dynamic = "force-dynamic";

export default async function EAProductsPage() {
  const { activeOrg } = await getRequiredWorkspacePageContext();
  const products = await listEaProducts(activeOrg.id);
  const canCreateProduct = canAny(activeOrg.roles, "ea_product:create");

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Produk EA"
        title="Produk EA"
        description="Sumber data identitas, versi, konfigurasi yang didukung, dan parameter untuk setiap EA."
        action={canCreateProduct ? <ProductCreateForm /> : undefined}
      />

      {products.length === 0 ? (
        <section className="card empty-state">
          <h2>Belum ada produk EA</h2>
          <p>Tambahkan produk EA pertama untuk organisasi ini.</p>
        </section>
      ) : (
        <section className="card product-grid" aria-label="Daftar produk EA">
          {products.map((p) => (
            <article key={p.id}>
              <div className="product-logo">EA</div>
              <div>
                {p.archivedAt && (
                  <span className="status-badge" data-status="ARCHIVED">
                    Diarsipkan
                  </span>
                )}
                <h2>{p.name}</h2>
                <p>{p.description || "Tanpa deskripsi."}</p>
              </div>
              <dl>
                <div>
                  <dt>Versi</dt>
                  <dd>{p.versionCount}</dd>
                </div>
                <div>
                  <dt>Manual</dt>
                  <dd>{p.manualCount}</dd>
                </div>
              </dl>
              <Link href={`/ea-products/${p.id}`}>Buka produk</Link>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
