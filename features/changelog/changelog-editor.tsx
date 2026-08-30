"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, Info, Plus, Save, Trash2 } from "lucide-react";
import {
  createChangelogEntry,
  updateChangelogEntry,
  deleteChangelogEntry,
  reorderChangelogEntries,
} from "./actions";
import { CHANGELOG_TYPES, CHANGELOG_TYPE_LABEL, type ChangelogType } from "./schema";
import { pasal8ReminderApplies, PASAL_8_REMINDER_TEXT } from "@/lib/changelog/reminder";

export type ChangelogEntryView = {
  id: string;
  position: number;
  entryType: ChangelogType;
  body: string;
  sourceEaVersionId: string | null;
  isFeatureChange: boolean;
  openPositionImpact: string | null;
};

export type ChangelogEditorProps = {
  manualVersionId: string;
  canEdit: boolean;
  entries: ChangelogEntryView[];
  pbkScope: "IN_SCOPE" | "OUT_OF_SCOPE";
  sourceOptions: { id: string; label: string }[];
  linkedEaVersionId: string;
  onChanged?: () => void;
};

type Row = ChangelogEntryView & { _new?: boolean };

let tmpSeq = 0;
const newRow = (linked: string, fallback: string): Row => ({
  id: `new-${++tmpSeq}`,
  position: 9999,
  entryType: "ADDED",
  body: "",
  sourceEaVersionId: linked || fallback, // mandatory since 20260901001700
  isFeatureChange: false,
  openPositionImpact: null,
  _new: true,
});

