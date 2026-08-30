import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ManualRenderer } from "@/components/manual-renderer/manual-renderer";
import { ManualSearch } from "@/components/public-manual/manual-search";
import { PdfDownloadButton } from "@/components/public-manual/pdf-download-button";
import { PublicToc } from "@/components/public-manual/public-toc";
import { VersionNav } from "@/components/public-manual/version-nav";
import { getPublicManual, PublicSnapshotCorruptError } from "@/lib/publication/get-public-manual";
import { buildToc } from "@/lib/publication/toc";
import { buildPublicSearchIndex } from "@/lib/publication/search-index";
import { pdfFilename } from "@/lib/pdf/filename";
import { pdfArtifactUiStatus } from "@/lib/pdf/artifact-download";
import { logServerError } from "@/lib/observability/request-id";

/**
 * Phase 7 slices 1–2 — the public published-manual route (AC-P7-2, AC-P7-3).
 *
 * Lives OUTSIDE `app/(workspace)` so it is unauthenticated. It renders ONLY from the immutable
 * `published_snapshots` json via `getPublicManual`. This is a server component; the raw snapshot
 * never crosses to the client — the TOC / search / version controls receive only the small
 * sanitized `toc` / `searchIndex` / `publishedVersions` models. PUBLISHED → 200; ARCHIVED → 200 +
 * neutral banner; unknown / never-published → 404; corrupt snapshot → generic 500 (no DB detail).
 */

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ eaSlug: string; version: string }>;

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { eaSlug, version } = await params;
  try {
    const res = await getPublicManual(eaSlug, version);
    if (!res) return { title: "Manual tidak ditemukan" };
    const name = res.vm.eaProduct.name || "Expert Advisor";
    return { title: `${name} · Manual v${res.publicVersion}` };
  } catch {
    return { title: "Manual" };
  }
}

export default async function PublicManualPage({ params }: { params: RouteParams }) {
  const { eaSlug, version } = await params;

  let res;
  try {
    res = await getPublicManual(eaSlug, version);
  } catch (e) {
    if (e instanceof PublicSnapshotCorruptError) {
      await logServerError("publication", "public snapshot verification failed", { slug: eaSlug, version });
      throw new Error("Dokumen tidak dapat ditampilkan saat ini.");
    }
    throw e;
  }
  if (!res) notFound();

  const toc = buildToc(res.vm);
  const searchIndex = buildPublicSearchIndex(res.vm);
  const eaName = res.vm.eaProduct.name || "Expert Advisor";
  const pdfStatus = await pdfArtifactUiStatus(res.publicSlug, res.publicVersion);

  return (
    <div className="pm-shell">
      <a className="pm-skip" href="#manual-content">
        Langsung ke isi manual
      </a>

      <header className="pm-header">
        <div className="pm-header-top">
          <p className="pm-header-title">
            {eaName} · <span className="mono">v{res.publicVersion}</span>
          </p>
          <ManualSearch index={searchIndex} />
          <PdfDownloadButton
            className="secondary-button"
            label="Unduh PDF"
            status={pdfStatus}
            href={`/manual/${res.publicSlug}/${res.publicVersion}/pdf`}
            filename={pdfFilename(eaName, res.publicVersion)}
          />
        </div>
        <VersionNav
          versions={res.publishedVersions}
          current={res.publicVersion}
          slug={res.publicSlug}
          state={res.publicationState}
        />
      </header>

      <div className="pm-body">
        <PublicToc toc={toc} />

        <main id="manual-content" className="public-manual" tabIndex={-1}>
          {res.publicationState === "ARCHIVED" && (
            <aside className="public-manual-banner" role="status">
              <p>Versi ini telah diarsipkan.</p>
              {res.latestPublishedVersion && (
                <a href={`/manual/${res.publicSlug}/${res.latestPublishedVersion}`}>Lihat versi terbaru.</a>
              )}
            </aside>
          )}
          <ManualRenderer vm={res.vm} />
        </main>
      </div>
    </div>
  );
}
