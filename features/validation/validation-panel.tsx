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
  CHECKLIST_OWNER_LABEL,
  CHECKLIST_OWNER_ORDER,
  checklistOwner,
  type ChecklistOwner,
  type ChecklistState,
  type ItemResult,
  type ValidationView,
} from "@/lib/validation/types";
import {
  getValidation,
  refreshValidation,
  overrideChecklistItem,
  submitChecklistEvidence,
  decideChecklistEvidence,
} from "./actions";

type EvidenceSection = { id: string; key: string; title: string; blocks: { id: string; label: string }[] };

const STATE_META: Record<ChecklistState, { label: string; cls: string; Icon: typeof Check }> = {
  PASS: { label: "Lolos", cls: "v-pass", Icon: Check },
  WARNING: { label: "Perlu ditinjau", cls: "v-warning", Icon: AlertTriangle },
  MISSING: { label: "Perlu dilengkapi", cls: "v-missing", Icon: XCircle },
  NOT_APPLICABLE: { label: "Tidak berlaku", cls: "v-na", Icon: MinusCircle },
};

/**
 * §4 — CTA phrasing by resolution owner. The author is never told to invent a fact they cannot
 * supply; source-of-truth / organisation / compliance findings say who actually owns the data.
 */
const OWNER_CTA: Record<ChecklistOwner, string> = {
  author: "Bisa kamu perbaiki langsung di bab terkait.",
  "source-of-truth": "Perlu data teknis EA yang dikonfirmasi developer / source-of-truth.",
  organisation: "Data organisasi belum tersedia / perlu dikonfirmasi Admin.",
  compliance: "Perlu verifikasi / data kepatuhan oleh tim Compliance.",
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
  manualVersionId,
  canReview,
  initial,
  refreshNonce,
  evidenceSections = [],
  onNavigateSection,
}: {
  manualId: string;
  /** the manual_version the `initial` payload belongs to — identity guard against stale reuse */
  manualVersionId: string;
  canReview: boolean;
  initial: ValidationView | null;
  /** bumps after a successful builder mutation — triggers a server re-evaluation */
  refreshNonce: number;
  /** UAT-35 — chapters + blocks for the "Sudah ada di manual" evidence picker */
  evidenceSections?: EvidenceSection[];
  onNavigateSection: (sectionKey: string) => void;
}) {
  const [view, setView] = useState<ValidationView | null>(initial);
  const [busy, setBusy] = useState<"idle" | "loading" | "refreshing">("idle");
  const [err, setErr] = useState<string | null>(initial ? null : "Kesiapan dokumentasi belum dimuat.");
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // UAT-35 — "Sudah ada di manual" author-submission form + reviewer decision
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  const [evSectionKey, setEvSectionKey] = useState("");
  const [evBlockId, setEvBlockId] = useState("");
  const [evNote, setEvNote] = useState("");
  const [evBusy, setEvBusy] = useState(false);
  const [returnFor, setReturnFor] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [tab, setTab] = useState<"todo" | "all">("todo");
  const [showPassing, setShowPassing] = useState(false);
  const [showNa, setShowNa] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  // UAT: compact-by-default inspector. Owner groups collapse; only the highest-priority group is
  // open until the user touches the disclosure. Findings are one line until expanded.
  const [ownersTouched, setOwnersTouched] = useState(false);
  const [openOwners, setOpenOwners] = useState<Set<ChecklistOwner>>(() => new Set());
  const [openFindings, setOpenFindings] = useState<Set<string>>(() => new Set());
  // set by the PAYLOAD GUARD to the identity whose `view` was wrong-version and needs a re-fetch
  const [healFor, setHealFor] = useState<string | null>(null);
  const lastNonce = useRef(refreshNonce);

  // IDENTITY GUARD — the panel must never show another manual/version's data. When the route
  // switches to a different manual (or its current version changes) every piece of local state
  // is dropped and reseeded from THIS manual's `initial`. This runs during render (the
  // "adjust state on prop change" pattern from react.dev), so no stale frame is ever painted,
  // and it does NOT depend on the parent remounting.
  const identity = `${manualId}::${manualVersionId}`;
  const [boundIdentity, setBoundIdentity] = useState(identity);
  if (identity !== boundIdentity) {
    setBoundIdentity(identity);
    setView(initial);
    setBusy("idle");
    setErr(initial ? null : "Kesiapan dokumentasi belum dimuat.");
    setOverrideFor(null);
    setReason("");
    setEvidenceFor(null);
    setEvSectionKey("");
    setEvBlockId("");
    setEvNote("");
    setEvBusy(false);
    setReturnFor(null);
    setReturnReason("");
    setTab("todo");
    setShowPassing(false);
    setShowNa(false);
    setShowResolved(false);
    setOwnersTouched(false);
    setOpenOwners(new Set());
    setOpenFindings(new Set());
    setHealFor(null);
  }

  // PAYLOAD GUARD — the ultimate belt, evaluated only once the identity guard above has settled
  // (`identity === boundIdentity`). If the `view` we are about to render was computed for a
  // DIFFERENT manual_version than this panel is bound to (a stale client render, a stale server
  // payload from a cache, a reused React instance — any cause), it is dropped here and the effect
  // below re-fetches it from the server for the correct version. `healFor` is state (not a bare
  // ref) so it survives the render-phase churn and the heal effect reliably sees it.
  const wrongPayload =
    identity === boundIdentity && !!view?.manualVersionId && view.manualVersionId !== manualVersionId;
  if (wrongPayload) {
    setView(null);
    setBusy("loading");
    setErr(null);
    if (healFor !== identity) setHealFor(identity);
  }

  // latest committed identity — an in-flight load/refresh started before a manual switch is
  // discarded so it can never write another manual's result into `view`.
  const identityRef = useRef(identity);
  const healedRef = useRef<string | null>(null);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  const load = useCallback(async () => {
    const at = identityRef.current;
    setBusy("loading");
    const res = await getValidation({ manualId });
    if (identityRef.current !== at) return; // manual switched while loading — drop this result
    if (res.ok) {
      setView(res.data);
      setErr(null);
    } else {
      setErr(res.message);
    }
    setBusy("idle");
  }, [manualId]);

  const doRefresh = useCallback(async () => {
    const at = identityRef.current;
    setBusy("refreshing");
    const res = await refreshValidation({ manualId });
    if (identityRef.current !== at) return; // manual switched while refreshing — drop this result
    if (res.ok) {
      setView(res.data);
      setErr(null);
    } else {
      setErr(res.message);
    }
    setBusy("idle");
  }, [manualId]);

  // self-heal a wrong-version payload (see PAYLOAD GUARD above) — one fetch per identity
  useEffect(() => {
    if (healFor && healedRef.current !== healFor) {
      healedRef.current = healFor;
      void load();
    }
  }, [healFor, load]);

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

  const openEvidenceForm = useCallback((it: ItemResult) => {
    setEvidenceFor(it.checkKey);
    setEvSectionKey(it.navigateSectionKey ?? "");
    setEvBlockId("");
    setEvNote("");
    setErr(null);
  }, []);

  const submitEvidence = useCallback(
    async (checkKey: string) => {
      if (!evSectionKey) return;
      setEvBusy(true);
      const res = await submitChecklistEvidence({
        manualId,
        checkKey,
        sectionKey: evSectionKey,
        blockId: evBlockId || null,
        note: evNote.trim() || undefined,
      });
      setEvBusy(false);
      if (res.ok) {
        setView(res.data);
        setEvidenceFor(null);
        setErr(null);
      } else {
        setErr(res.message);
      }
    },
    [manualId, evSectionKey, evBlockId, evNote],
  );

  const decide = useCallback(
    async (submissionId: string, decision: "ACCEPT" | "RETURN") => {
      setEvBusy(true);
      const res = await decideChecklistEvidence({
        manualId,
        submissionId,
        decision,
        returnReason: decision === "RETURN" ? returnReason.trim() : undefined,
      });
      setEvBusy(false);
      if (res.ok) {
        setView(res.data);
        setReturnFor(null);
        setReturnReason("");
        setErr(null);
      } else {
        setErr(res.message);
      }
    },
    [manualId, returnReason],
  );

  if (busy === "loading" && !view) {
    return (
      <section className="validation-panel" aria-label="Kesiapan dokumentasi" data-panel-manual-id={manualId} data-panel-version-id={manualVersionId} data-view-version-id="none">
        <h3>Kesiapan dokumentasi</h3>
        <p className="v-loading" role="status">
          <Loader2 aria-hidden="true" size={14} className="spin" /> Mengevaluasi…
        </p>
      </section>
    );
  }

  if (!view) {
    return (
      <section className="validation-panel" aria-label="Kesiapan dokumentasi" data-panel-manual-id={manualId} data-panel-version-id={manualVersionId} data-view-version-id="none">
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

  const humanResolved = (it: ItemResult) =>
    it.humanEvidence?.effectiveResolution === "RESOLVED_BY_HUMAN_REVIEW";
  const actionable = items.filter(
    (it) => (it.state === "WARNING" || it.state === "MISSING") && !humanResolved(it),
  );
  const passing = items.filter((it) => it.state === "PASS");
  const notApplicable = items.filter((it) => it.state === "NOT_APPLICABLE");
  const resolvedByHuman = items.filter(humanResolved);

  const ownerGroups = CHECKLIST_OWNER_ORDER.map(
    (o) => [o, actionable.filter((it) => checklistOwner(it.checkKey) === o)] as const,
  ).filter(([, g]) => g.length > 0);
  const firstOwner = ownerGroups[0]?.[0];
  const isOwnerOpen = (o: ChecklistOwner) => (ownersTouched ? openOwners.has(o) : o === firstOwner);
  const toggleOwner = (o: ChecklistOwner) => {
    setOpenOwners((prev) => {
      const base = ownersTouched ? prev : firstOwner ? new Set<ChecklistOwner>([firstOwner]) : new Set<ChecklistOwner>();
      const next = new Set(base);
      if (next.has(o)) next.delete(o);
      else next.add(o);
      return next;
    });
    setOwnersTouched(true);
  };
  const toggleFinding = (k: string) =>
    setOpenFindings((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const expandAll = () => {
    setOwnersTouched(true);
    setOpenOwners(new Set(ownerGroups.map(([o]) => o)));
    setOpenFindings(new Set(actionable.map((it) => it.checkKey)));
  };
  const collapseAll = () => {
    setOwnersTouched(true);
    setOpenOwners(new Set());
    setOpenFindings(new Set());
  };

  // full-list view: group by category in the canonical order
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

  const EV_STATUS_LABEL: Record<string, string> = {
    PENDING: "Menunggu verifikasi reviewer",
    ACCEPTED: "Diterima reviewer",
    RETURNED: "Dikembalikan reviewer",
    SUPERSEDED: "Digantikan pengajuan baru",
    STALE: "Konten berubah — perlu ditinjau ulang",
  };

  // UAT-35 — the "Sudah ada di manual" zone for ONE finding. Never rewrites the automated state:
  // it shows the two facts (automated vs human) on separate lines.
  const renderHumanEvidence = (it: ItemResult) => {
    const he = it.humanEvidence;

    // existing submission → status panel (visible to everyone)
    if (he) {
      const stale = he.isStale || he.status === "STALE";
      const jump = () => {
        if (he.sectionKey) onNavigateSection(he.sectionKey);
      };
      return (
        <div className="v-evidence" data-status={stale ? "STALE" : he.status}>
          <p className="v-evidence-line">
            <b>Hasil otomatis:</b> {STATE_META[it.systemState].label}
          </p>
          <p className="v-evidence-line">
            <b>Bukti manusia:</b>{" "}
            {stale
              ? "Konten berubah setelah bukti diajukan/diterima."
              : he.status === "ACCEPTED"
                ? `Diterima oleh ${he.decidedByName ?? "reviewer"}${
                    he.decisionReviewType ? ` (${he.decisionReviewType === "TECHNICAL" ? "teknis" : "kepatuhan"})` : ""
                  }`
                : he.status === "PENDING"
                  ? "Menunggu verifikasi reviewer"
                  : EV_STATUS_LABEL[he.status] ?? he.status}
          </p>
          {he.status === "ACCEPTED" && !stale && (
            <p className="v-evidence-note">
              Ini bukan kelulusan pemeriksaan otomatis dan bukan persetujuan regulator — hanya
              catatan bahwa reviewer melihat buktinya di manual.
            </p>
          )}
          {stale && (
            <p className="v-evidence-note">
              Konten bab/blok yang dirujuk berubah. Reviewer perlu meninjau ulang.
            </p>
          )}
          <p className="v-evidence-meta">
            Diajukan oleh {he.submittedByName ?? "penulis"} · bab{" "}
            {he.sectionKey ? SECTION_TITLE[he.sectionKey] ?? he.sectionKey : "—"}
            {he.note ? ` · “${he.note}”` : ""}
          </p>
          {he.returnReason && <p className="v-evidence-meta">Alasan pengembalian: {he.returnReason}</p>}
          <div className="v-item-actions">
            {he.sectionKey && (
              <button type="button" className="v-link" onClick={jump}>
                Lihat bukti <ChevronRight aria-hidden="true" size={12} />
              </button>
            )}
            {canReview && he.status === "PENDING" && returnFor !== he.id && (
              <>
                <button
                  type="button"
                  className="primary-button v-ev-btn"
                  disabled={evBusy}
                  onClick={() => void decide(he.id, "ACCEPT")}
                >
                  Terima bukti
                </button>
                <button type="button" className="secondary-button v-ev-btn" onClick={() => setReturnFor(he.id)}>
                  Kembalikan
                </button>
              </>
            )}
          </div>
          {canReview && returnFor === he.id && (
            <div className="v-na-form">
              <label>
                Alasan pengembalian (wajib)
                <textarea
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Mis. bab yang dirujuk belum benar-benar menjelaskan verifikasi status."
                />
              </label>
              <div className="v-na-form-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={evBusy || returnReason.trim().length < 5}
                  onClick={() => void decide(he.id, "RETURN")}
                >
                  Kembalikan bukti
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setReturnFor(null);
                    setReturnReason("");
                  }}
                >
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    // no submission yet: only an author, only an eligible WARNING, gets the button
    if (canReview || !it.humanEvidenceEligible || it.state !== "WARNING") return null;

    if (evidenceFor !== it.checkKey) {
      return (
        <button type="button" className="v-ev-open" onClick={() => openEvidenceForm(it)}>
          Sudah ada di manual
        </button>
      );
    }

    const chosen = evidenceSections.find((s) => s.key === evSectionKey);
    return (
      <div className="v-na-form v-evidence-form">
        <p className="v-evidence-note">
          Tunjuk bab/blok yang sudah mendokumentasikan hal ini. Reviewer akan memverifikasi —
          hasil otomatis tetap “{STATE_META[it.systemState].label}”.
        </p>
        <label>
          Bab bukti
          <select value={evSectionKey} onChange={(e) => { setEvSectionKey(e.target.value); setEvBlockId(""); }}>
            <option value="">— pilih bab —</option>
            {evidenceSections.map((s) => (
              <option key={s.id} value={s.key}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Blok (opsional)
          <select value={evBlockId} onChange={(e) => setEvBlockId(e.target.value)} disabled={!chosen}>
            <option value="">— seluruh bab —</option>
            {(chosen?.blocks ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Catatan (opsional)
          <textarea
            value={evNote}
            onChange={(e) => setEvNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Mis. paragraf kedua menjelaskan cara memverifikasi status Algo Trading."
          />
        </label>
        <div className="v-na-form-actions">
          <button
            type="button"
            className="primary-button"
            disabled={evBusy || !evSectionKey}
            onClick={() => void submitEvidence(it.checkKey)}
          >
            Ajukan bukti
          </button>
          <button type="button" className="secondary-button" onClick={() => setEvidenceFor(null)}>
            Batal
          </button>
        </div>
      </div>
    );
  };

  // one finding: a single line until the user expands it (UAT compactness).
  const renderFinding = (it: ItemResult) => {
    const m = STATE_META[it.state];
    const open = openFindings.has(it.checkKey);
    const sectionKey = it.navigateSectionKey;
    const owner = checklistOwner(it.checkKey);
    return (
      <li key={it.checkKey} className={`v-finding ${m.cls}`} data-open={open}>
        <button
          type="button"
          className="v-finding-row"
          aria-expanded={open}
          onClick={() => toggleFinding(it.checkKey)}
        >
          <m.Icon aria-hidden="true" size={14} />
          <span className="v-finding-label">{it.label}</span>
          <span className="v-finding-state">{m.label}</span>
          <ChevronRight aria-hidden="true" size={13} className="v-finding-caret" />
        </button>
        {open && (
          <div className="v-finding-detail">
            <p className="v-item-reason">{it.reason}</p>
            <p className="v-finding-cta">{OWNER_CTA[owner]}</p>
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
                <button type="button" className="v-na-btn v-na-secondary" onClick={() => setOverrideFor(it.checkKey)}>
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
            {renderHumanEvidence(it)}
          </div>
        )}
      </li>
    );
  };

  return (
    <section className="validation-panel" aria-label="Kesiapan dokumentasi" data-panel-manual-id={manualId} data-panel-version-id={manualVersionId} data-view-version-id={view?.manualVersionId ?? "none"}>
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
      <p className="v-vs-completion">
        Angka ini adalah kesiapan <b>dokumentasi</b>, bukan persentase bab yang ditandai selesai.
      </p>

      <ul className="v-counts">
        {(["PASS", "WARNING", "MISSING", "NOT_APPLICABLE"] as ChecklistState[]).map((s) => {
          const cm = STATE_META[s];
          return (
            <li key={s} className={cm.cls}>
              <cm.Icon aria-hidden="true" size={13} /> {cm.label} <b>{counts[s]}</b>
            </li>
          );
        })}
      </ul>

      <p className="v-disclaimer">
        Skor ini mengukur kelengkapan dokumentasi dan bukan persetujuan regulator. Keputusan
        review kepatuhan adalah tindakan manusia yang terpisah.
      </p>

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

      <div className="v-tabs" role="tablist" aria-label="Tampilan pemeriksaan">
        <button type="button" role="tab" aria-selected={tab === "todo"} onClick={() => setTab("todo")}>
          Perlu diperbaiki <b>{actionable.length}</b>
        </button>
        <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>
          Semua pemeriksaan
        </button>
      </div>

      {tab === "todo" ? (
        actionable.length === 0 ? (
          <p className="v-allclear" role="status">
            <Check aria-hidden="true" size={14} /> Semua pemeriksaan yang berlaku sudah lolos atau ditinjau.
          </p>
        ) : (
          <>
            <div className="v-todo-head">
              <p className="v-todo-count">
                <b>{actionable.length}</b> membutuhkan tindakan
              </p>
              <div className="v-todo-controls">
                <button type="button" className="v-textbtn" onClick={expandAll}>
                  Lihat semua
                </button>
                <button type="button" className="v-textbtn" onClick={collapseAll}>
                  Tutup semua
                </button>
              </div>
            </div>
            {ownerGroups.map(([owner, group]) => {
              const oOpen = isOwnerOpen(owner);
              return (
                <div key={owner} className="v-owner" data-open={oOpen}>
                  <button
                    type="button"
                    className="v-owner-row"
                    aria-expanded={oOpen}
                    onClick={() => toggleOwner(owner)}
                  >
                    <span className="v-owner-name">{CHECKLIST_OWNER_LABEL[owner]}</span>
                    <span className="v-owner-tally">{group.length}</span>
                    <ChevronRight aria-hidden="true" size={13} className="v-owner-caret" />
                  </button>
                  {oOpen && <ul className="v-findings">{group.map(renderFinding)}</ul>}
                </div>
              );
            })}
          </>
        )
      ) : (
        groupedItems.map(([category, groupItems]) => (
          <details key={category} className="v-group" open>
            <summary>
              {CATEGORY_LABELS[category] ?? category}
              <span className="v-group-tally">
                {groupItems.filter((i) => i.state === "PASS").length}/{groupItems.length}
              </span>
            </summary>
            <ul className="v-findings">{groupItems.map(renderFinding)}</ul>
          </details>
        ))
      )}

      {tab === "todo" && passing.length > 0 && (
        <div className="v-passing">
          <button type="button" className="v-passing-toggle" onClick={() => setShowPassing((s) => !s)} aria-expanded={showPassing}>
            <Check aria-hidden="true" size={13} /> {passing.length} pemeriksaan lainnya lolos {showPassing ? "▲" : "▾"}
          </button>
          {showPassing && (
            <ul className="v-items v-items-passing">
              {passing.map((it) => (
                <li key={it.checkKey} className="v-item v-pass">
                  <p className="v-item-head">
                    <Check aria-hidden="true" size={13} />
                    <span className="v-item-label">{it.label}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "todo" && notApplicable.length > 0 && (
        <div className="v-passing">
          <button type="button" className="v-passing-toggle" onClick={() => setShowNa((s) => !s)} aria-expanded={showNa}>
            <MinusCircle aria-hidden="true" size={13} /> {notApplicable.length} tidak berlaku {showNa ? "▲" : "▾"}
          </button>
          {showNa && <ul className="v-findings v-findings-na">{notApplicable.map(renderFinding)}</ul>}
        </div>
      )}

      {tab === "todo" && resolvedByHuman.length > 0 && (
        <div className="v-passing">
          <button
            type="button"
            className="v-passing-toggle"
            onClick={() => setShowResolved((s) => !s)}
            aria-expanded={showResolved}
          >
            <Check aria-hidden="true" size={13} /> {resolvedByHuman.length} diselesaikan lewat tinjauan manusia{" "}
            {showResolved ? "▲" : "▾"}
          </button>
          {showResolved && <ul className="v-findings">{resolvedByHuman.map(renderFinding)}</ul>}
        </div>
      )}

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
            Terakhir dievaluasi{" "}
            <time dateTime={view.evaluatedAt} suppressHydrationWarning>
              {new Date(view.evaluatedAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
            </time>
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
