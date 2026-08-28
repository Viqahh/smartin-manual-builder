import { CheckCircle2, Clock3 } from "lucide-react";
import { PageHeader } from "@/components/page-header";

export function SectionPage({
  eyebrow,
  title,
  description,
  items,
}: {
  eyebrow: string;
  title: string;
  description: string;
  items: { title: string; detail: string; ready?: boolean }[];
}) {
  return (
    <div className="page-container">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <section className="card section-list" aria-label={title}>
        {items.map((item) => (
          <article key={item.title}>
            {item.ready ? <CheckCircle2 aria-hidden="true" className="text-success" /> : <Clock3 aria-hidden="true" />}
            <div><h2>{item.title}</h2><p>{item.detail}</p></div>
            <span className="status-text">{item.ready ? "Tersedia" : "Phase berikutnya"}</span>
          </article>
        ))}
      </section>
    </div>
  );
}
