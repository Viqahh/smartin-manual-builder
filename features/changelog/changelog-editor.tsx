"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, Info, Pencil, Plus, Save, Trash2, X } from "lucide-react";
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
  // UAT-21 (root cause): this editor previously called `router.refresh()` after every mutation.
  // That refetches the ENTIRE `force-dynamic` /manuals/[id]/edit route (≈9 Supabase round-trips +
  // full Phase-5 evaluation) and re-reconciles it into the live client tree — which regenerates
  // any hydration-divergent subtree, jumps the scroll, and re-throws React #418, so the editor
  // *looked* stuck and the user reached for a refresh even though the save had persisted.
  //
  // Fix: NO route refresh. Each mutation is applied to local `rows` on success (create adopts the
  // real id + position; delete removes the row; reorder re-sequences), so the editor is its own
  // source of truth for the session. Validation still re-evaluates via `props.onChanged`
  // (ValidationPanel runs its own targeted action, not a route refetch); the Preview route
  // re-reads on navigation.
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[]>(props.entries);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set()); // transient "✓ Tersimpan" per row
  // UAT-33: which entries are currently EXPANDED for editing. A saved entry renders as a compact
  // content card; only entries in this set (and brand-new drafts) show the editable fields.
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [error, setError] = useState<{ id: string; msg: string } | null>(null);
  // last server-confirmed values per persisted row — for "Batal" to revert an in-progress edit.
  const baseline = useRef<Map<string, ChangelogEntryView>>(
    new Map(props.entries.map((e) => [e.id, { ...e }])),
  );

  // Safety-net sync (post-commit effect, NOT render-phase setState): adopt a genuinely changed
  // `props.entries` — e.g. the manual left DRAFT and this editor is about to render read-only —
  // but never while the user has unsaved edits, a local draft row, or a save in flight.
  const savedKey = useRef(JSON.stringify(props.entries));
  useEffect(() => {
    const incoming = JSON.stringify(props.entries);
    if (
      incoming !== savedKey.current &&
      !busy &&
      dirty.size === 0 &&
      editing.size === 0 &&
      !rows.some((r) => r._new)
    ) {
      savedKey.current = incoming;
      setRows(props.entries);
      baseline.current = new Map(props.entries.map((e) => [e.id, { ...e }]));
    }
  }, [props.entries, busy, dirty, editing, rows]);

  // clear the transient saved flags a couple of seconds after they appear
  useEffect(() => {
    if (saved.size === 0) return;
    const t = setTimeout(() => setSaved(new Set()), 2200);
    return () => clearTimeout(t);
  }, [saved]);

  const markDirty = (id: string) => {
    setDirty((d) => new Set(d).add(id));
    setSaved((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  };
  const markSaved = (id: string) => {
    setDirty((d) => {
      const n = new Set(d);
      n.delete(id);
      return n;
    });
    setSaved((s) => new Set(s).add(id));
  };
  const patch = (id: string, p: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
    markDirty(id);
    setError(null);
  };

  const dropFromSet =
    (setter: Dispatch<SetStateAction<Set<string>>>) => (id: string) =>
      setter((s) => {
        if (!s.has(id)) return s;
        const n = new Set(s);
        n.delete(id);
        return n;
      });
  const stopEditing = dropFromSet(setEditing);

  const beginEdit = (id: string) => {
    setError(null);
    setEditing((s) => new Set(s).add(id));
  };

  /** "Batal": a new draft is discarded; an existing entry reverts to its last-saved values. */
  const cancelEdit = (r: Row) => {
    setError(null);
    dropFromSet(setDirty)(r.id);
    if (r._new) {
      setRows((rs) => rs.filter((x) => x.id !== r.id));
      stopEditing(r.id);
      return;
    }
    const base = baseline.current.get(r.id);
    if (base) setRows((rs) => rs.map((x) => (x.id === r.id ? { ...base } : x)));
    stopEditing(r.id);
  };

  /** record the just-saved values as the new revert point and collapse the card. */
  const settleEntry = (id: string, values: ChangelogEntryView) => {
    baseline.current.set(id, { ...values });
    stopEditing(id);
    markSaved(id);
  };

  const sourceLabel = (id: string | null) =>
    id ? props.sourceOptions.find((o) => o.id === id)?.label ?? "versi lain" : "— tidak ada —";

  const reminderApplies = useMemo(
    () => pasal8ReminderApplies(props.pbkScope, rows),
    [props.pbkScope, rows],
  );
  const neutralFeatureNote =
    props.pbkScope === "OUT_OF_SCOPE" && rows.some((r) => r.isFeatureChange);

  /**
   * Run one changelog mutation. On success: apply the local reconciliation (`onOk`), mark the row
   * saved, and let the parent re-evaluate validation — WITHOUT a route refresh. On failure: surface
   * the message against the row. `busy` gates the controls only for the ~action duration and is
   * always released.
   */
  const run = (
    fn: () => Promise<{ ok: boolean; message?: string; issues?: { message: string }[] }>,
    id: string,
    onOk?: () => void,
  ) => {
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        const res = await fn();
        if (res.ok) {
          onOk?.();
          markSaved(id);
          props.onChanged?.();
        } else {
          const detail = res.issues?.map((i) => i.message).join(" · ");
          setError({ id, msg: detail ? `${res.message} ${detail}` : res.message ?? "Gagal." });
        }
      } finally {
        setBusy(false);
      }
    })();
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
      setBusy(true);
      void (async () => {
        try {
          const res = await createChangelogEntry({ manualVersionId: props.manualVersionId, entry });
          if (res.ok) {
            const realId = res.data.id;
            const position = res.data.position ?? r.position;
            // adopt the real id + server position, drop the draft flag (a 2nd Simpan now updates,
            // never re-creates — no duplicate row) — all locally, no route refresh.
            setRows((rs) =>
              rs.map((x) => (x.id === r.id ? { ...x, id: realId, position, _new: undefined } : x)),
            );
            stopEditing(r.id); // collapse the draft's tmp id …
            settleEntry(realId, {
              id: realId,
              position,
              entryType: entry.entryType,
              body: entry.body,
              sourceEaVersionId: entry.sourceEaVersionId,
              isFeatureChange: entry.isFeatureChange,
              openPositionImpact: entry.openPositionImpact || null,
            }); // … and collapse under the real id
            props.onChanged?.();
          } else {
            const detail = res.issues?.map((i) => i.message).join(" · ");
            setError({ id: r.id, msg: detail ? `${res.message} ${detail}` : res.message ?? "Gagal." });
          }
        } finally {
          setBusy(false);
        }
      })();
    } else {
      run(() => updateChangelogEntry({ entryId: r.id, entry }), r.id, () =>
        settleEntry(r.id, {
          id: r.id,
          position: r.position,
          entryType: entry.entryType,
          body: entry.body,
          sourceEaVersionId: entry.sourceEaVersionId,
          isFeatureChange: entry.isFeatureChange,
          openPositionImpact: entry.openPositionImpact || null,
        }),
      );
    }
  };

  const remove = (r: Row) => {
    if (r._new) {
      setRows((rs) => rs.filter((x) => x.id !== r.id));
      return;
    }
    run(() => deleteChangelogEntry({ entryId: r.id }), r.id, () =>
      setRows((rs) => rs.filter((x) => x.id !== r.id)),
    );
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
      () =>
        setRows((rs) => {
          const byId = new Map(rs.map((x) => [x.id, x]));
          const reordered = orderedIds.map((id, i) => ({ ...(byId.get(id) as Row), position: i }));
          const news = rs.filter((x) => x._new);
          return [...reordered, ...news];
        }),
    );
  };

  // ---- read-only (review states) ----
  // In the live builder this branch is not reached: for non-DRAFT the SectionEditor renders the
  // shared <SectionContent>, which already shows vm.changelog (UAT-22). Kept as a defensive inline
  // (non-panel) view for any other caller.
  if (!props.canEdit) {
    return (
      <div className="cl-canvas" aria-label="Catatan perubahan terstruktur">
        <p className="cl-canvas-label">Catatan perubahan terstruktur</p>
        {rows.length === 0 ? (
          <p className="cl-empty">Belum ada entri changelog terstruktur.</p>
        ) : (
          <ol className="cl-doc-list">
            {rows.map((r) => (
              <li className="cl-doc-card" key={r.id}>
                <div className="cl-doc-collapsed">
                  <div className="cl-doc-head">
                    <span className="cl-doc-version">{sourceLabel(r.sourceEaVersionId)}</span>
                    <span className="cl-doc-sep" aria-hidden="true">·</span>
                    <span className="cl-chip" data-type={r.entryType}>{CHANGELOG_TYPE_LABEL[r.entryType]}</span>
                    {r.isFeatureChange && <span className="cl-flag">Perubahan fitur/perilaku</span>}
                  </div>
                  <p className="cl-body">{r.body}</p>
                  {r.entryType === "BREAKING" && r.openPositionImpact && (
                    <p className="cl-impact"><strong>Dampak posisi terbuka:</strong> {r.openPositionImpact}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        {reminderApplies && <Pasal8Callout />}
        {neutralFeatureNote && !reminderApplies && <NeutralNote />}
      </div>
    );
  }

  // ---- editable (DRAFT) — authored INLINE inside the BAB 14 document canvas (UAT-33) ----
  const persistedCount = rows.filter((r) => !r._new).length;
  const addEntry = () => {
    const nr = newRow(props.linkedEaVersionId, props.sourceOptions[0]?.id ?? props.linkedEaVersionId);
    setRows((rs) => [...rs, nr]);
    setEditing((s) => new Set(s).add(nr.id));
  };

  return (
    <div className="cl-canvas" aria-label="Catatan perubahan terstruktur">
      <p className="cl-canvas-label">Catatan perubahan terstruktur</p>

      {rows.length === 0 && (
        <p className="cl-empty">Belum ada entri. Tambahkan minimal satu entri untuk versi EA ini.</p>
      )}

      <ol className="cl-doc-list">
        {rows.map((r, i) => {
          const persistedIdx = rows.slice(0, i).filter((x) => !x._new).length;
          const isEditing = Boolean(r._new) || editing.has(r.id);
          return (
            <li className="cl-doc-card" key={r.id} data-editing={isEditing} data-new={r._new}>
              {isEditing ? (
                <div className="cl-doc-edit">
                  <div className="cl-fields">
                    <label className="cl-field">
                      <span>Jenis</span>
                      <select
                        value={r.entryType}
                        onChange={(e) => patch(r.id, { entryType: e.target.value as ChangelogType })}
                      >
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

                  <div className="cl-actions">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy || (!dirty.has(r.id) && !r._new)}
                      onClick={() => save(r)}
                    >
                      <Save aria-hidden="true" size={14} /> {busy ? "Menyimpan…" : "Simpan"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => cancelEdit(r)}
                    >
                      <X aria-hidden="true" size={14} /> Batal
                    </button>
                  </div>
                </div>
              ) : (
                <div className="cl-doc-collapsed">
                  <div className="cl-doc-head">
                    <span className="cl-doc-version">{sourceLabel(r.sourceEaVersionId)}</span>
                    <span className="cl-doc-sep" aria-hidden="true">·</span>
                    <span className="cl-chip" data-type={r.entryType}>
                      {CHANGELOG_TYPE_LABEL[r.entryType]}
                    </span>
                    {r.isFeatureChange && <span className="cl-flag">Perubahan fitur/perilaku</span>}
                    {saved.has(r.id) && (
                      <span className="cl-saved" role="status">
                        <Check aria-hidden="true" size={13} /> Tersimpan
                      </span>
                    )}
                  </div>
                  <p className="cl-body">{r.body}</p>
                  {r.entryType === "BREAKING" && r.openPositionImpact && (
                    <p className="cl-impact">
                      <strong>Dampak posisi terbuka:</strong> {r.openPositionImpact}
                    </p>
                  )}
                  <div className="cl-doc-foot">
                    <div className="cl-reorder">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Naikkan entri"
                        disabled={busy || persistedIdx === 0}
                        onClick={() => move(persistedIdx, -1)}
                      >
                        <ArrowUp aria-hidden="true" size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Turunkan entri"
                        disabled={busy || persistedIdx >= persistedCount - 1}
                        onClick={() => move(persistedIdx, 1)}
                      >
                        <ArrowDown aria-hidden="true" size={15} />
                      </button>
                    </div>
                    <div className="cl-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => beginEdit(r.id)}
                      >
                        <Pencil aria-hidden="true" size={14} /> Edit
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => remove(r)}
                      >
                        <Trash2 aria-hidden="true" size={14} /> Hapus
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {error?.id === r.id && (
                <p className="cl-error" role="alert">
                  <AlertTriangle aria-hidden="true" size={13} /> {error.msg}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <button type="button" className="cl-add-entry secondary-button" disabled={busy} onClick={addEntry}>
        <Plus aria-hidden="true" size={15} /> Tambah entri
      </button>

      {reminderApplies && <Pasal8Callout />}
      {neutralFeatureNote && !reminderApplies && <NeutralNote />}
    </div>
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
