"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import {
  searchPublicIndex,
  type PublicSearchEntry,
  type PublicSearchResult,
} from "@/lib/publication/search-index";

/**
 * Phase 7 slice 2 — in-page search over ONE published snapshot.
 *
 * Pure matching lives in `searchPublicIndex` (unit-tested). This component only renders: a real
 * `<input type="search">` with an accessible name, a clear button, a `aria-live` result count, a
 * "Tidak ada hasil." empty state, and a results list of chapter links (`#chapter-N`). The query
 * term is `<mark>`-highlighted in the snippet only — the document body is never mutated. Cmd/Ctrl+K
 * focuses the field unless another text control already has focus.
 */

function highlight(snippet: string, query: string) {
  const q = query.trim();
  if (!q) return snippet;
  const lower = snippet.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < snippet.length) {
    const at = lower.indexOf(needle, i);
    if (at === -1) {
      parts.push(<Fragment key={n++}>{snippet.slice(i)}</Fragment>);
      break;
    }
    if (at > i) parts.push(<Fragment key={n++}>{snippet.slice(i, at)}</Fragment>);
    parts.push(<mark key={n++}>{snippet.slice(at, at + q.length)}</mark>);
    i = at + q.length;
  }
  return parts;
}

export function ManualSearch({ index }: { index: PublicSearchEntry[] }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results: PublicSearchResult[] | null = useMemo(() => {
    if (!query.trim()) return null;
    return searchPublicIndex(index, query);
  }, [index, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        const el = document.activeElement;
        const tag = el?.tagName;
        const typing =
          tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement | null)?.isContentEditable;
        if (typing && el !== inputRef.current) return;
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="pm-search">
      <label className="pm-search-field">
        <span className="sr-only">Cari di manual</span>
        <Search aria-hidden="true" size={16} />
        <input
          ref={inputRef}
          type="search"
          placeholder="Cari di manual…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-controls={listId}
          aria-describedby={`${listId}-count`}
        />
        <kbd className="pm-search-kbd" aria-hidden="true">
          ⌘K
        </kbd>
        {query && (
          <button
            type="button"
            className="pm-search-clear"
            aria-label="Hapus pencarian"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X aria-hidden="true" size={15} />
          </button>
        )}
      </label>

      <p id={`${listId}-count`} className="pm-search-count" aria-live="polite">
        {results ? `${results.length} hasil` : ""}
      </p>

      {results && (
        <div className="pm-search-results" id={listId}>
          {results.length === 0 ? (
            <p className="pm-search-empty">Tidak ada hasil.</p>
          ) : (
            <ul>
              {results.map((r, i) => (
                <li key={`${r.anchor}-${i}`}>
                  <a href={`#${r.anchor}`} onClick={() => setQuery("")}>
                    <span className="pm-search-kind">{r.kind}</span>
                    <span className="pm-search-chapter">{r.chapter}</span>
                    <span className="pm-search-snippet">{highlight(r.snippet, query)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
