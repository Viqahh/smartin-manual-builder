import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";

const products = [
  { name: "VMax EA", platform: "MT5", version: "1.0.0", manuals: 1, status: "Aktif" },
  { name: "Smart Grid Pro", platform: "MT5", version: "2.4.1", manuals: 3, status: "Aktif" },
  { name: "Momentum Edge", platform: "MT4", version: "3.1.0", manuals: 4, status: "Aktif" },
];

export default function EAProductsPage() {
  return (
    <div className="page-container">
      <PageHeader eyebrow="Produk EA" title="My EA Products" description="Sumber data identitas, versi, kebutuhan teknis, dan dokumentasi untuk setiap EA." action={<Link className="primary-button" href="/manuals/new"><Plus aria-hidden="true" size={18} /> Tambah produk</Link>} />
      <section className="card product-grid" aria-label="Daftar produk EA">
        {products.map((product) => <article key={product.name}><div className="product-logo">EA</div><div><span className="status-badge" data-status="PUBLISHED">{product.status}</span><h2>{product.name}</h2><p>{product.platform} · versi <span className="mono">{product.version}</span></p></div><dl><div><dt>Manual</dt><dd>{product.manuals}</dd></div><div><dt>Platform</dt><dd>{product.platform}</dd></div></dl><Link href="/manuals">Lihat dokumentasi</Link></article>)}
      </section>
    </div>
  );
}
