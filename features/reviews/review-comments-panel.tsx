"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CornerUpLeft, MapPin, MessageSquare } from "lucide-react";
import type { ReviewCommentRow } from "./queries";
import { createReviewComment, setReviewCommentResolved } from "./actions";

type ComposeTarget =
  | { kind: "manual" }
  | { kind: "section" }
  | { kind: "block"; blockId: string };

export type ReviewCommentsPanelProps = {
  manualId: string;
  reviewRound: number;
  comments: ReviewCommentRow[];
  /** the active review stage the viewer may comment in — or null (read-only history) */
  canComment: "TECHNICAL" | "COMPLIANCE" | null;
  canResolveTechnical: boolean;
  canResolveCompliance: boolean;
  currentSection: { id: string; key: string; title: string; position: number } | null;
  currentSectionBlocks: { id: string; label: string }[];
  onNavigateSection: (sectionKey: string) => void;
  onFocusBlock: (sectionKey: string, blockId: string) => void;
};

const TYPE_LABEL = { TECHNICAL: "Teknis", COMPLIANCE: "Kepatuhan" } as const;

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return ts;
  }
}

export function ReviewCommentsPanel(props: ReviewCommentsPanelProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<ComposeTarget>({ kind: "manual" });

  const byRound = useMemo(() => {
    const m = new Map<number, ReviewCommentRow[]>();
    for (const c of props.comments) {
      const list = m.get(c.round) ?? [];
      list.push(c);
      m.set(c.round, list);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [props.comments]);

  const unresolved = props.comments.filter((c) => !c.resolved).length;

  const canResolve = (t: ReviewCommentRow["reviewType"]) =>
    t === "TECHNICAL" ? props.canResolveTechnical : props.canResolveCompliance;

  const submit = () => {
    if (!props.canComment) return;
    const text = body.trim();
    if (text.length === 0) {
      setError("Komentar tidak boleh kosong.");
      return;
    }
    setError(null);
    const payloadTarget =
      target.kind === "manual"
        ? { kind: "manual" as const }
        : target.kind === "section"
          ? { kind: "section" as const, sectionId: props.currentSection?.id ?? "" }
          : { kind: "block" as const, blockId: target.blockId };
    start(async () => {
      const res = await createReviewComment({
        manualId: props.manualId,
        reviewType: props.canComment,
        target: payloadTarget,
        body: text,
      });
      if (res.ok) {
        setBody(""); // keep the target selection for the next comment
        router.refresh();
      } else {
        const detail = res.issues?.map((i) => i.message).join(" · ");
        setError(detail ? `${res.message} ${detail}` : res.message ?? "Gagal menyimpan komentar.");
        // body is intentionally preserved on error (§5)
      }
    });
  };

  const toggleResolved = (c: ReviewCommentRow) => {
    setError(null);
    start(async () => {
      const res = await setReviewCommentResolved({ commentId: c.id, resolved: !c.resolved });
      if (res.ok) router.refresh();
      else setError(res.message ?? "Gagal memperbarui status komentar.");
    });
  };

  return (
    <section className="rc-panel" aria-label="Komentar review">
      <header className="rc-panel-head">
        <h3>
          <MessageSquare aria-hidden="true" size={15} /> Komentar review
        </h3>
        <span className="rc-count">
          {props.comments.length} komentar{unresolved > 0 ? ` · ${unresolved} belum selesai` : ""}
        </span>
      </header>

      {props.comments.length === 0 && (
        <p className="rc-empty">Belum ada komentar review pada versi manual ini.</p>
      )}

      {byRound.map(([round, list]) => (
        <div className="rc-round" key={round}>
          <p className="rc-round-head">Ronde {round}</p>
          <ul className="rc-list">
            {list.map((c) => (
              <li className="rc-card" key={c.id} data-resolved={c.resolved}>
                <div className="rc-card-top">
                  <span className="rc-chip" data-type={c.reviewType}>
                    {TYPE_LABEL[c.reviewType]}
                  </span>
                  <span className="rc-meta">
                    {c.authorName} · {fmt(c.createdAt)}
                  </span>
                </div>

                <p className="rc-anchor">
                  {c.anchor.kind === "manual" && <span>Komentar umum (seluruh manual)</span>}
                  {c.anchor.kind === "section" && (
                    <>
                      <span>
                        <MapPin aria-hidden="true" size={12} /> Bab: {c.anchor.title}
                      </span>
                      <button
                        type="button"
                        className="rc-link"
                        onClick={() => props.onNavigateSection(c.anchor.kind === "section" ? c.anchor.sectionKey : "")}
                      >
                        Lihat
                      </button>
                    </>
                  )}
                  {c.anchor.kind === "block" && (
                    <>
                      <span>
                        <MapPin aria-hidden="true" size={12} /> Blok #{c.anchor.position + 1} · {c.anchor.blockType}
                        {c.anchor.deleted ? " — blok sudah dihapus pada revisi berikutnya" : ""} (Bab: {c.anchor.sectionTitle})
                      </span>
                      <button
                        type="button"
                        className="rc-link"
                        onClick={() =>
                          c.anchor.kind === "block" &&
                          (c.anchor.deleted
                            ? props.onNavigateSection(c.anchor.sectionKey)
                            : props.onFocusBlock(c.anchor.sectionKey, c.anchor.blockId))
                        }
                      >
                        {c.anchor.deleted ? "Lihat bab" : "Lihat"}
                      </button>
                    </>
                  )}
                </p>

                <p className="rc-body">{c.body}</p>

                <div className="rc-card-foot">
                  {c.resolved ? (
                    <span className="rc-resolved">
                      <Check aria-hidden="true" size={13} /> Selesai
                      {c.resolvedByName ? ` — ${c.resolvedByName}` : ""}
                      {c.resolvedAt ? ` · ${fmt(c.resolvedAt)}` : ""}
                    </span>
                  ) : (
                    <span className="rc-open">Belum diselesaikan</span>
                  )}
                  {canResolve(c.reviewType) && (
                    <button
                      type="button"
                      className="secondary-button rc-toggle"
                      disabled={pending}
                      onClick={() => toggleResolved(c)}
                    >
                      {c.resolved ? (
                        <>
                          <CornerUpLeft aria-hidden="true" size={13} /> Buka lagi
                        </>
                      ) : (
                        <>
                          <Check aria-hidden="true" size={13} /> Tandai selesai
                        </>
                      )}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {props.canComment && (
        <form
          className="rc-compose"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="rc-compose-head">
            Komentar {TYPE_LABEL[props.canComment].toLowerCase()} · ronde {props.reviewRound}
          </p>
          <div className="rc-target">
            <label>
              <input
                type="radio"
                name="rc-target"
                checked={target.kind === "manual"}
                onChange={() => setTarget({ kind: "manual" })}
              />
              Umum
            </label>
            <label data-disabled={!props.currentSection}>
              <input
                type="radio"
                name="rc-target"
                disabled={!props.currentSection}
                checked={target.kind === "section"}
                onChange={() => setTarget({ kind: "section" })}
              />
              Bab ini{props.currentSection ? `: ${props.currentSection.title}` : ""}
            </label>
            <label data-disabled={props.currentSectionBlocks.length === 0}>
              <input
                type="radio"
                name="rc-target"
                disabled={props.currentSectionBlocks.length === 0}
                checked={target.kind === "block"}
                onChange={() =>
                  setTarget({ kind: "block", blockId: props.currentSectionBlocks[0]?.id ?? "" })
                }
              />
              Blok
            </label>
            {target.kind === "block" && (
              <select
                className="rc-block-select"
                value={target.blockId}
                onChange={(e) => setTarget({ kind: "block", blockId: e.target.value })}
              >
                {props.currentSectionBlocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <textarea
            rows={3}
            maxLength={5000}
            value={body}
            placeholder="Tuliskan temuan review untuk pembuat manual."
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="rc-compose-foot">
            <span className="rc-charcount">{body.length}/5000</span>
            <button className="primary-button" type="submit" disabled={pending || body.trim().length === 0}>
              Kirim komentar
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="rc-error" role="alert">
          <AlertTriangle aria-hidden="true" size={13} /> {error}
        </p>
      )}
    </section>
  );
}
