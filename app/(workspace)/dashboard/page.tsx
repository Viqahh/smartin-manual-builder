import { AlertCircle, ArrowRight, BookOpenCheck, Boxes, FileClock, FileText, Plus, Send } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ManualTable } from "@/features/manuals/manual-table";

const metrics = [
  { label: "Produk EA", value: "12", change: "+2 bulan ini", icon: Boxes, tone: "blue" },
  { label: "Manual aktif", value: "9", change: "4 sedang disusun", icon: FileText, tone: "navy" },
  { label: "Menunggu review", value: "3", change: "1 perlu tindakan", icon: FileClock, tone: "amber" },
  { label: "Diterbitkan", value: "6", change: "Versi terbaru", icon: BookOpenCheck, tone: "green" },
];

export default function DashboardPage() {
  return (
    <div className="page-container">
      <PageHeader
        eyebrow="EA Developer Tools"
        title="Dashboard dokumentasi"
        description="Pantau kesiapan manual, checklist, dan proses review dalam satu workspace."
        action={<Link className="primary-button" href="/manuals/new"><Plus aria-hidden="true" size={18} /> Buat manual</Link>}
      />
      <section className="metric-grid" aria-label="Ringkasan dokumentasi">
        {metrics.map(({ label, value, change, icon: Icon, tone }) => (
          <article className="metric-card" key={label}>
            <div className="metric-icon" data-tone={tone}><Icon aria-hidden="true" size={20} /></div>
            <div><p>{label}</p><strong>{value}</strong><span>{change}</span></div>
          </article>
        ))}
      </section>
      <section className="attention-banner" aria-labelledby="attention-title">
        <AlertCircle aria-hidden="true" size={20} />
        <div><h2 id="attention-title">VMax EA memiliki 2 catatan yang perlu ditinjau</h2><p>Lengkapi penjelasan strategi dan pernyataan risiko sebelum mengirim review teknis.</p></div>
        <Link href="/manuals/vmax-ea/edit">Tinjau manual <ArrowRight aria-hidden="true" size={16} /></Link>
      </section>
      <section className="card dashboard-table-section">
        <div className="section-heading">
          <div><h2>Manual terbaru</h2><p>Status dokumentasi untuk produk EA yang sedang aktif.</p></div>
          <Link className="text-link" href="/manuals">Lihat semua <ArrowRight aria-hidden="true" size={16} /></Link>
        </div>
        <ManualTable compact />
      </section>
      <section className="dashboard-bottom-grid">
        <article className="card compact-panel">
          <div className="section-heading"><div><h2>Aktivitas review</h2><p>Pembaruan terbaru dari reviewer.</p></div></div>
          <div className="activity-item"><span className="activity-avatar">RS</span><div><strong>Rina meminta perubahan</strong><p>Nusa Scalper · Bab Risiko</p><time>2 jam lalu</time></div></div>
          <div className="activity-item"><span className="activity-avatar blue">DP</span><div><strong>Dedi menyetujui review teknis</strong><p>Smart Grid Pro v2.4.0</p><time>Kemarin</time></div></div>
        </article>
        <article className="card compact-panel readiness-panel">
          <div className="section-heading"><div><h2>Kesiapan tim</h2><p>Dokumen yang dapat segera dilanjutkan.</p></div></div>
          <div className="readiness-row"><Send aria-hidden="true" /><span><strong>2 manual</strong><small>Siap untuk review teknis</small></span><Link href="/reviews/technical" aria-label="Buka antrean review teknis"><ArrowRight aria-hidden="true" /></Link></div>
          <div className="readiness-row"><BookOpenCheck aria-hidden="true" /><span><strong>1 manual</strong><small>Siap diterbitkan</small></span><Link href="/manuals" aria-label="Buka daftar manual"><ArrowRight aria-hidden="true" /></Link></div>
        </article>
      </section>
    </div>
  );
}
