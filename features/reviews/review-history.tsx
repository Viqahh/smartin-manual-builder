import Link from "next/link";
import { ArrowLeft, Check, MessageSquare, RotateCcw } from "lucide-react";
import type { ManualStatusDb } from "@/lib/supabase/database.types";
import type { ReviewHistory, ReviewCommentRow } from "@/features/reviews/queries";

const INTERNAL_NOTE = "Keputusan internal Smartin atas dokumentasi, bukan persetujuan regulator.";

const STATUS_LABEL: Record<ManualStatusDb, string> = {
  DRAFT: "Draf",
  TECHNICAL_REVIEW: "Review teknis",
  COMPLIANCE_REVIEW: "Review kepatuhan",
  CHANGES_REQUESTED: "Perlu perubahan",
  APPROVED: "Disetujui",
  PUBLISHED: "Diterbitkan",
  ARCHIVED: "Diarsipkan",
};

function fmt(ts: string): string {
  return new Date(ts).toLocaleString("id-ID");
}

function anchorLabel(a: ReviewCommentRow["anchor"]): string {
  if (a.kind === "manual") return "Seluruh manual";
  if (a.kind === "section") return `Bab · ${a.title}`;
  return `Blok #${a.position + 1} · ${a.blockType}${a.deleted ? " (blok telah dihapus)" : ""} · ${a.sectionTitle}`;
}

function CommentItem({ c }: { c: ReviewCommentRow }) {
  return (
    <li className="rh-comment">
      <div className="rh-comment-head">
        <span className="rh-badge" data-type={c.reviewType}>
          {c.reviewType === "TECHNICAL" ? "Teknis" : "Kepatuhan"}
        </span>
        <span className="rh-comment-author">{c.authorName}</span>
        <span className="rh-comment-time">{fmt(c.createdAt)}</span>
        <span className="rh-comment-state" data-resolved={c.resolved}>
          {c.resolved ? (
            <>
              <Check aria-hidden="true" size={12} /> Selesai
              {c.resolvedByName ? ` · ${c.resolvedByName}` : ""}
              {c.resolvedAt ? ` · ${fmt(c.resolvedAt)}` : ""}
            </>
          ) : (
            "Belum selesai"
          )}
        </span>
      </div>
      <p className="rh-comment-anchor">{anchorLabel(c.anchor)}</p>
      <p className="rh-comment-body">{c.body}</p>
    </li>
  );
}

function DecisionItem({ d }: { d: ReviewHistory["rounds"][number]["decisions"][number] }) {
  const who = d.reviewType === "TECHNICAL" ? "reviewer teknis" : "reviewer kepatuhan";
  if (d.decision === "APPROVE") {
    return (
      <li className="rh-decision" data-kind="approve">
        <Check aria-hidden="true" size={15} />
        <div>
          <p className="rh-decision-line">
            <strong>Disetujui {who}</strong> — {d.actorName} · {fmt(d.decidedAt)}
          </p>
          <p className="rh-decision-note">{INTERNAL_NOTE}</p>
        </div>
      </li>
    );
  }
  return (
    <li className="rh-decision" data-kind="changes">
      <RotateCcw aria-hidden="true" size={15} />
      <div>
        <p className="rh-decision-line">
          <strong>Perubahan diminta oleh {who}</strong> — {d.actorName} · {fmt(d.decidedAt)}
        </p>
        {d.summary && <p className="rh-decision-summary">{d.summary}</p>}
      </div>
    </li>
  );
}

export function ReviewHistoryView({
  history,
  siblings,
  manualId,
}: {
  history: ReviewHistory;
  siblings: { manualVersionId: string; version: string }[];
  manualId: string;
}) {
  const h = history;
  return (
    <div className="page-container review-history">
      <header className="rh-header">
        <Link className="rh-back" href={`/manuals/${manualId}/edit`}>
          <ArrowLeft aria-hidden="true" size={15} /> Kembali ke manual
        </Link>
        <h1>Riwayat review</h1>
        <p className="rh-sub">
          {h.eaName} · EA v{h.eaVersion} ({h.eaPlatform}) · Versi manual <span className="mono">{h.manualVersion}</span>
        </p>
      </header>

      {siblings.length > 1 && (
        <nav className="rh-versions" aria-label="Pilih versi manual">
          <span>Versi manual:</span>
          {siblings.map((s) => (
            <Link
              key={s.manualVersionId}
              href={`/manuals/${manualId}/reviews?v=${s.manualVersionId}`}
              aria-current={s.manualVersionId === h.manualVersionId ? "page" : undefined}
              className={s.manualVersionId === h.manualVersionId ? "rh-version-current" : ""}
            >
              {s.version}
            </Link>
          ))}
        </nav>
      )}

      <section className="card rh-current">
        <h2>Status saat ini</h2>
        <dl>
          <div>
            <dt>Status alur</dt>
            <dd>{STATUS_LABEL[h.status as ManualStatusDb] ?? h.status}</dd>
          </div>
          <div>
            <dt>Ronde review</dt>
            <dd className="mono">{h.reviewRound}</dd>
          </div>
          <div>
            <dt>Reviewer teknis</dt>
            <dd>{h.technicalReviewerName ?? "belum ditetapkan"}</dd>
          </div>
          <div>
            <dt>Reviewer kepatuhan</dt>
            <dd>{h.complianceReviewerName ?? "belum ditetapkan"}</dd>
          </div>
          {h.publishedAt && (
            <div>
              <dt>Diterbitkan</dt>
              <dd>{fmt(h.publishedAt)}</dd>
            </div>
          )}
          {h.archivedAt && (
            <div>
              <dt>Diarsipkan</dt>
              <dd>{fmt(h.archivedAt)}</dd>
            </div>
          )}
        </dl>
        <p className="rh-current-note">{INTERNAL_NOTE}</p>
      </section>

      {h.rounds.length === 0 ? (
        <p className="rh-empty">Manual ini belum pernah dikirim untuk review.</p>
      ) : (
        h.rounds.map((r) => (
          <section key={r.round} className="card rh-round">
            <h2>Ronde {r.round}</h2>

            {r.decisions.length > 0 ? (
              <ul className="rh-decisions">
                {r.decisions.map((d, i) => (
                  <DecisionItem key={`${d.reviewType}-${i}`} d={d} />
                ))}
              </ul>
            ) : (
              <p className="rh-round-pending">Belum ada keputusan pada ronde ini.</p>
            )}

            <div className="rh-comments-head">
              <MessageSquare aria-hidden="true" size={14} />
              <span>Komentar ({r.comments.length})</span>
            </div>
            {r.comments.length > 0 ? (
              <ul className="rh-comments">
                {r.comments.map((c) => (
                  <CommentItem key={c.id} c={c} />
                ))}
              </ul>
            ) : (
              <p className="rh-round-pending">Tidak ada komentar pada ronde ini.</p>
            )}
          </section>
        ))
      )}
    </div>
  );
}
