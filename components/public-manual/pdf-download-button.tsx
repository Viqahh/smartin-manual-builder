"use client";

import { useCallback, useState, useTransition } from "react";
import { FileDown, Loader2, RotateCcw } from "lucide-react";

/**
 * Phase 7 slice 4B — the ONE PDF control, shared by the workspace preview toolbar and the public
 * reading page.
 *
 * A READY download is now CHEAP (a stored artifact, no Chromium): fetch → blob → save. The button
 * reflects the immutable-artifact lifecycle:
 *   READY               → "Unduh PDF"          (download)
 *   PENDING / GENERATING → "Menyiapkan PDF…"    (disabled, indeterminate — no fake %)
 *   FAILED (public)      → "PDF belum tersedia" (disabled)
 *   FAILED / NONE (admin, `retryAction` given) → "Buat ulang PDF" (triggers regeneration)
 */

export type PdfArtifactUiStatus = "READY" | "PENDING" | "GENERATING" | "FAILED" | "NONE";

type Props = {
  /** `/manual/<publicSlug>/<publicVersion>/pdf` */
  href: string;
  filename: string;
  status: PdfArtifactUiStatus;
  className?: string;
  label?: string;
  /** authorized workspace users only — regenerate a FAILED / missing artifact */
  retryAction?: () => Promise<void>;
};

export function PdfDownloadButton({
  href,
  filename,
  status,
  className = "primary-button",
  label = "Unduh PDF",
  retryAction,
}: Props) {
  const [local, setLocal] = useState<PdfArtifactUiStatus | "downloading" | "error">(status);
  const [pending, startTransition] = useTransition();

  const download = useCallback(async () => {
    setLocal("downloading");
    try {
      const res = await fetch(href, { headers: { accept: "application/pdf" } });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setLocal("READY");
    } catch {
      setLocal("error");
    }
  }, [href, filename]);

  const retry = useCallback(() => {
    if (!retryAction) return;
    setLocal("GENERATING");
    startTransition(async () => {
      try {
        await retryAction();
        setLocal("GENERATING");
      } catch {
        setLocal("FAILED");
      }
    });
  }, [retryAction]);

  const state = local;

  if (state === "downloading") {
    return (
      <button type="button" className={className} disabled aria-busy>
        <Loader2 aria-hidden="true" size={17} className="spin" /> Mengunduh…
      </button>
    );
  }

  if (state === "PENDING" || state === "GENERATING" || (state === "NONE" && !retryAction)) {
    return (
      <button type="button" className={className} disabled aria-busy title="PDF sedang dibuat dari snapshot terbitan">
        <Loader2 aria-hidden="true" size={17} className="spin" /> Menyiapkan PDF…
      </button>
    );
  }

  // Phase 8B-6 (live audit finding) — a plain download-fetch failure (e.g. a transient network
  // blip) used to collapse into the SAME terminal state as "no artifact exists": a disabled
  // button reading "PDF belum tersedia", even though the artifact is READY and only the fetch
  // failed. That was a false, permanent dead-end on the public page (no `retryAction` there) —
  // the one real recovery, reloading the page, was undiscoverable. A local fetch failure now
  // always gets its own retry, independent of whether the caller passed a `retryAction`.
  if (state === "error") {
    return (
      <button type="button" className={className} onClick={download}>
        <RotateCcw aria-hidden="true" size={17} /> Gagal mengunduh — coba lagi
      </button>
    );
  }

  if (state === "FAILED" || state === "NONE") {
    if (retryAction) {
      return (
        <button type="button" className={className} onClick={retry} disabled={pending} aria-busy={pending}>
          <RotateCcw aria-hidden="true" size={17} /> Buat ulang PDF
        </button>
      );
    }
    return (
      <button type="button" className={className} disabled title="PDF untuk versi ini belum tersedia">
        <FileDown aria-hidden="true" size={17} /> PDF belum tersedia
      </button>
    );
  }

  // READY
  return (
    <button type="button" className={className} onClick={download}>
      <FileDown aria-hidden="true" size={17} /> {label}
    </button>
  );
}
