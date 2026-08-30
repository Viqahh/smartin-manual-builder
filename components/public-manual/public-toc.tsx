"use client";

import { type MouseEvent, useEffect, useState } from "react";
import type { TocEntry } from "@/lib/publication/toc";

/**
 * Phase 7 slice 2 — public table of contents.
 *
 * Renders a desktop sidebar `<nav>` and a native `<details>` for small widths from the SAME
 * `toc` array (identical order to `ManualRenderer`). Links are real `#chapter-N` fragments —
 * deep-linking and no-JS navigation work without this component running. An `IntersectionObserver`
 * tracks the active chapter (deterministic: first `toc` entry currently intersecting); it is the
 * only client behaviour and it disconnects on cleanup. It never mutates the rendered document DOM.
 */
export function PublicToc({ toc }: { toc: TocEntry[] }) {
  const [active, setActive] = useState<string | null>(toc[0]?.anchor ?? null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const els = toc
      .map((t) => ({ anchor: t.anchor, el: document.getElementById(t.anchor) }))
      .filter((x): x is { anchor: string; el: HTMLElement } => x.el != null);
    if (!els.length) return;

    // Deterministic active chapter: the LAST one whose top has crossed the reading line just under
    // the sticky header. Tall sections mean several are on screen at once — position order decides,
    // never callback order. An IntersectionObserver is the primary trigger; a passive rAF-throttled
    // scroll/resize listener is the fallback (no setInterval, nothing runs while idle). Both call
    // the same pure recompute over live positions.
    const LINE = 140;
    let raf = 0;
    const recompute = () => {
      raf = 0;
      let current = els[0].anchor;
      for (const { anchor, el } of els) {
        if (el.getBoundingClientRect().top - 1 <= LINE) current = anchor;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(recompute);
    };

    let observer: IntersectionObserver | undefined;
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(schedule, { rootMargin: "0px 0px -55% 0px", threshold: [0, 1] });
      els.forEach(({ el }) => observer!.observe(el));
    }
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    recompute();

    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [toc]);

  const list = (onNavigate?: (e: MouseEvent<HTMLAnchorElement>) => void) => (
    <ol className="pm-toc-list">
      {toc.map((t) => (
        <li key={t.anchor}>
          <a
            href={`#${t.anchor}`}
            aria-current={active === t.anchor ? "location" : undefined}
            className={active === t.anchor ? "is-active" : undefined}
            onClick={onNavigate}
          >
            <span className="pm-toc-num">{t.number}</span>
            <span className="pm-toc-title">{t.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );

  // collapse the mobile <details> after a chapter is chosen (find it from the event, no ref)
  const closeMobile = (e: MouseEvent<HTMLAnchorElement>) => {
    e.currentTarget.closest("details")?.removeAttribute("open");
  };

  return (
    <div className="pm-toc">
      <nav className="pm-toc-desktop" aria-label="Daftar isi">
        <p className="pm-toc-heading">Daftar Isi</p>
        {list()}
      </nav>

      <details className="pm-toc-mobile">
        <summary>Daftar Isi</summary>
        <nav aria-label="Daftar isi">{list(closeMobile)}</nav>
      </details>
    </div>
  );
}
