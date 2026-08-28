import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ManualTable } from "@/features/manuals/manual-table";

export default function ManualsPage() {
  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Dokumentasi"
        title="Manual Book"
        description="Kelola versi manual, kelengkapan bab, dan kesiapan review untuk setiap produk EA."
        action={<Link className="primary-button" href="/manuals/new"><Plus aria-hidden="true" size={18} /> Buat manual</Link>}
      />
      <section className="card manual-list-card"><ManualTable /></section>
    </div>
  );
}
