"use client";

import { useId, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, GripVertical, Info, Minus, Plus, Trash2 } from "lucide-react";
import { MT_TIMEFRAMES, MT_TIMEFRAME_LABELS, type MtTimeframe } from "@/lib/domain/timeframes";
import { SYMBOL_PATTERN, normalizeSymbol, setupDedupeKey } from "@/lib/domain/symbol";
import { BROKER_MIN_LOT_NOTE_ID } from "@/lib/domain/setups";
import { replaceSupportedSetups } from "./actions";

export type SetupRow = {
  symbol: string;
  timeframe: MtTimeframe;
  presetRef: string;
  testedMinimumLot: string; // kept as string for the input; parsed on submit
  notes: string;
  isSupported: boolean;
};

function blankRow(): SetupRow {
  return { symbol: "", timeframe: "M15", presetRef: "", testedMinimumLot: "", notes: "", isSupported: true };
}

export function SupportedConfigurationEditor({
  eaVersionId,
  initial,
  readOnly = false,
}: {
  eaVersionId: string;
  initial: SetupRow[];
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<SetupRow[]>(initial.length ? initial : [blankRow()]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const groupId = useId();

  function patch(index: number, next: Partial<SetupRow>) {
    setSaved(false);
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...next } : r)));
  }
  function addRow() {
    setSaved(false);
    setRows((prev) => [...prev, blankRow()]);
  }
  function removeRow(index: number) {
    setSaved(false);
    setRows((prev) => (prev.length === 1 ? [blankRow()] : prev.filter((_, i) => i !== index)));
  }
  function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= rows.length) return;
    setSaved(false);
    setRows((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    });
  }
  function move(index: number, dir: -1 | 1) {
    reorder(index, index + dir); // keyboard / button reorder
  }

  function validate(): boolean {
    const next: Record<number, string> = {};
    const seen = new Map<string, number>();
    rows.forEach((row, index) => {
      if (!SYMBOL_PATTERN.test(row.symbol.trim())) {
        next[index] = "Simbol tidak valid (contoh: XAUUSD, XAUUSD.m, EURUSD.pro).";
        return;
      }
      if (!(MT_TIMEFRAMES as readonly string[]).includes(row.timeframe)) {
        next[index] = "Pilih timeframe MetaTrader yang valid.";
        return;
      }
      if (row.testedMinimumLot.trim() !== "") {
        const n = Number(row.testedMinimumLot);
        if (!Number.isFinite(n) || n < 0) {
          next[index] = "Tested Minimum Lot tidak boleh negatif.";
          return;
        }
      }
      const key = setupDedupeKey(row.symbol, row.timeframe);
      const first = seen.get(key);
      if (first !== undefined) {
        next[index] = `Konfigurasi ${normalizeSymbol(row.symbol)} / ${row.timeframe} sudah ada (baris ${first + 1}).`;
      } else {
        seen.set(key, index);
      }
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function onSave() {
    setFormError(null);
    if (!validate()) return;
    startTransition(async () => {
      const result = await replaceSupportedSetups({
        eaVersionId,
        setups: rows.map((r) => ({
          symbol: normalizeSymbol(r.symbol),
          timeframe: r.timeframe,
          presetRef: r.presetRef.trim() || null,
          testedMinimumLot: r.testedMinimumLot.trim() === "" ? null : Number(r.testedMinimumLot),
          notes: r.notes.trim() || null,
          isSupported: r.isSupported,
          position: 0,
        })),
      });
      if (result.ok) {
        setSaved(true);
        return;
      }
      if (result.code === "VALIDATION" && result.issues?.length) {
        const mapped: Record<number, string> = {};
        for (const issue of result.issues) {
          const m = issue.path.match(/(\d+)/);
          if (m) mapped[Number(m[1])] = issue.message;
        }
        setErrors(mapped);
      }
      setFormError(result.message);
    });
  }

  // Read-only presentation for reviewer roles — a clean facts view, never a disabled form.
  if (readOnly) {
    const filled = rows.filter((r) => r.symbol.trim() !== "");
    return (
      <div className="setup-editor" aria-describedby={groupId}>
        {filled.length === 0 ? (
          <p className="param-empty">Belum ada konfigurasi yang didukung untuk versi EA ini.</p>
        ) : (
          <ul className="setup-readonly">
            {filled.map((row, index) => (
              <li key={index} className="setup-readonly-row">
                <div className="setup-readonly-head">
                  <span className="mono setup-readonly-symbol">{normalizeSymbol(row.symbol)}</span>
                  <span className="platform-badge">{row.timeframe}</span>
                  <span className="setup-readonly-supported" data-on={row.isSupported}>
                    {row.isSupported ? <Check aria-hidden="true" size={13} /> : <Minus aria-hidden="true" size={13} />}
                    {row.isSupported ? "Didukung" : "Tidak didukung"}
                  </span>
                </div>
                <dl className="setup-readonly-meta">
                  <div>
                    <dt>Preset</dt>
                    <dd>{row.presetRef.trim() || "—"}</dd>
                  </div>
                  <div>
                    <dt>Tested Minimum Lot</dt>
                    <dd>{row.testedMinimumLot.trim() || "—"}</dd>
                  </div>
                  <div className="setup-readonly-notes">
                    <dt>Notes</dt>
                    <dd>{row.notes.trim() || "—"}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
        <p className="setup-note" id={groupId}>
          <Info aria-hidden="true" size={15} /> {BROKER_MIN_LOT_NOTE_ID}
        </p>
      </div>
    );
  }

  return (
    <div className="setup-editor" aria-describedby={groupId}>
      <ol className="setup-rows">
        {rows.map((row, index) => (
          <li
            key={index}
            className="setup-row"
            data-error={Boolean(errors[index])}
            data-dragover={dragIndex === index}
            onDragOver={(e) => {
              if (readOnly || dragFrom.current === null) return;
              e.preventDefault();
              setDragIndex(index);
            }}
            onDrop={(e) => {
              if (readOnly || dragFrom.current === null) return;
              e.preventDefault();
              reorder(dragFrom.current, index);
              dragFrom.current = null;
              setDragIndex(null);
            }}
          >
            {!readOnly && (
              <button
                type="button"
                className="setup-drag-handle"
                aria-label={`Seret untuk mengurutkan baris ${index + 1}`}
                draggable
                onDragStart={(e) => {
                  dragFrom.current = index;
                  setDragIndex(index);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  dragFrom.current = null;
                  setDragIndex(null);
                }}
              >
                <GripVertical aria-hidden="true" size={15} />
              </button>
            )}
            <div className="setup-grid">
              <label className="setup-field">
                <span>Symbol</span>
                <input
                  value={row.symbol}
                  disabled={readOnly}
                  onChange={(e) => patch(index, { symbol: e.target.value })}
                  onBlur={(e) => patch(index, { symbol: normalizeSymbol(e.target.value) })}
                  placeholder="XAUUSD / XAUUSD.m / EURUSD.pro"
                  aria-invalid={Boolean(errors[index])}
                  className="mono"
                />
              </label>
              <label className="setup-field">
                <span>Timeframe</span>
                <select
                  value={row.timeframe}
                  disabled={readOnly}
                  onChange={(e) => patch(index, { timeframe: e.target.value as MtTimeframe })}
                >
                  {MT_TIMEFRAMES.map((tf) => (
                    <option key={tf} value={tf}>
                      {MT_TIMEFRAME_LABELS[tf]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="setup-field">
                <span>Preset</span>
                <input
                  value={row.presetRef}
                  disabled={readOnly}
                  onChange={(e) => patch(index, { presetRef: e.target.value })}
                  placeholder="opsional"
                />
              </label>
              <label className="setup-field">
                <span>Tested Minimum Lot</span>
                <input
                  value={row.testedMinimumLot}
                  disabled={readOnly}
                  inputMode="decimal"
                  onChange={(e) => patch(index, { testedMinimumLot: e.target.value })}
                  placeholder="opsional"
                />
                <small>data uji developer — bukan minimum broker</small>
              </label>
              <label className="setup-field setup-field-wide">
                <span>Notes</span>
                <input
                  value={row.notes}
                  disabled={readOnly}
                  onChange={(e) => patch(index, { notes: e.target.value })}
                  placeholder="opsional"
                />
              </label>
              <label className="setup-checkbox">
                <input
                  type="checkbox"
                  checked={row.isSupported}
                  disabled={readOnly}
                  onChange={(e) => patch(index, { isSupported: e.target.checked })}
                />
                <span>Supported</span>
              </label>
            </div>
            {!readOnly && (
              <div className="setup-row-actions">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Naikkan baris ${index + 1}`}>
                  <ArrowUp aria-hidden="true" size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === rows.length - 1}
                  aria-label={`Turunkan baris ${index + 1}`}
                >
                  <ArrowDown aria-hidden="true" size={15} />
                </button>
                <button type="button" onClick={() => removeRow(index)} aria-label={`Hapus baris ${index + 1}`}>
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </div>
            )}
            {errors[index] && (
              <p className="field-error" role="alert">
                {errors[index]}
              </p>
            )}
          </li>
        ))}
      </ol>

      {!readOnly && (
        <button type="button" className="secondary-button" onClick={addRow}>
          <Plus aria-hidden="true" size={16} /> Tambah konfigurasi
        </button>
      )}

      <p className="setup-note" id={groupId}>
        <Info aria-hidden="true" size={15} /> {BROKER_MIN_LOT_NOTE_ID}
      </p>

      {formError && (
        <p className="field-error" role="alert">
          {formError}
        </p>
      )}

      {!readOnly && (
        <div className="setup-save-row">
          <button type="button" className="primary-button" onClick={onSave} disabled={pending}>
            {pending ? "Menyimpan…" : "Simpan konfigurasi"}
          </button>
          {saved && (
            <span className="save-state" role="status">
              Tersimpan
            </span>
          )}
        </div>
      )}
    </div>
  );
}
