"use client";

/**
 * Builder inspector — Grounded AI assistant surface (Phase 4, AC-P4-3/5/6/11).
 *
 * Nothing is written to a block until the developer clicks "Terima". "Tolak" discards the
 * proposal and records the decision. Apply routes through the SectionEditor's existing
 * single-flight autosave + history pipeline (no parallel persistence). The provider mode
 * badge is always visible; "Mock AI" is unmistakable.
 */

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, ScanText, Sparkles, X } from "lucide-react";
import type { AiBlockTarget, SectionEditorHandle } from "@/features/manuals/editor/section-editor";
import type { ClaimFinding, ProposalOutput, RevisionOperation, TargetField } from "@/lib/ai/types";
import { SAVE_STATE_LABEL, type SaveState } from "@/lib/domain/autosave";
import { requestAiRevision, resolveAiRevision, scanManualClaims, type AiRevisionResult } from "./actions";

type ProviderMode = "mock" | "configured" | "config-error";

const OP_LABEL: Record<RevisionOperation, string> = {
  improveText: "Perbaiki teks",
  simplifyText: "Sederhanakan",
  technicalRewrite: "Tulis ulang teknis",
  generateSteps: "Buat langkah",
  generateCaption: "Buat keterangan gambar",
};

/** Which operations make sense for the focused block. */
function operationsFor(target: AiBlockTarget | null): RevisionOperation[] {
  if (!target) return [];
  switch (target.blockType) {
    case "text":
      return ["improveText", "simplifyText", "technicalRewrite", "generateSteps"];
    case "callout":
    case "faq":
      return ["improveText", "simplifyText", "technicalRewrite"];
    case "steps":
      return ["generateSteps"];
    case "image":
      return ["generateCaption"];
    default:
      return [];
  }
}

/** The `target_field` an operation actually writes. */
function fieldForOperation(op: RevisionOperation, target: AiBlockTarget): TargetField {
  if (op === "generateSteps") return "steps";
  if (op === "generateCaption") return "caption";
  return target.targetField;
}

type PanelState =
  | { phase: "idle" }
  | { phase: "loading"; op: RevisionOperation }
  | {
      phase: "result";
      op: RevisionOperation;
      field: TargetField;
      blockKey: string;
      requestHash: string;
      data: AiRevisionResult;
    }
  | { phase: "applied"; op: RevisionOperation; changed: boolean }
  | { phase: "error"; message: string; op?: RevisionOperation };