export function ChangelogEditor(props: ChangelogEditorProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Row[]>(props.entries);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [error, setError] = useState<{ id: string; msg: string } | null>(null);
  const [syncedKey, setSyncedKey] = useState(() => JSON.stringify(props.entries));

  // Adopt fresh server entries after a mutation's router.refresh() — a render-phase reset (see
  // react.dev "You Might Not Need an Effect"), skipped while the user has unsaved local edits.
  const incomingKey = JSON.stringify(props.entries);
  if (incomingKey !== syncedKey && dirty.size === 0 && !rows.some((r) => r._new)) {
    setSyncedKey(incomingKey);
    setRows(props.entries);
  }

  const markDirty = (id: string) => setDirty((d) => new Set(d).add(id));
  const patch = (id: string, p: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
    markDirty(id);
    setError(null);
  };

  const sourceLabel = (id: string | null) =>
    id ? props.sourceOptions.find((o) => o.id === id)?.label ?? "versi lain" : "— tidak ada —";

  const reminderApplies = useMemo(
    () => pasal8ReminderApplies(props.pbkScope, rows),
    [props.pbkScope, rows],
  );
  const neutralFeatureNote =
    props.pbkScope === "OUT_OF_SCOPE" && rows.some((r) => r.isFeatureChange);

  const run = (fn: () => Promise<{ ok: boolean; message?: string; issues?: { message: string }[] }>, id: string) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setDirty((d) => {
          const n = new Set(d);
          n.delete(id);
          return n;
        });
        props.onChanged?.();
        router.refresh();
      } else {
        const detail = res.issues?.map((i) => i.message).join(" · ");
        setError({ id, msg: detail ? `${res.message} ${detail}` : res.message ?? "Gagal." });
      }
    });
  };

  const save = (r: Row) => {
    const entry = {
      entryType: r.entryType,
      body: r.body.trim(),
      sourceEaVersionId: r.sourceEaVersionId,
      isFeatureChange: r.isFeatureChange,
      openPositionImpact: r.entryType === "BREAKING" ? (r.openPositionImpact ?? "").trim() : "",
    };
    if (entry.body.length === 0) {
      setError({ id: r.id, msg: "Uraikan perubahannya." });
      return;
    }
    if (!entry.sourceEaVersionId) {
      setError({ id: r.id, msg: "Pilih versi EA sumber." });
      return;
    }
    if (r.entryType === "BREAKING" && entry.openPositionImpact.length === 0) {
      setError({ id: r.id, msg: "Entri BREAKING wajib menjelaskan dampak bagi pengguna dengan posisi terbuka." });
      return;
    }
    if (r._new) {
      setError(null);
      start(async () => {
        const res = await createChangelogEntry({ manualVersionId: props.manualVersionId, entry });
        if (res.ok) {
          // adopt the real id + drop the draft flag so a second Simpan updates (not re-creates)
          setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, id: res.data.id, _new: undefined } : x)));
          setDirty((d) => {
            const n = new Set(d);
            n.delete(r.id);
            return n;
          });
          props.onChanged?.();
          router.refresh();
        } else {
          const detail = res.issues?.map((i) => i.message).join(" · ");
          setError({ id: r.id, msg: detail ? `${res.message} ${detail}` : res.message ?? "Gagal." });
        }
      });
    } else {
      run(() => updateChangelogEntry({ entryId: r.id, entry }), r.id);
    }
  };

  const remove = (r: Row) => {
    if (r._new) {
      setRows((rs) => rs.filter((x) => x.id !== r.id));
      return;
    }
    run(() => deleteChangelogEntry({ entryId: r.id }), r.id);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const persisted = rows.filter((r) => !r._new);
    const j = idx + dir;
    if (j < 0 || j >= persisted.length) return;
    const orderedIds = persisted.map((r) => r.id);
    [orderedIds[idx], orderedIds[j]] = [orderedIds[j], orderedIds[idx]];
    run(
      () => reorderChangelogEntries({ manualVersionId: props.manualVersionId, orderedIds }),
      orderedIds[j],
    );
  };

  // ---- read-only (review states) ----
  if (!props.canEdit) {
    return (
      <section className="cl-editor" aria-label="Catatan perubahan terstruktur">
        <h3 className="cl-head">Catatan perubahan terstruktur</h3>
        {rows.length === 0 ? (
          <p className="cl-empty">Belum ada entri changelog terstruktur.</p>
        ) : (
          <ol className="cl-list">
            {rows.map((r) => (
              <li className="cl-card" key={r.id}>
                <div className="cl-card-top">
                  <span className="cl-chip" data-type={r.entryType}>{CHANGELOG_TYPE_LABEL[r.entryType]}</span>
                  {r.isFeatureChange && <span className="cl-flag">Perubahan fitur/perilaku</span>}
                </div>
                <p className="cl-body">{r.body}</p>
                <p className="cl-meta">Versi EA sumber: {sourceLabel(r.sourceEaVersionId)}</p>
                {r.entryType === "BREAKING" && (
                  <p className="cl-impact"><strong>Dampak posisi terbuka:</strong> {r.openPositionImpact}</p>
                )}
              </li>
            ))}
          </ol>
        )}
        {reminderApplies && <Pasal8Callout />}
        {neutralFeatureNote && !reminderApplies && <NeutralNote />}
      </section>
    );
  }

  // ---- editable (DRAFT) ----
  const persistedCount = rows.filter((r) => !r._new).length;
  return (
    <section className="cl-editor" aria-label="Editor catatan perubahan">
      <div className="cl-head-row">
        <h3 className="cl-head">Catatan perubahan terstruktur</h3>
        <button
          type="button"
          className="secondary-button"
          disabled={pending}
          onClick={() =>
            setRows((rs) => [
              ...rs,
              newRow(props.linkedEaVersionId, props.sourceOptions[0]?.id ?? props.linkedEaVersionId),
            ])
          }
        >
          <Plus aria-hidden="true" size={15} /> Tambah entri
        </button>
      </div>

      {rows.length === 0 && <p className="cl-empty">Belum ada entri. Tambahkan minimal satu entri untuk versi EA ini.</p>}

      <ol className="cl-list">
        {rows.map((r, i) => {
          const persistedIdx = rows.slice(0, i).filter((x) => !x._new).length;
          return (
            <li className="cl-card" key={r.id} data-new={r._new}>
              <div className="cl-fields">
                <label className="cl-field">
                  <span>Jenis</span>
                  <select value={r.entryType} onChange={(e) => patch(r.id, { entryType: e.target.value as ChangelogType })}>
                    {CHANGELOG_TYPES.map((t) => (
                      <option key={t} value={t}>{CHANGELOG_TYPE_LABEL[t]}</option>
                    ))}
                  </select>
                </label>
                <label className="cl-field">
                  <span>Versi EA sumber (wajib)</span>
                  <select
                    value={r.sourceEaVersionId ?? ""}
                    onChange={(e) => patch(r.id, { sourceEaVersionId: e.target.value })}
                  >
                    {!r.sourceEaVersionId && <option value="" disabled>— pilih versi —</option>}
                    {props.sourceOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="cl-field">
                <span>Uraian perubahan</span>
                <textarea
                  rows={2}
                  maxLength={4000}
                  value={r.body}
                  placeholder="Jelaskan perubahan fitur/perilaku EA pada versi ini."
                  onChange={(e) => patch(r.id, { body: e.target.value })}
                />
              </label>

              <label className="cl-check">
                <input
                  type="checkbox"
                  checked={r.isFeatureChange}
                  onChange={(e) => patch(r.id, { isFeatureChange: e.target.checked })}
                />
                Perubahan fitur / perilaku EA (dapat memicu pengingat Pasal 8)
              </label>

              {r.entryType === "BREAKING" && (
                <label className="cl-field">
                  <span>Dampak bagi pengguna dengan posisi terbuka (wajib)</span>
                  <textarea
                    rows={2}
                    maxLength={4000}
                    value={r.openPositionImpact ?? ""}
                    placeholder="Contoh: posisi terbuka harus ditutup manual sebelum memperbarui EA."
                    onChange={(e) => patch(r.id, { openPositionImpact: e.target.value })}
                  />
                </label>
              )}

              <div className="cl-card-foot">
                <div className="cl-reorder">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Naikkan entri"
                    disabled={pending || r._new || persistedIdx === 0}
                    onClick={() => move(persistedIdx, -1)}
                  >
                    <ArrowUp aria-hidden="true" size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Turunkan entri"
                    disabled={pending || r._new || persistedIdx >= persistedCount - 1}
                    onClick={() => move(persistedIdx, 1)}
                  >
                    <ArrowDown aria-hidden="true" size={15} />
                  </button>
                </div>
                <div className="cl-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={pending || (!dirty.has(r.id) && !r._new)}
                    onClick={() => save(r)}
                  >
                    <Save aria-hidden="true" size={14} /> Simpan
                  </button>
                  <button type="button" className="secondary-button" disabled={pending} onClick={() => remove(r)}>
                    <Trash2 aria-hidden="true" size={14} /> Hapus
                  </button>
                </div>
              </div>
              {error?.id === r.id && (
                <p className="cl-error" role="alert">
                  <AlertTriangle aria-hidden="true" size={13} /> {error.msg}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {reminderApplies && <Pasal8Callout />}
      {neutralFeatureNote && !reminderApplies && <NeutralNote />}
    </section>
  );
}

function Pasal8Callout() {
  return (
    <aside className="manual-callout warning cl-reminder" role="note">
      <AlertTriangle aria-hidden="true" />
      <div>
        <p className="cl-reminder-title">Pengingat operasional (Pasal 8 Perba 12/2022)</p>
        <p>{PASAL_8_REMINDER_TEXT}</p>
      </div>
    </aside>
  );
}

function NeutralNote() {
  return (
    <aside className="manual-callout info cl-reminder" role="note">
      <Info aria-hidden="true" />
      <div>
        <p>
          Ada entri yang ditandai sebagai perubahan fitur/perilaku. EA ini berada di luar lingkup
          PBK Indonesia, sehingga kewajiban Pasal 8 tidak ditampilkan sebagai persyaratan hukum.
        </p>
      </div>
    </aside>
  );
}
