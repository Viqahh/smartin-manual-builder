import { ArrowLeft, FileDown, Info, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ManualRenderer } from "@/components/manual-renderer/manual-renderer";
import { PdfDownloadButton } from "@/components/public-manual/pdf-download-button";
import { getRequiredWorkspacePageContext } from "@/lib/auth/context";
import { canAny } from "@/lib/permissions/actions";
import { SupabaseManualDataSource } from "@/features/manuals/data-source";
import { getPublishedSnapshotMeta } from "@/features/reviews/queries";
import { retryPdfArtifact } from "@/features/manuals/publication-actions";
import { assembleManualViewModel, manualIdentity } from "@/lib/manual/view-model";
import { pdfFilename } from "@/lib/pdf/filename";
import { pdfArtifactUiStatus } from "@/lib/pdf/artifact-download";

export const dynamic = "force-dynamic";

export default async function ManualPreviewPage({
  params,
}: {
  params: Promise<{ manualId: string }>;
}) {
  const { manualId } = await params;
  const { activeOrg } = await getRequiredWorkspacePageContext();

  const source = new SupabaseManualDataSource(activeOrg.id);
  const vm = await assembleManualViewModel(source, manualId);
  if (!vm) notFound();
  const id = manualIdentity(vm);
  const canEdit = canAny(activeOrg.roles, "manual:update");
  const canPublish = canAny(activeOrg.roles, "manual:publish");

  // Export PDF is enabled only once this exact version has a frozen published snapshot; the
  // download reads the immutable stored artifact for that snapshot (PUBLISHED or ARCHIVED).
  const snap = await getPublishedSnapshotMeta(activeOrg.id, vm.manualVersion.id).catch(() => null);
  const pdf = snap
    ? {
        href: `/manual/${snap.publicSlug}/${snap.publicVersion}/pdf`,
        filename: pdfFilename(vm.eaProduct.name, snap.publicVersion),
        status: await pdfArtifactUiStatus(snap.publicSlug, snap.publicVersion),
      }
    : null;

  async function doRetry() {
    "use server";
    await retryPdfArtifact({ manualId });
  }

  return (
    <div className="preview-page">
      <header className="preview-toolbar">
        <div>
          <Link
            className="icon-button"
            href={`/manuals/${manualId}/edit`}
            aria-label={canEdit ? "Kembali ke editor" : "Kembali ke tampilan bab"}
          >
            <ArrowLeft aria-hidden="true" />
          </Link>
          <div>
            <p className="eyebrow">Preview manual</p>
            <h1>
              {id.eaName} · v{id.manualVersion}
            </h1>
          </div>
        </div>
        <div>
          {canEdit && (
            <Link className="secondary-button" href={`/manuals/${manualId}/edit`}>
              <Pencil aria-hidden="true" size={17} /> Edit manual
            </Link>
          )}
          {pdf ? (
            <PdfDownloadButton
              href={pdf.href}
              filename={pdf.filename}
              status={pdf.status}
              retryAction={canPublish ? doRetry : undefined}
            />
          ) : (
            <button className="primary-button" disabled title="Terbitkan manual untuk mengaktifkan ekspor PDF">
              <FileDown aria-hidden="true" size={17} /> Ekspor PDF
            </button>
          )}
        </div>
      </header>
      <div className="preview-disclosure">
        <Info aria-hidden="true" size={17} /> Preview menggunakan model konten yang sama dengan editor.
        {pdf
          ? " PDF dibuat sekali dari snapshot terbitan dan disimpan sebagai artefak permanen."
          : " Ekspor PDF aktif setelah manual diterbitkan."}
      </div>
      <ManualRenderer vm={vm} />
    </div>
  );
}
