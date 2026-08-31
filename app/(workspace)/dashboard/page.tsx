import { ArrowRight, BookOpenCheck, Boxes, FileClock, FileText, Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ManualTable } from "@/features/manuals/manual-table";
import { getRequiredWorkspacePageContext } from "@/lib/auth/context";
import { canAny } from "@/lib/permissions/actions";
import { dashboardMetrics, listManuals } from "@/features/manuals/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await getRequiredWorkspacePageContext();
  if (!ctx) return null; // Supabase not configured — the workspace layout renders the setup panel
  const { activeOrg } = ctx;
  const orgId = activeOrg.id;
  const canCreateManual = canAny(activeOrg.roles, "manual:create");

  const [metrics, manuals] = await Promise.all([dashboardMetrics(orgId), listManuals(orgId)]);

  const cards = [
    { label: "Produk EA", value: metrics.eaProducts, icon: Boxes, tone: "blue" },
    { label: "Manual aktif", value: metrics.manualsActive, icon: FileText, tone: "navy" },
    { label: "Menunggu review", value: metrics.awaitingReview, icon: FileClock, tone: "amber" },
    { label: "Diterbitkan", value: metrics.published, icon: BookOpenCheck, tone: "green" },
  ];

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="EA Developer Tools"
        title="Dashboard dokumentasi"
        description="Pantau kesiapan manual, kelengkapan bab, dan proses review dalam satu workspace."
        action={
          canCreateManual ? (
            <Link className="primary-button" href="/manuals/new">
              <Plus aria-hidden="true" size={18} /> Buat manual
            </Link>
          ) : undefined
        }
      />
      <section className="metric-grid" aria-label="Ringkasan dokumentasi">
        {cards.map(({ label, value, icon: Icon, tone }) => (
          <article className="metric-card" key={label}>
            <div className="metric-icon" data-tone={tone}>
              <Icon aria-hidden="true" size={20} />
            </div>
            <div>
              <p>{label}</p>
              <strong>{value}</strong>
              <span>Organisasi {activeOrg.name}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="card dashboard-table-section">
        <div className="section-heading">
          <div>
            <h2>Manual terbaru</h2>
            <p>Status dokumentasi untuk produk EA yang sedang aktif.</p>
          </div>
          <Link className="text-link" href="/manuals">
            Lihat semua <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>
        <ManualTable rows={manuals} compact canCreate={canCreateManual} />
      </section>
    </div>
  );
}
