"use client";

/**
 * UAT-18 — contextual guidance for a canonical chapter, shown in the builder. UI-only: never
 * persisted, never rendered in Preview / Public / Print / PDF, never validation evidence.
 * Prominent in the empty state; a compact <details> above an existing block list.
 */

import { Info } from "lucide-react";
import { chapterGuidance } from "@/lib/domain/chapter-guidance";

const BLOCK_LABEL: Record<string, string> = {
  text: "Teks",
  steps: "Langkah instalasi",
  image: "Gambar",
  callout: "Callout",
  parameterTable: "Tabel parameter",
  faq: "FAQ",
};

function Body({ g }: { g: NonNullable<ReturnType<typeof chapterGuidance>> }) {
  return (
    <>
      <p className="cg-purpose">{g.purpose}</p>
      {g.belongs.length > 0 && (
        <>
          <p className="cg-h">Yang perlu diisi</p>
          <ul className="cg-list">
            {g.belongs.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </>
      )}
      {g.doNotAssume.length > 0 && (
        <>
          <p className="cg-h">Jangan diasumsikan / dikarang</p>
          <ul className="cg-list cg-dont">
            {g.doNotAssume.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </>
      )}
      <p className="cg-suggested">
        Disarankan: {g.suggestedBlocks.map((b) => BLOCK_LABEL[b] ?? b).join(" · ")}
      </p>
      {g.example && <p className="cg-example">{g.example}</p>}
    </>
  );
}

export function ChapterGuidancePanel({
  sectionKey,
  variant,
}: {
  sectionKey: string;
  variant: "empty" | "compact";
}) {
  const g = chapterGuidance(sectionKey);
  if (!g) return null; // custom chapter — no canonical guidance

  if (variant === "compact") {
    return (
      <details className="chapter-guidance chapter-guidance-compact">
        <summary>
          <Info aria-hidden="true" size={13} /> Apa yang perlu diisi di bab ini?
        </summary>
        <div className="cg-body">
          <Body g={g} />
        </div>
      </details>
    );
  }

  return (
    <section className="chapter-guidance chapter-guidance-empty" aria-label="Panduan bab">
      <p className="cg-title">
        <Info aria-hidden="true" size={14} /> Apa yang perlu diisi di bab ini?
      </p>
      <div className="cg-body">
        <Body g={g} />
      </div>
    </section>
  );
}
