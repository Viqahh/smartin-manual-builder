"use client";

import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleDashed, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { manuals, ManualRecord, ManualStatus, statusLabels } from "./mock-data";

const statusIcons: Record<ManualStatus, typeof CheckCircle2> = {
  DRAFT: CircleDashed,
  TECHNICAL_REVIEW: CircleDashed,
  COMPLIANCE_REVIEW: CircleDashed,
  CHANGES_REQUESTED: AlertTriangle,
  APPROVED: CheckCircle2,
  PUBLISHED: CheckCircle2,
};

export function StatusBadge({ status }: { status: ManualStatus }) {
  const Icon = statusIcons[status];
  return (
    <span className="status-badge" data-status={status}>
      <Icon aria-hidden="true" size={14} />
      {statusLabels[status]}
    </span>
  );
}

export function Completion({ value }: { value: number }) {
  return (
    <div className="completion-cell" aria-label={`Kelengkapan ${value}%`}>
      <span>{value}%</span>
      <span className="progress-track"><span style={{ width: `${value}%` }} /></span>
    </div>
  );
}

function ManualRow({ manual }: { manual: ManualRecord }) {
  return (
    <tr>
      <td data-label="EA"><strong>{manual.eaName}</strong><span className="mobile-subline">{manual.platform} · EA {manual.eaVersion}</span></td>
      <td data-label="Platform"><span className="platform-badge">{manual.platform}</span></td>
      <td data-label="Versi EA" className="mono">{manual.eaVersion}</td>
      <td data-label="Versi manual" className="mono">{manual.manualVersion}</td>
      <td data-label="Kelengkapan"><Completion value={manual.completion} /></td>
      <td data-label="Checklist" className="mono">{manual.compliance}</td>
      <td data-label="Status"><StatusBadge status={manual.status} /></td>
      <td data-label="Diperbarui">{manual.updated}</td>
      <td data-label="Aksi">
        <Link className="table-action" href={`/manuals/${manual.id}/edit`}>
          Buka <ArrowUpRight aria-hidden="true" size={15} />
        </Link>
      </td>
    </tr>
  );
}

export function ManualTable({ compact = false }: { compact?: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [records, setRecords] = useState(manuals);

  useEffect(() => {
    const raw = localStorage.getItem("smartin-new-manual");
    if (!raw) return;
    let frame = 0;
    try {
      const created = JSON.parse(raw) as ManualRecord;
      frame = requestAnimationFrame(() => setRecords((current) => current.some((item) => item.id === created.id) ? current : [created, ...current]));
    } catch {
      localStorage.removeItem("smartin-new-manual");
    }
    return () => cancelAnimationFrame(frame);
  }, []);

  const filtered = useMemo(() => records.filter((manual) => {
    const matchesQuery = manual.eaName.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = status === "ALL" || manual.status === status;
    return matchesQuery && matchesStatus;
  }), [query, records, status]);

  const displayed = compact ? filtered.slice(0, 4) : filtered;

  return (
    <div className="table-region">
      {!compact && (
        <div className="filter-bar">
          <label className="search-field">
            <Search aria-hidden="true" size={17} />
            <span className="sr-only">Cari manual</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama EA…" />
          </label>
          <label>
            <span className="sr-only">Filter status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="ALL">Semua status</option>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <span className="filter-count">{displayed.length} manual</span>
        </div>
      )}
      {displayed.length ? (
        <div className="responsive-table-wrap">
          <table className="manual-table">
            <thead><tr><th>EA</th><th>Platform</th><th>Versi EA</th><th>Versi manual</th><th>Kelengkapan</th><th>Checklist</th><th>Status</th><th>Diperbarui</th><th>Aksi</th></tr></thead>
            <tbody>{displayed.map((manual) => <ManualRow key={manual.id} manual={manual} />)}</tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <Search aria-hidden="true" size={26} />
          <h2>Manual tidak ditemukan</h2>
          <p>Coba ubah kata kunci atau filter status.</p>
          <button className="secondary-button" onClick={() => { setQuery(""); setStatus("ALL"); }}>Reset filter</button>
        </div>
      )}
    </div>
  );
}
