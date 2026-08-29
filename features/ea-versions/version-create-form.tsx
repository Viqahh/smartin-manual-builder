"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Info, Plus, Trash2 } from "lucide-react";
import { MT_TIMEFRAMES, MT_TIMEFRAME_LABELS, type MtTimeframe } from "@/lib/domain/timeframes";
import { SYMBOL_PATTERN, normalizeSymbol, setupDedupeKey } from "@/lib/domain/symbol";
import { BROKER_MIN_LOT_NOTE_ID } from "@/lib/domain/setups";
import { isSemver } from "@/lib/domain/semver";
import { createEaVersion } from "./actions";

type Row = { symbol: string; timeframe: MtTimeframe; presetRef: string; testedMinimumLot: string; notes: string; isSupported: boolean };
const blank = (): Row => ({ symbol: "", timeframe: "M15", presetRef: "", testedMinimumLot: "", notes: "", isSupported: true });

export function VersionCreateForm({ eaProductId }: { eaProductId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState("1.0.0");
  const [platform, setPlatform] = useState<"MT4" | "MT5">("MT5");
  const [releaseDate, setReleaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountType, setAccountType] = useState("Standard / ECN");
  const [testingDeposit, setTestingDeposit] = useState("USD 1.000 (demo)");
  const [brokerRequirements, setBrokerRequirements] = useState("");
  const [pbkScope, setPbkScope] = useState<"IN_SCOPE" | "OUT_OF_SCOPE">("IN_SCOPE");
  const [dangerMode, setDangerMode] = useState(false);
  const [gui, setGui] = useState(false);
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function patch(i: number, next: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...next } : r)));
  }
  function move(i: number, dir: -1 | 1) {
    const t = i + dir;
    if (t < 0 || t >= rows.length) return;
    setRows((prev) => {
      const c = [...prev];
      [c[i], c[t]] = [c[t], c[i]];
      return c;
    });
  }

  function validate(): boolean {
    const errs: Record<number, string> = {};
    if (!isSemver(version)) {
      setFormError("Gunakan format semver, contoh 1.0.0.");
      return false;
    }
    const seen = new Map<string, number>();
    rows.forEach((r, i) => {
      if (!SYMBOL_PATTERN.test(r.symbol.trim())) {
        errs[i] = "Simbol tidak valid (contoh: XAUUSD, XAUUSD.m, EURUSD.pro).";
        return;
      }
      if (r.testedMinimumLot.trim() && Number(r.testedMinimumLot) < 0) {
        errs[i] = "Tested Minimum Lot tidak boleh negatif.";
        return;
      }
      const key = setupDedupeKey(r.symbol, r.timeframe);
      const first = seen.get(key);
      if (first !== undefined) errs[i] = `Konfigurasi ${normalizeSymbol(r.symbol)} / ${r.timeframe} sudah ada (baris ${first + 1}).`;
      else seen.set(key, i);
    });
    setRowErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function submit() {
    setFormError(null);
    if (!validate()) return;
    start(async () => {
      const res = await createEaVersion({
        eaProductId,
        version,
        platform,
        releaseDate,
        requirements: {
          accountType,
          testingDeposit,
          brokerRequirements,
          vps: "Disarankan",
          dll: false,
          webRequest: false,
          customIndicators: [],
          volumeConstraints: "",
          pbkScope,
          dangerMode,
          gui,
          verifiedFeatures: [],
        },
        support: { email: "", phone: "", whatsapp: "", hours: "" },
        setups: rows.map((r, index) => ({
          symbol: normalizeSymbol(r.symbol),
          timeframe: r.timeframe,
          presetRef: r.presetRef.trim() || null,
          testedMinimumLot: r.testedMinimumLot.trim() === "" ? null : Number(r.testedMinimumLot),
          notes: r.notes.trim() || null,
          isSupported: r.isSupported,
          position: index,
        })),
        copyParametersFromVersionId: null,
      });
      if (res.ok) {
        setOpen(false);
        setRows([blank()]);
        router.refresh();
      } else {
        setFormError(res.issues?.[0]?.message ?? res.message);
      }
    });
  }

  if (!open) {
    return (
      <button className="secondary-button" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" size={16} /> Buat versi EA
      </button>
    );
  }

  return (
    <div className="card inline-form">
      <h2>Versi EA baru</h2>
      {formError && (
        <p className="field-error" role="alert">
          {formError}
        </p>
      )}
      <div className="form-grid">
        <label className="form-field">
          <span>Versi EA * (semver)</span>
          <input className="mono" value={version} onChange={(e) => setVersion(e.target.value)} />
        </label>
        <label className="form-field">
          <span>Platform *</span>
          <select value={platform} onChange={(e) => setPlatform(e.target.value as "MT4" | "MT5")}>
            <option value="MT5">MetaTrader 5</option>
            <option value="MT4">MetaTrader 4</option>
          </select>
        </label>
        <label className="form-field">
          <span>Tanggal rilis *</span>
          <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
        </label>
        <label className="form-field">
          <span>Tipe akun</span>
          <input value={accountType} onChange={(e) => setAccountType(e.target.value)} />
        </label>
        <label className="form-field">
          <span>Deposit pengujian</span>
          <input value={testingDeposit} onChange={(e) => setTestingDeposit(e.target.value)} />
        </label>
        <label className="form-field">
          <span>Persyaratan broker</span>
          <input value={brokerRequirements} onChange={(e) => setBrokerRequirements(e.target.value)} />
        </label>
        <label className="form-field">
          <span>Lingkup Perdagangan Berjangka (PBK)</span>
          <select value={pbkScope} onChange={(e) => setPbkScope(e.target.value as "IN_SCOPE" | "OUT_OF_SCOPE")}>
            <option value="IN_SCOPE">Dalam lingkup PBK Indonesia (Bappebti)</option>
            <option value="OUT_OF_SCOPE">Hanya luar negeri / MQL5 Market</option>
          </select>
        </label>
        <label className="form-field checkbox-field">
          <input type="checkbox" checked={dangerMode} onChange={(e) => setDangerMode(e.target.checked)} />
          <span>EA memakai mode berisiko tinggi (martingale / grid tak terbatas / recovery)</span>
        </label>
        <label className="form-field checkbox-field">
          <input type="checkbox" checked={gui} onChange={(e) => setGui(e.target.checked)} />
          <span>EA memiliki antarmuka / panel di chart (GUI)</span>
        </label>
      </div>

      <h3>Konfigurasi yang didukung</h3>
      <p className="setup-note">
        <Info aria-hidden="true" size={15} /> {BROKER_MIN_LOT_NOTE_ID}
      </p>
      <ol className="setup-rows">
        {rows.map((row, i) => (
          <li key={i} className="setup-row" data-error={Boolean(rowErrors[i])}>
            <div className="setup-grid">
              <label className="setup-field">
                <span>Symbol</span>
                <input
                  className="mono"
                  value={row.symbol}
                  onChange={(e) => patch(i, { symbol: e.target.value })}
                  onBlur={(e) => patch(i, { symbol: normalizeSymbol(e.target.value) })}
                  placeholder="XAUUSD / XAUUSD.m / EURUSD.pro"
                />
              </label>
              <label className="setup-field">
                <span>Timeframe</span>
                <select value={row.timeframe} onChange={(e) => patch(i, { timeframe: e.target.value as MtTimeframe })}>
                  {MT_TIMEFRAMES.map((tf) => (
                    <option key={tf} value={tf}>
                      {MT_TIMEFRAME_LABELS[tf]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="setup-field">
                <span>Preset</span>
                <input value={row.presetRef} onChange={(e) => patch(i, { presetRef: e.target.value })} placeholder="opsional" />
              </label>
              <label className="setup-field">
                <span>Tested Minimum Lot</span>
                <input
                  inputMode="decimal"
                  value={row.testedMinimumLot}
                  onChange={(e) => patch(i, { testedMinimumLot: e.target.value })}
                  placeholder="opsional"
                />
                <small>data uji developer — bukan minimum broker</small>
              </label>
              <label className="setup-field setup-field-wide">
                <span>Notes</span>
                <input value={row.notes} onChange={(e) => patch(i, { notes: e.target.value })} placeholder="opsional" />
              </label>
              <label className="setup-checkbox">
                <input type="checkbox" checked={row.isSupported} onChange={(e) => patch(i, { isSupported: e.target.checked })} />
                <span>Supported</span>
              </label>
            </div>
            <div className="setup-row-actions">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Naikkan baris ${i + 1}`}>
                <ArrowUp aria-hidden="true" size={15} />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Turunkan baris ${i + 1}`}>
                <ArrowDown aria-hidden="true" size={15} />
              </button>
              <button
                type="button"
                onClick={() => setRows((prev) => (prev.length === 1 ? [blank()] : prev.filter((_, idx) => idx !== i)))}
                aria-label={`Hapus baris ${i + 1}`}
              >
                <Trash2 aria-hidden="true" size={15} />
              </button>
            </div>
            {rowErrors[i] && (
              <p className="field-error" role="alert">
                {rowErrors[i]}
              </p>
            )}
          </li>
        ))}
      </ol>
      <button type="button" className="secondary-button" onClick={() => setRows((prev) => [...prev, blank()])}>
        <Plus aria-hidden="true" size={16} /> Tambah konfigurasi
      </button>

      <div className="inline-form-actions">
        <button className="ghost-button" onClick={() => setOpen(false)}>
          Batal
        </button>
        <button className="primary-button" onClick={submit} disabled={pending}>
          {pending ? "Menyimpan…" : "Simpan versi EA"}
        </button>
      </div>
    </div>
  );
}