export function AiPanel({
  providerMode,
  canEdit,
  manualId,
  sectionId,
  target,
  applyState,
  editorRef,
}: {
  providerMode: ProviderMode;
  canEdit: boolean;
  manualId: string;
  sectionId: string;
  target: AiBlockTarget | null;
  /** live autosave state of the block a proposal was applied to — the real Phase 3 result */
  applyState: SaveState | null;
  editorRef: React.RefObject<SectionEditorHandle | null>;
}) {
  const [state, setState] = useState<PanelState>({ phase: "idle" });
  const [scan, setScan] = useState<
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "done"; findings: ClaimFinding[] }
    | { phase: "error"; message: string }
  >({ phase: "idle" });

  const ops = useMemo(() => operationsFor(target), [target]);

  const run = useCallback(
    async (op: RevisionOperation) => {
      if (!target) return;
      const field = fieldForOperation(op, target);
      setState({ phase: "loading", op });
      const res = await requestAiRevision({
        manualId,
        sectionId,
        blockId: target.blockId,
        blockType: target.blockType,
        targetField: field,
        operation: op,
        selectedText: target.selectedText,
        locale: "id",
      });
      if (!res.ok) {
        setState({ phase: "error", message: res.message, op });
        return;
      }
      setState({
        phase: "result",
        op,
        field,
        blockKey: target.blockKey,
        requestHash: target.payloadHash,
        data: res.data,
      });
    },
    [manualId, sectionId, target],
  );

  const accept = useCallback(async () => {
    if (state.phase !== "result" || state.data.result.status !== "PROPOSAL") return;
    const currentHash = editorRef.current?.blockPayloadHash(state.blockKey) ?? null;
    if (currentHash !== state.requestHash) {
      setState({
        phase: "error",
        message: "Konten blok berubah setelah proposal dibuat. Buat ulang proposal terhadap konten terbaru.",
        op: state.op,
      });
      return;
    }
    const output: ProposalOutput = state.data.result.output;
    const applied = editorRef.current?.applyProposal(state.blockKey, state.field, output);
    if (!applied || !applied.ok) {
      setState({
        phase: "error",
        message: applied?.reason === "stale" ? "Target berubah — buat ulang." : "Proposal tidak dapat diterapkan ke blok ini.",
        op: state.op,
      });
      return;
    }
    if (state.data.revisionId) {
      await resolveAiRevision({ revisionId: state.data.revisionId, decision: "ACCEPTED", appliedAgainstHash: state.requestHash });
    }
    setState({ phase: "applied", op: state.op, changed: applied.changed });
  }, [state, editorRef]);

  const reject = useCallback(async () => {
    if (state.phase === "result" && state.data.revisionId) {
      await resolveAiRevision({ revisionId: state.data.revisionId, decision: "REJECTED" });
    }
    setState({ phase: "idle" });
  }, [state]);

  const runScan = useCallback(async () => {
    setScan({ phase: "loading" });
    const res = await scanManualClaims({ manualId });
    if (!res.ok) {
      setScan({ phase: "error", message: res.message });
      return;
    }
    setScan({ phase: "done", findings: res.data.findings });
  }, [manualId]);

  const badge =
    providerMode === "mock" ? (
      <span className="ai-badge ai-badge-mock" role="status">
        <Sparkles aria-hidden="true" size={13} /> Mock AI — mode pengembangan, hasil simulasi
      </span>
    ) : providerMode === "configured" ? (
      <span className="ai-badge ai-badge-live" role="status">
        <Sparkles aria-hidden="true" size={13} /> AI dikonfigurasi (server)
      </span>
    ) : (
      <span className="ai-badge ai-badge-error" role="alert">
        <AlertTriangle aria-hidden="true" size={13} /> Konfigurasi AI tidak lengkap (AI_PROVIDER / AI_API_KEY)
      </span>
    );

  if (!canEdit) {
    return (
      <section className="ai-panel" aria-label="Asisten AI">
        <h3>Asisten AI</h3>
        {badge}
        <p className="ai-readonly">Peran Anda tidak dapat menjalankan asisten AI.</p>
      </section>
    );
  }

  const disabledReason =
    providerMode === "config-error"
      ? "Perbaiki konfigurasi AI di server."
      : !target
        ? "Fokuskan kursor pada blok teks, callout, FAQ, langkah, atau gambar untuk memakai AI."
        : ops.length === 0
          ? "Blok ini tidak mendukung operasi AI."
          : null;

  return (
    <section className="ai-panel" aria-label="Asisten AI">
      <h3>Asisten AI</h3>
      {badge}

      {target && (
        <p className="ai-target">
          Sasaran: <strong>{blockLabel(target.blockType)}</strong>
          {target.selectedText ? "" : " (kosong)"}
        </p>
      )}
      {disabledReason && <p className="ai-hint">{disabledReason}</p>}

      {!disabledReason && (state.phase === "idle" || state.phase === "error" || state.phase === "applied") && (
        <div className="ai-op-buttons">
          {ops.map((op) => (
            <button
              key={op}
              type="button"
              className="secondary-button"
              onClick={() => run(op)}
              disabled={op !== "generateCaption" && !target?.selectedText}
              title={op !== "generateCaption" && !target?.selectedText ? "Blok masih kosong" : undefined}
            >
              {OP_LABEL[op]}
            </button>
          ))}
        </div>
      )}

      {state.phase === "loading" && (
        <p className="ai-loading" role="status" aria-live="polite">
          <Loader2 aria-hidden="true" size={14} className="spin" /> Menyusun {OP_LABEL[state.op]}…
        </p>
      )}

      {state.phase === "error" && (
        <div className="ai-error" role="alert">
          <AlertTriangle aria-hidden="true" size={14} />
          <p>{state.message}</p>
          {state.op && (
            <button type="button" className="secondary-button" onClick={() => run(state.op!)}>
              Coba lagi
            </button>
          )}
        </div>
      )}

      {state.phase === "applied" && !state.changed && (
        <p className="ai-applied ai-applied-saved" role="status">
          <Check aria-hidden="true" size={14} /> {OP_LABEL[state.op]}: teks sudah sesuai — tidak ada perubahan.
        </p>
      )}

      {state.phase === "applied" && state.changed && (
        <p
          className={`ai-applied ai-applied-${applyState ?? "saving"}`}
          role="status"
          aria-live="polite"
        >
          {applyState === "saving" || applyState === "dirty" || applyState === null ? (
            <Loader2 aria-hidden="true" size={14} className="spin" />
          ) : applyState === "error" || applyState === "conflict" ? (
            <AlertTriangle aria-hidden="true" size={14} />
          ) : (
            <Check aria-hidden="true" size={14} />
          )}{" "}
          Proposal {OP_LABEL[state.op]} diterapkan — {SAVE_STATE_LABEL[applyState ?? "saving"]}
          {applyState === "error" && " (coba simpan lagi dari blok)"}
          {applyState === "conflict" && " (selesaikan konflik di editor)"}
        </p>
      )}

      {state.phase === "result" && state.data.result.status === "ADDITIONAL_INFORMATION_REQUIRED" && (
        <div className="ai-air" role="status">
          <p className="ai-air-title">
            <AlertTriangle aria-hidden="true" size={14} /> Informasi tambahan diperlukan
          </p>
          <ul>
            {state.data.result.missingFacts.map((m, idx) => (
              <li key={idx}>
                <strong>{m.label}</strong>
                {m.hint && <span> — {m.hint}</span>}
                {m.surface && <em className="ai-air-surface"> ({m.surface})</em>}
              </li>
            ))}
          </ul>
          <button type="button" className="secondary-button" onClick={() => setState({ phase: "idle" })}>
            Tutup
          </button>
        </div>
      )}

      {state.phase === "result" && state.data.result.status === "PROPOSAL" && (
        <div className="ai-proposal">
          <div className="ai-diff">
            <div>
              <h4>SEBELUM</h4>
              <p className="ai-diff-text">{target?.selectedText || <em>(kosong)</em>}</p>
            </div>
            <div>
              <h4>SESUDAH</h4>
              {renderOutput(state.data.result.output)}
            </div>
          </div>

          <p className="ai-provenance">
            Penyedia: <strong>{state.data.provider.mode === "mock" ? "Mock AI" : state.data.provider.label || "AI"}</strong>
            {state.data.deduped && <span> · proposal identik yang sudah ada</span>}
          </p>

          {state.data.factsUsed.length > 0 && (
            <p className="ai-facts">
              Fakta yang dipakai:{" "}
              {state.data.factsUsed.map((f) => (
                <span key={f.id} className="ai-fact-chip" title={f.id}>
                  {f.label}
                </span>
              ))}
            </p>
          )}

          {state.data.grounding.ok ? (
            <p className="ai-grounding ai-grounding-ok">
              <Check aria-hidden="true" size={13} /> Grounding lolos — tidak ada fakta baru.
            </p>
          ) : (
            <div className="ai-grounding ai-grounding-fail" role="alert">
              <AlertTriangle aria-hidden="true" size={13} />
              <p>Proposal memperkenalkan data yang tidak didukung fakta. Tidak dapat diterima:</p>
              <ul>
                {state.data.grounding.violations.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="ai-proposal-actions">
            <button
              type="button"
              className="primary-button"
              onClick={accept}
              disabled={!state.data.grounding.ok}
              title={state.data.grounding.ok ? undefined : "Grounding gagal"}
            >
              <Check aria-hidden="true" size={14} /> Terima
            </button>
            <button type="button" className="secondary-button" onClick={reject}>
              <X aria-hidden="true" size={14} /> Tolak
            </button>
          </div>
        </div>
      )}

      <div className="ai-scan">
        <button type="button" className="secondary-button" onClick={runScan} disabled={scan.phase === "loading"}>
          <ScanText aria-hidden="true" size={14} /> Pindai klaim manual
        </button>
        {scan.phase === "loading" && (
          <p className="ai-loading" role="status" aria-live="polite">
            <Loader2 aria-hidden="true" size={14} className="spin" /> Memindai…
          </p>
        )}
        {scan.phase === "error" && (
          <p className="ai-error" role="alert">
            <AlertTriangle aria-hidden="true" size={14} /> {scan.message}
          </p>
        )}
        {scan.phase === "done" && (
          <div className="ai-findings" role="status">
            {scan.findings.length === 0 ? (
              <p className="ai-findings-clean">
                <Check aria-hidden="true" size={14} /> Tidak ada frasa klaim berisiko yang terdeteksi (pemindaian awal — bukan persetujuan).
              </p>
            ) : (
              <>
                <p className="ai-findings-count">
                  {scan.findings.length} temuan advisori. Tinjau bersama manusia — tidak ada perubahan otomatis.
                </p>
                <ul>
                  {scan.findings.map((f, i) => (
                    <li key={i} className="ai-finding-card">
                      <p className="ai-finding-head">
                        <AlertTriangle aria-hidden="true" size={13} /> {f.categoryLabel}{" "}
                        <span className="ai-finding-cat">{f.category}</span>
                      </p>
                      <p className="ai-finding-excerpt">“{f.excerpt}”</p>
                      <p className="ai-finding-loc">{f.location}</p>
                      <p className="ai-finding-expl">{f.explanation}</p>
                      <p className="ai-finding-action">Tindakan: {f.recommendedAction}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function blockLabel(t: AiBlockTarget["blockType"]): string {
  return { text: "Blok teks", callout: "Callout", faq: "FAQ (jawaban)", steps: "Langkah instalasi", image: "Keterangan gambar" }[t];
}

function renderOutput(output: ProposalOutput) {
  if (output.kind === "text") return <p className="ai-diff-text">{output.text}</p>;
  if (output.kind === "caption") return <p className="ai-diff-text">{output.caption}</p>;
  return (
    <ol className="ai-diff-steps">
      {output.steps.map((s, i) => (
        <li key={i}>
          <strong>{s.title}</strong>
          <span>{s.instruction}</span>
          {s.menuPath && <em>{s.menuPath}</em>}
        </li>
      ))}
    </ol>
  );
}
