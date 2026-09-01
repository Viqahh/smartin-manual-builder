"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";

export type ResourceItem = {
  id: string;
  title: string;
  /** short one-line subtitle shown in the collapsed header */
  meta?: string;
  /** free text used for search matching (not rendered) */
  keywords?: string;
  body: ReactNode;
};

/**
 * Searchable expand/collapse list for the workspace resource pages (UAT-30/31/32). No-JS-safe
 * fallback: without the filter, every item still renders inside a native <details>.
 */
export function ResourceAccordion({
  items,
  searchPlaceholder = "Cari topik…",
}: {
  items: ResourceItem[];
  searchPlaceholder?: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) =>
      `${it.title} ${it.meta ?? ""} ${it.keywords ?? ""}`.toLowerCase().includes(needle),
    );
  }, [items, q]);

  return (
    <div className="resource-accordion">
      <label className="resource-search">
        <Search aria-hidden="true" size={15} />
        <input
          type="search"
          value={q}
          placeholder={searchPlaceholder}
          onChange={(e) => setQ(e.target.value)}
          aria-label={searchPlaceholder}
        />
      </label>
      {filtered.length === 0 ? (
        <p className="resource-empty">Tidak ada topik yang cocok dengan “{q}”.</p>
      ) : (
        <ul className="resource-list">
          {filtered.map((it) => (
            <li key={it.id}>
              <details>
                <summary>
                  <span className="resource-item-title">{it.title}</span>
                  {it.meta && <span className="resource-item-meta">{it.meta}</span>}
                  <ChevronDown aria-hidden="true" size={15} className="resource-item-chevron" />
                </summary>
                <div className="resource-item-body">{it.body}</div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
