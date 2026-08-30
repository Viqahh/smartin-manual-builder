"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, RotateCcw, Send } from "lucide-react";
import {
  submitForTechnicalReview,
  technicalDecision,
  complianceDecision,
  beginRevision,
} from "./actions";

export type ReviewControlsProps = {
  manualId: string;
  status: string;
  reviewRound: number;
  isAssignedTechnical: boolean;
  isAssignedCompliance: boolean;
  canSubmit: boolean; // author (DEVELOPER/ADMIN)
  canBeginRevision: boolean; // author
  technicalReviewerSet: boolean;
  complianceReviewerSet: boolean;
  /** Phase 5: required in-scope items still MISSING (blocks submit). */
  blockingReasons: string[];
  /** latest request-changes summary for the current situation, if any */
  lastRequestChangesSummary: string | null;
};

const REGULATORY_NOTE =
  "Keputusan internal Smartin atas dokumentasi, bukan persetujuan regulator.";

export function ReviewControls(props: ReviewControlsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "tech-changes" | "comp-changes">("idle");
  const [summary, setSummary] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; message?: string; issues?: { message: string }[] }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setMode("idle");
        setSummary("");
        router.refresh();
      } else {
        const detail = res.issues?.map((i) => i.message).join(" · ");
        setError(detail ? `${res.message} ${detail}` : res.message ?? "Gagal.");
      }
    });
  };

  // --- DRAFT: submit for technical review ---
  if (props.status === "DRAFT") {
    if (!props.canSubmit) return null;
    const reason =
      props.blockingReasons.length > 0
        ? "Lengkapi item wajib terlebih dahulu."
        : !props.technicalReviewerSet
          ? "Reviewer teknis belum ditetapkan."
          : !props.complianceReviewerSet
            ? "Reviewer kepatuhan belum ditetapkan."
            : null;
    return (
      <div className="review-controls">
        <button
          className="primary-button"
          disabled={pending || reason !== null}
          title={reason ?? "Kirim manual untuk review teknis"}
          onClick={() => run(() => submitForTechnicalReview({ manualId: props.manualId }))}
        >
          <Send aria-hidden="true" size={15} /> Kirim review
        </button>
        {reason && <p className="review-controls-reason">{reason}</p>}
        {error && (
          <p className="review-controls-error" role="alert">
            <AlertTriangle aria-hidden="true" size={13} /> {error}
          </p>
        )}
      </div>
    );
  }

  // --- CHANGES_REQUESTED: author begins revision ---
  if (props.status === "CHANGES_REQUESTED") {
    return (
      <div className="review-controls">
        {props.lastRequestChangesSummary && (
          <p className="review-controls-summary">
            <strong>Permintaan perubahan:</strong> {props.lastRequestChangesSummary}
          </p>
        )}
        {props.canBeginRevision ? (
          <button
            className="primary-button"
            disabled={pending}
            onClick={() => run(() => beginRevision({ manualId: props.manualId }))}
          >
            <RotateCcw aria-hidden="true" size={15} /> Mulai revisi
          </button>
        ) : (
          <span className="review-controls-pill">Menunggu revisi oleh pembuat</span>
        )}
        {error && (
          <p className="review-controls-error" role="alert">
            <AlertTriangle aria-hidden="true" size={13} /> {error}
          </p>
        )}
      </div>
    );
  }

  // --- TECHNICAL_REVIEW: assigned technical reviewer decides ---
  if (props.status === "TECHNICAL_REVIEW") {
    if (!props.isAssignedTechnical) return <span className="review-controls-pill">Dalam review teknis</span>;
    return (
      <DecisionControls
        kind="technical"
        pending={pending}
        error={error}
        summary={summary}
        setSummary={setSummary}
        onApprove={() => run(() => technicalDecision({ manualId: props.manualId, decision: "APPROVE", summary: "" }))}
        onOpenChanges={() => setMode("tech-changes")}
        onSubmitChanges={() =>
          run(() => technicalDecision({ manualId: props.manualId, decision: "REQUEST_CHANGES", summary }))
        }
        onCancel={() => {
          setMode("idle");
          setSummary("");
        }}
        active={mode === "tech-changes"}
      />
    );
  }

  // --- COMPLIANCE_REVIEW: assigned compliance reviewer decides ---
  if (props.status === "COMPLIANCE_REVIEW") {
    if (!props.isAssignedCompliance) return <span className="review-controls-pill">Dalam review kepatuhan</span>;
    return (
      <DecisionControls
        kind="compliance"
        pending={pending}
        error={error}
        summary={summary}
        setSummary={setSummary}
        onApprove={() => run(() => complianceDecision({ manualId: props.manualId, decision: "APPROVE", summary: "" }))}
        onOpenChanges={() => setMode("comp-changes")}
        onSubmitChanges={() =>
          run(() => complianceDecision({ manualId: props.manualId, decision: "REQUEST_CHANGES", summary }))
        }
        onCancel={() => {
          setMode("idle");
          setSummary("");
        }}
        active={mode === "comp-changes"}
      />
    );
  }

  // APPROVED / PUBLISHED / ARCHIVED — handled by <PublishControls> (slice 6). Nothing here.
  return null;
}

function DecisionControls({
  kind,
  pending,
  error,
  active,
  summary,
  setSummary,
  onApprove,
  onOpenChanges,
  onSubmitChanges,
  onCancel,
}: {
  kind: "technical" | "compliance";
  pending: boolean;
  error: string | null;
  active: boolean;
  summary: string;
  setSummary: (v: string) => void;
  onApprove: () => void;
  onOpenChanges: () => void;
  onSubmitChanges: () => void;
  onCancel: () => void;
}) {
  const approveLabel = kind === "technical" ? "Setujui (reviewer teknis)" : "Setujui (reviewer kepatuhan)";
  return (
    <div className="review-controls">
      {!active ? (
        <div className="review-controls-actions">
          <button className="primary-button" disabled={pending} onClick={onApprove}>
            <Check aria-hidden="true" size={15} /> {approveLabel}
          </button>
          <button className="secondary-button" disabled={pending} onClick={onOpenChanges}>
            Minta perubahan
          </button>
        </div>
      ) : (
        <div className="review-controls-changes">
          <label>
            Ringkasan perubahan (wajib)
            <textarea
              rows={3}
              maxLength={4000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Jelaskan perubahan yang harus dilakukan pembuat manual."
            />
          </label>
          <div className="review-controls-actions">
            <button
              className="primary-button"
              disabled={pending || summary.trim().length === 0}
              onClick={onSubmitChanges}
            >
              Kirim permintaan perubahan
            </button>
            <button className="secondary-button" disabled={pending} onClick={onCancel}>
              Batal
            </button>
          </div>
        </div>
      )}
      {kind === "compliance" && <p className="review-controls-note">{REGULATORY_NOTE}</p>}
      {error && (
        <p className="review-controls-error" role="alert">
          <AlertTriangle aria-hidden="true" size={13} /> {error}
        </p>
      )}
    </div>
  );
}
