"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, CheckCircle2, ShieldCheck } from "lucide-react";
import { publishManualVersion, archiveManualVersion } from "./publication-actions";

export type PublishControlsProps = {
  manualId: string;
  status: string;
  isAdmin: boolean;
  eaName: string;
  eaVersion: string;
  manualVersion: string;
  publicSlug: string;
  reviewRound: number;
  technicalDecision: { reviewerName: string | null; decidedAt: string } | null;
  complianceDecision: { reviewerName: string | null; decidedAt: string } | null;
  readinessPercent: number | null;
  publishBlockers: { checkKey: string; label: string; state: string }[];
};

const INTERNAL_NOTE = "Keputusan internal Smartin atas dokumentasi, bukan persetujuan regulator.";
const IMMUTABLE_NOTE =
  "Publikasi membuat snapshot dokumentasi yang tidak dapat diedit. Perubahan berikutnya memerlukan Manual Version baru.";

export function PublishControls(props: PublishControlsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"idle" | "confirm-publish" | "confirm-archive">("idle");
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  if (!props.isAdmin) {
    // A non-admin never sees an actionable control (server rejects a forged call anyway).
    if (props.status === "APPROVED") return <span className="review-controls-pill">Disetujui — menunggu penerbitan oleh ADMIN</span>;
    if (props.status === "PUBLISHED") return <span className="review-controls-pill">Telah diterbitkan</span>;
    if (props.status === "ARCHIVED") return <span className="review-controls-pill">Diarsipkan</span>;
    return null;
  }

  const run = (fn: () => Promise<{ ok: boolean; message?: string; issues?: { message: string }[] }>) => {
    setError(null);
    setIssues([]);
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setMode("idle");
        router.refresh();
      } else {
        setError(res.message ?? "Gagal.");
        setIssues((res.issues ?? []).map((i) => i.message));
      }
    });
  };

  // ---- APPROVED: publish ----
  if (props.status === "APPROVED") {
    const blocked = props.publishBlockers.length > 0;
    return (
      <div className="publish-controls">
        {mode !== "confirm-publish" ? (
          <button
            className="primary-button"
            disabled={pending}
            onClick={() => setMode("confirm-publish")}
          >
            <ShieldCheck aria-hidden="true" size={15} /> Terbitkan snapshot
          </button>
        ) : (
          <div className="publish-confirm" role="group" aria-label="Konfirmasi penerbitan">
            <dl className="publish-summary">
              <div><dt>EA</dt><dd>{props.eaName} · {props.eaVersion}</dd></div>
              <div><dt>Versi manual</dt><dd className="mono">{props.manualVersion}</dd></div>
              <div><dt>Slug publik</dt><dd className="mono">{props.publicSlug || "—"}/{props.manualVersion}</dd></div>
              <div>
                <dt>Review teknis</dt>
                <dd>{props.technicalDecision ? `Disetujui — ${props.technicalDecision.reviewerName ?? "reviewer teknis"}` : "belum ada"}</dd>
              </div>
              <div>
                <dt>Review kepatuhan</dt>
                <dd>{props.complianceDecision ? `Disetujui — ${props.complianceDecision.reviewerName ?? "reviewer kepatuhan"}` : "belum ada"}</dd>
              </div>
              <div>
                <dt>Kesiapan dokumentasi</dt>
                <dd className="mono">{props.readinessPercent == null ? "—" : `${props.readinessPercent}%`}</dd>
              </div>
            </dl>

            {blocked ? (
              <div className="publish-blockers" role="alert">
                <p><strong>Publikasi belum dapat dilakukan:</strong></p>
                <ul>
                  {props.publishBlockers.map((b) => (
                    <li key={b.checkKey}>
                      <span className="mono">{b.checkKey}</span> — {b.label} ({b.state === "MISSING" ? "Perlu dilengkapi" : "Perlu ditinjau"})
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="publish-immutable-note">{IMMUTABLE_NOTE}</p>
            )}
            <p className="review-controls-note">{INTERNAL_NOTE}</p>

            <div className="review-controls-actions">
              <button
                className="primary-button"
                disabled={pending || blocked}
                onClick={() => run(() => publishManualVersion({ manualId: props.manualId }))}
              >
                <ShieldCheck aria-hidden="true" size={15} /> Ya, terbitkan
              </button>
              <button className="secondary-button" disabled={pending} onClick={() => setMode("idle")}>
                Batal
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="review-controls-error" role="alert">
            <AlertTriangle aria-hidden="true" size={13} /> {error}
            {issues.length > 0 && (
              <ul>{issues.map((i) => <li key={i} className="mono">{i}</li>)}</ul>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---- PUBLISHED: archive ----
  if (props.status === "PUBLISHED") {
    return (
      <div className="publish-controls">
        {mode !== "confirm-archive" ? (
          <button className="secondary-button" disabled={pending} onClick={() => setMode("confirm-archive")}>
            <Archive aria-hidden="true" size={15} /> Arsipkan versi
          </button>
        ) : (
          <div className="publish-confirm" role="group" aria-label="Konfirmasi pengarsipan">
            <p>Versi yang diarsipkan tetap menyimpan snapshot dan riwayat review, tetapi tidak lagi menjadi versi aktif.</p>
            <div className="review-controls-actions">
              <button
                className="primary-button"
                disabled={pending}
                onClick={() => run(() => archiveManualVersion({ manualId: props.manualId }))}
              >
                <Archive aria-hidden="true" size={15} /> Ya, arsipkan
              </button>
              <button className="secondary-button" disabled={pending} onClick={() => setMode("idle")}>
                Batal
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="review-controls-error" role="alert">
            <AlertTriangle aria-hidden="true" size={13} /> {error}
          </p>
        )}
      </div>
    );
  }

  if (props.status === "ARCHIVED") {
    return (
      <span className="review-controls-pill">
        <CheckCircle2 aria-hidden="true" size={13} /> Diarsipkan
      </span>
    );
  }

  return null;
}
