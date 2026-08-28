"use client";

import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleDashed, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ManualListRow } from "./queries";
import type { ManualStatusDb } from "@/lib/supabase/database.types";

export const STATUS_LABELS: Record<ManualStatusDb, string> = {
  DRAFT: "Draf",
  TECHNICAL_REVIEW: "Review teknis",
  COMPLIANCE_REVIEW: "Review kepatuhan",
  CHANGES_REQUESTED: "Perlu perubahan",
  APPROVED: "Disetujui",
  PUBLISHED: "Diterbitkan",
  ARCHIVED: "Diarsipkan",
};

const STATUS_ICON: Record<ManualStatusDb, typeof CheckCircle2> = {
  DRAFT: CircleDashed,
  TECHNICAL_REVIEW: CircleDashed,
  COMPLIANCE_REVIEW: CircleDashed,
  CHANGES_REQUESTED: AlertTriangle,
  APPROVED: CheckCircle2,
  PUBLISHED: CheckCircle2,
  ARCHIVED: CircleDashed,
};

export function StatusBadge({ status }: { status: ManualStatusDb }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className="status-badge" data-status={status}>
      <Icon aria-hidden="true" size={14} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function Row({ manual }: { manual: ManualListRow }) {
  return (
    <tr>
      <td data-label="EA">
        <strong>{manual.eaName}</strong>
        <span className="mobile-subline">
          {manual.platform} · EA {manual.eaVersion}
        </span>
      </td>
      <td data-label="Platform">
        <span className="platform-badge">{manual.platform}</span>
      </td>
      <td data-label="Versi EA" className="mono">
        {manual.eaVersion}
      </td>
      <td data-label="Versi manual" className="mono">
        {manual.manualVersion}
      </td>
      <td data-label="Bab" className="mono">
        {manual.sectionsTotal}
      </td>
      <td data-label="Status">
        <StatusBadge status={manual.status} />
      </td>
      <td data-label="Diperbarui">{new Date(manual.updatedAt).toLocaleDateString("id-ID")}</td>
      <td data-label="Aksi">
        <Link className="table-action" href={`/manuals/${manual.manualId}/edit`}>
          Buka <ArrowUpRight aria-hidden="true" size={15} />
        </Link>
      </td>
    </tr>
  );
}

export function ManualTable({
  rows,
  compact = false,
  canCreate = false,
}: {
  rows: ManualListRow[];
  compact?: boolean;
  canCreate?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | ManualStatusDb>("ALL");

  const filtered = useMemo(
    () =>
      rows.filter((m) => {
        const matchesQuery = m.eaName.toLowerCase().includes(query.toLowerCase());
        const matchesStatus = status === "ALL" || m.status === status;
        return matchesQuery && matchesStatus;
      }),
    [rows, query, status],
  );
  const displayed = compact ? filtered.slice(0, 5) : filtered;

  return (
    <div className="table-region">
      {!compact && (
        <div className="filter-bar">
          <label className="search-field">
            <Search aria-hidden="true" size={17} />
            <span className="sr-only">Cari manual</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama EA…" />
          </label>
          <label>
            <span className="sr-only">Filter status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as "ALL" | ManualStatusDb)}>
              <option value="ALL">Semua status</option>
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <span className="filter-count">{displayed.length} manual</span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">
          <Search aria-hidden="true" size={26} />
          <h2>Belum ada manual</h2>
          <p>
            {canCreate
              ? "Buat manual pertama untuk organisasi ini."
              : "Manual akan muncul di sini setelah dibuat oleh developer."}
          </p>
          {canCreate && (
            <Link className="secondary-button" href="/manuals/new">
              Buat manual
            </Link>
          )}
        </div>
      ) : displayed.length === 0 ? (
        <div className="empty-state">
          <Search aria-hidden="true" size={26} />
          <h2>Manual tidak ditemukan</h2>
          <p>Coba ubah kata kunci atau filter status.</p>
          <button
            className="secondary-button"
            onClick={() => {
              setQuery("");
              setStatus("ALL");
            }}
          >
            Reset filter
          </button>
        </div>
      ) : (
        <div className="responsive-table-wrap">
          <table className="manual-table">
            <thead>
              <tr>
                <th>EA</th>
                <th>Platform</th>
                <th>Versi EA</th>
                <th>Versi manual</th>
                <th>Bab</th>
                <th>Status</th>
                <th>Diperbarui</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((m) => (
                <Row key={m.manualId} manual={m} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
