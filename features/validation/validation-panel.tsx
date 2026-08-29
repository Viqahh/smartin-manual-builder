"use client";

/**
 * Phase 5 — documentation-readiness panel in the builder inspector (PRD-VAL-001, AC-P5-9/10).
 *
 * This renders a computed *documentation-readiness* signal. It NEVER says "Approved" /
 * "Compliant" / "Bappebti" (AC-P5-9). Human review decisions are a separate Phase 6 concern —
 * this panel carries no decision control. It only reads `checklist_results`; all state is
 * computed server-side.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Loader2,
  MinusCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type ChecklistState,
  type ItemResult,
  type ValidationView,
} from "@/lib/validation/types";
import { getValidation, refreshValidation, overrideChecklistItem } from "./actions";

const STATE_META: Record<ChecklistState, { label: string; cls: string; Icon: typeof Check }> = {
  PASS: { label: "Lolos", cls: "v-pass", Icon: Check },
  WARNING: { label: "Perlu ditinjau", cls: "v-warning", Icon: AlertTriangle },
  MISSING: { label: "Perlu dilengkapi", cls: "v-missing", Icon: XCircle },
  NOT_APPLICABLE: { label: "Tidak berlaku", cls: "v-na", Icon: MinusCircle },
};

const SECTION_TITLE: Record<string, string> = {
  installation: "Instalasi",
  "how-it-works": "Cara Kerja EA",
  parameters: "Referensi Input / Parameter",
  risk: "Risiko & Manajemen Dana",
  performance: "Informasi Backtest",
  changelog: "Catatan Perubahan",
  support: "Dukungan",
  disclaimer: "Pernyataan Risiko",
  cover: "Sampul & Identitas Produk",
};

export function ValidationPanel({
  manualId,
  canReview,
  initial,
  refreshNonce,
  onNavigateSection,
}: {
  manualId: string;
  canReview: boolean;
  initial: ValidationView | null;
  /** bumps after a successful builder mutation — triggers a server re-evaluation */
  refreshNonce: number;
  onNavigateSection: (sectionKey: string) => void;
}) {
  const [view, setView] = useState<ValidationView | null>(initial);
  const [busy, setBusy] = useState<"idle" | "loading" | "refreshing">("idle");
  const [err, setErr] = useState<string | null>(initial ? null : "Kesiapan dokumentasi belum dimuat.");
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const lastNonce = useRef(refreshNonce);

  const load = useCallback(async () => {
    setBusy("loading");
    const res = await getValidation({ manualId });
    if (res.ok) {
      setView(res.data);
      setErr(null);
    } else {
      setErr(res.message);
    }
    setBusy("idle");
  }, [manualId]);

  const doRefresh = useCallback(async () => {
    setBusy("refreshing");
    const res = await refreshValidation({ manualId });
    if (res.ok) {
      setView(res.data);
      setErr(null);
    } else {
      setErr(res.message);
    }
    setBusy("idle");
  }, [manualId]);

  // re-evaluate after a builder change settled (parent bumps refreshNonce)
  useEffect(() => {
    if (refreshNonce !== lastNonce.current) {
      lastNonce.current = refreshNonce;
      void doRefresh();
    }
  }, [refreshNonce, doRefresh]);

  const submitOverride = useCallback(
    async (checkKey: string) => {
      const res = await overrideChecklistItem({ manualId, checkKey, reason });
      if (res.ok) {
        setView(res.data);
        setOverrideFor(null);
        setReason("");
        setErr(null);
      } else {
        setErr(res.message);
      }
    },
    [manualId, reason],
  );

  if (busy === "loading" && !view) {
    return (
      <section className="validation-panel" aria-label="Kesiapan dokumentasi">
        <h3>Kesiapan dokumentasi</h3>
        <p className="v-loading" role="status">
          <Loader2 aria-hidden="true" size={14} className="spin" /> Mengevaluasi…
        </p>
      </section>
    );
  }

  if (!view) {
    return (
      <section className="validation-panel" aria-label="Kesiapan dokumentasi">
        <h3>Kesiapan dokumentasi</h3>
        <p className="v-error" role="alert">
          <AlertTriangle aria-hidden="true" size={14} /> {err ?? "Gagal memuat."}
          <button type="button" className="secondary-button" onClick={() => void load()}>
            Coba lagi
          </button>
        </p>
      </section>
    );
  }

  const { score, eligibility, counts, items } = view;
  const scoreText = score.percent === null ? null : `${score.percent}`;

  // group by category in the canonical order; unknown categories fall to the end
  const groupedItems: [string, ItemResult[]][] = (() => {
    const buckets = new Map<string, ItemResult[]>();
    for (const it of items) {
      const arr = buckets.get(it.category) ?? [];
      arr.push(it);
      buckets.set(it.category, arr);
    }
    const ordered: [string, ItemResult[]][] = [];
    for (const cat of CATEGORY_ORDER) {
      const arr = buckets.get(cat);
      if (arr) {
        ordered.push([cat, arr]);
        buckets.delete(cat);
      }
    }
    for (const [cat, arr] of buckets) ordered.push([cat, arr]);
    return ordered;
  })();

  return (
    <section className="validation-panel" aria-label="Kesiapan dokumentasi">
      <h3>Kesiapan dokumentasi</h3>

      <div className="v-score" data-empty={score.percent === null}>
        <span className="v-score-num">
          {scoreText ?? "—"}
          {scoreText !== null && <small>%</small>}
        </span>
        <div>
          <strong>{scoreText === null ? "Tidak ada item wajib yang berlaku" : "Kesiapan dokumentasi"}</strong>
          <p>
            {score.numerator}/{score.denominator} item wajib berstatus Lolos · templat v{view.templateVersion}
            {view.pbkScope === "OUT_OF_SCOPE" && " · di luar lingkup PBK"}
          </p>
        </div>
      </div>
      <p className="v-disclaimer">
        Skor ini mengukur kelengkapan dokumentasi dan bukan persetujuan regulator. Keputusan
        review kepatuhan adalah tindakan manusia yang terpisah (Phase 6).
      </p>

      <ul className="v-counts">
        {(["PASS", "WARNING", "MISSING", "NOT_APPLICABLE"] as ChecklistState[]).map((s) => {
          const m = STATE_META[s];
          return (
            <li key={s} className={m.cls}>
              <m.Icon aria-hidden="true" size={13} /> {m.label} <b>{counts[s]}</b>
            </li>
          );
        })}
      </ul>

      <p className={`v-eligibility ${eligibility.ready ? "v-ready" : "v-notready"}`} role="status">
        {eligibility.ready ? (
          <>
            <Check aria-hidden="true" size={14} /> Siap dikirim untuk review
          </>
        ) : (
          <>
            <XCircle aria-hidden="true" size={14} /> Belum siap dikirim untuk review
          </>
        )}
      </p>
      {!eligibility.ready && (
        <ul className="v-blocking">
          {eligibility.blockingReasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      {groupedItems.map(([category, groupItems]) => (
        <section key={category} className="v-group" aria-label={CATEGORY_LABELS[category] ?? category}>
          <h4 className="v-group-head">
            {CATEGORY_LABELS[category] ?? category}
            <span className="v-group-tally">
              {groupItems.filter((i) => i.state === "PASS").length}/{groupItems.length}
            </span>
          </h4>
          <ul className="v-items">
            {groupItems.map((it) => {
              const m = STATE_META[it.state];
              const sectionKey = it.navigateSectionKey;
              return (
                <li key={it.checkKey} className={`v-item ${m.cls}`}>
                  <p className="v-item-head">
                    <m.Icon aria-hidden="true" size={14} />
                    <span className="v-item-state">{m.label}</span>
                    <span className="v-item-label">{it.label}</span>
                  </p>
                  <p className="v-item-reason">{it.reason}</p>
                  {it.override && (
                    <p className="v-item-override">
                      Ditandai tidak berlaku oleh {it.override.actorName ?? "reviewer"}
                      {it.systemState !== "NOT_APPLICABLE" && ` (evaluasi otomatis: ${STATE_META[it.systemState].label})`}
                    </p>
                  )}
                  <div className="v-item-actions">
                    {sectionKey && (
                      <button type="button" className="v-link" onClick={() => onNavigateSection(sectionKey)}>
                        Buka bab {SECTION_TITLE[sectionKey] ?? sectionKey} <ChevronRight aria-hidden="true" size={12} />
                      </button>
                    )}
                    {canReview && it.state !== "NOT_APPLICABLE" && overrideFor !== it.checkKey && (
                      <button type="button" className="v-na-btn" onClick={() => setOverrideFor(it.checkKey)}>
                        Tandai tidak berlaku
                      </button>
                    )}
                  </div>
                  {canReview && overrideFor === it.checkKey && (
                    <div className="v-na-form">
                      <label>
                        Alasan (wajib)
                        <textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          rows={2}
                          maxLength={500}
                          placeholder="Mis. EA ini tidak menampilkan angka kinerja apa pun."
                        />
                      </label>
                      <div className="v-na-form-actions">
                        <button
                          type="button"
                          className="primary-button"
                          disabled={reason.trim().length < 5}
                          onClick={() => void submitOverride(it.checkKey)}
                        >
                          Simpan
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            setOverrideFor(null);
                            setReason("");
                          }}
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <div className="v-foot">
        <button type="button" className="secondary-button" onClick={() => void doRefresh()} disabled={busy === "refreshing"}>
          {busy === "refreshing" ? (
            <>
              <Loader2 aria-hidden="true" size={13} className="spin" /> Mengevaluasi…
            </>
          ) : (
            <>
              <RefreshCw aria-hidden="true" size={13} /> Perbarui
            </>
          )}
        </button>
        {view.evaluatedAt && (
          <span className="v-evaluated">
            Terakhir dievaluasi {new Date(view.evaluatedAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
          </span>
        )}
      </div>
      {err && (
        <p className="v-error" role="alert">
          <AlertTriangle aria-hidden="true" size={13} /> {err}
        </p>
      )}
    </section>
  );
}
