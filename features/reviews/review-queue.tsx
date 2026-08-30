import Link from "next/link";
import { CheckCircle2, Clock3, FileClock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import type { ReviewQueueRow } from "./queries";

const STATUS_LABEL: Record<string, string> = {
  TECHNICAL_REVIEW: "Menunggu review teknis",
  COMPLIANCE_REVIEW: "Menunggu review kepatuhan",
};

/** Real, assignment-scoped review queue (AC-P6-3). Server-rendered from Supabase. */
export function ReviewQueue({
  eyebrow,
  title,
  description,
  rows,
  isAdmin,
}: {
  eyebrow: string;
  title: string;
  description: string;
  rows: ReviewQueueRow[];
  isAdmin: boolean;
}) {
  return (
    <div className="page-container">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      {rows.length === 0 ? (
        <section className="card review-queue-empty" aria-label={title}>
          <FileClock aria-hidden="true" size={20} />
          <p>Tidak ada manual yang menunggu keputusan Anda saat ini.</p>
        </section>
      ) : (
        <section className="card section-list" aria-label={title}>
          {rows.map((r) => (
            <article key={r.manualVersionId}>
              {r.assignedToMe ? (
                <CheckCircle2 aria-hidden="true" className="text-success" />
              ) : (
                <Clock3 aria-hidden="true" />
              )}
              <div>
                <h2>
                  {r.eaName} v{r.eaVersion}
                </h2>
                <p>
                  Manual {r.manualVersion} · ronde review {r.reviewRound} ·{" "}
                  {STATUS_LABEL[r.status] ?? r.status}
                  {isAdmin && !r.assignedToMe ? " · (dilihat sebagai admin)" : ""}
                </p>
              </div>
              <Link className="secondary-button" href={`/manuals/${r.manualId}/edit`}>
                Buka
              </Link>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
