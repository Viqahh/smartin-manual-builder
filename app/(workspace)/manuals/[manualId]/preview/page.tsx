import { ArrowLeft, FileDown, Info, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ManualRenderer } from "@/components/manual-renderer/manual-renderer";
import { getWorkspaceContext } from "@/lib/auth/context";
import { canAny } from "@/lib/permissions/actions";
import { SupabaseManualDataSource } from "@/features/manuals/data-source";
import { assembleManualViewModel, manualIdentity } from "@/lib/manual/view-model";

export const dynamic = "force-dynamic";

export default async function ManualPreviewPage({
  params,
}: {
  params: Promise<{ manualId: string }>;
}) {
  const { manualId } = await params;
  const ctx = await getWorkspaceContext();

  const source = new SupabaseManualDataSource(ctx.activeOrg!.id);
  const vm = await assembleManualViewModel(source, manualId);
  if (!vm) notFound();
  const id = manualIdentity(vm);
  const canEdit = canAny(ctx.activeOrg?.roles ?? [], "manual:update");

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
          <button className="primary-button" disabled title="Ekspor PDF tersedia pada Phase 7">
            <FileDown aria-hidden="true" size={17} /> Ekspor PDF
          </button>
        </div>
      </header>
      <div className="preview-disclosure">
        <Info aria-hidden="true" size={17} /> Preview menggunakan model konten yang sama dengan editor. Ekspor PDF diaktifkan pada
        Phase 7.
      </div>
      <ManualRenderer vm={vm} />
    </div>
  );
}
