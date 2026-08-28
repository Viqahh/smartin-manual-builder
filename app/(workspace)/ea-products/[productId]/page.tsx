import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getWorkspaceContext } from "@/lib/auth/context";
import { getEaProduct } from "@/features/ea-products/queries";
import { listEaVersions, getEaVersionWithSetups } from "@/features/ea-versions/queries";
import { VersionCreateForm } from "@/features/ea-versions/version-create-form";
import { SupportedConfigurationEditor, type SetupRow } from "@/features/setups/setup-editor";
import { ParameterManager } from "@/features/parameters/parameter-manager";
import { listParameterGroups } from "@/features/parameters/queries";
import type { MtTimeframe } from "@/lib/domain/timeframes";

export const dynamic = "force-dynamic";

export default async function EAProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const ctx = await getWorkspaceContext();
  const orgId = ctx.activeOrg!.id;

  const product = await getEaProduct(orgId, productId);
  if (!product) notFound();

  const versions = await listEaVersions(orgId, productId);
  const versionsWithSetups = await Promise.all(
    versions.map(async (v) => ({
      meta: v,
      detail: await getEaVersionWithSetups(orgId, v.id),
      parameterGroups: await listParameterGroups(orgId, v.id),
    })),
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <Link className="text-link" href="/ea-products">
            <ArrowLeft aria-hidden="true" size={15} /> Semua produk EA
          </Link>
          <h1>{product.name as string}</h1>
          <p>{(product.description as string) || "Tanpa deskripsi."}</p>
        </div>
        <div className="page-actions">
          <VersionCreateForm eaProductId={productId} />
        </div>
      </div>

      <section className="card">
        <div className="section-heading">
          <div>
            <h2>Identitas produk</h2>
          </div>
        </div>
        <dl className="detail-dl">
          <div>
            <dt>Slug</dt>
            <dd className="mono">{product.slug as string}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{product.archived_at ? "Diarsipkan" : "Aktif"}</dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <h2>Versi EA</h2>
            <p>Konfigurasi yang didukung dan parameter dimiliki oleh setiap versi EA.</p>
          </div>
        </div>

        {versionsWithSetups.length === 0 ? (
          <div className="empty-state">
            <h3>Belum ada versi EA</h3>
            <p>Buat versi EA pertama untuk mulai mendokumentasikan.</p>
          </div>
        ) : (
          <ul className="version-list">
            {versionsWithSetups.map(({ meta, detail, parameterGroups }) => (
              <li key={meta.id} className="version-item">
                <div className="version-head">
                  <strong className="mono">{meta.version}</strong>
                  <span className="platform-badge">{meta.platform}</span>
                  <span className="version-meta">
                    {meta.setupCount} konfigurasi · {meta.manualVersionCount} versi manual
                  </span>
                </div>
                {detail && (
                  <>
                    <h4 className="version-subhead">Konfigurasi yang didukung</h4>
                    <SupportedConfigurationEditor
                      eaVersionId={meta.id}
                      initial={detail.setups
                        .sort((a, b) => a.position - b.position)
                        .map(
                          (s): SetupRow => ({
                            symbol: s.symbol,
                            timeframe: s.timeframe as MtTimeframe,
                            presetRef: s.preset_ref ?? "",
                            testedMinimumLot: s.tested_minimum_lot === null ? "" : String(s.tested_minimum_lot),
                            notes: s.notes ?? "",
                            isSupported: s.is_supported,
                          }),
                        )}
                    />
                    <h4 className="version-subhead">Parameter EA</h4>
                    <ParameterManager eaVersionId={meta.id} initialGroups={parameterGroups} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
