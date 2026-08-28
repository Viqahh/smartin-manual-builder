"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleAlert, Info, Plus, Trash2 } from "lucide-react";
import { MT_TIMEFRAMES, MT_TIMEFRAME_LABELS, type MtTimeframe } from "@/lib/domain/timeframes";
import { SYMBOL_PATTERN, normalizeSymbol, setupDedupeKey } from "@/lib/domain/symbol";
import { BROKER_MIN_LOT_NOTE_ID } from "@/lib/domain/setups";
import { isSemver } from "@/lib/domain/semver";
import { createManual } from "./actions";

export type WizardProduct = {
  id: string;
  name: string;
  versions: { id: string; version: string; platform: "MT4" | "MT5" }[];
};

type SetupRow = { symbol: string; timeframe: MtTimeframe; presetRef: string; testedMinimumLot: string; notes: string; isSupported: boolean };
const blankSetup = (): SetupRow => ({ symbol: "", timeframe: "M15", presetRef: "", testedMinimumLot: "", notes: "", isSupported: true });

export function CreateManualWizard({ products }: { products: WizardProduct[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"existing" | "new">(products.length ? "existing" : "new");
  const [step, setStep] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);

  // existing path
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [versionId, setVersionId] = useState(products[0]?.versions[0]?.id ?? "");
  const selectedProduct = useMemo(() => products.find((p) => p.id === productId), [products, productId]);

  // new path
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [eaVersion, setEaVersion] = useState("1.0.0");
  const [platform, setPlatform] = useState<"MT4" | "MT5">("MT5");
  const [releaseDate, setReleaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountType, setAccountType] = useState("Standard / ECN");
  const [rows, setRows] = useState<SetupRow[]>([blankSetup()]);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  // shared
  const [manualVersion, setManualVersion] = useState("1.0.0");

  const steps = mode === "existing" ? ["Pilih produk", "Versi manual", "Tinjau"] : ["Identitas EA", "Konfigurasi", "Versi manual", "Tinjau"];

  function patchRow(i: number, next: Partial<SetupRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...next } : r)));
  }

  function validateSetups(): boolean {
    const errs: Record<number, string> = {};
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

  function next() {
    setFormError(null);
    if (mode === "new" && step === 0) {
      if (newName.trim().length < 2) return setFormError("Masukkan nama produk.");
      if (!isSemver(eaVersion)) return setFormError("Versi EA harus format semver, contoh 1.0.0.");
    }
    if (mode === "new" && step === 1 && !validateSetups()) return;
    if ((mode === "existing" && step === 1) || (mode === "new" && step === 2)) {
      if (!isSemver(manualVersion)) return setFormError("Versi manual harus format semver, contoh 1.0.0.");
    }
    setStep((s) => Math.min(s + 1, steps.length - 1));
  }

  function submit() {
    setFormError(null);
    start(async () => {
      const payload =
        mode === "existing"
          ? { mode: "existing" as const, eaProductId: productId, eaVersionId: versionId, manualVersion, locale: "id" }
          : {
              mode: "new" as const,
              product: { name: newName, description: newDescription },
              version: {
                version: eaVersion,
                platform,
                releaseDate,
                requirements: {
                  accountType,
                  testingDeposit: "",
                  brokerRequirements: "",
                  vps: "Disarankan" as const,
                  dll: false,
                  webRequest: false,
                  customIndicators: [],
                  volumeConstraints: "",
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
              },
              manualVersion,
              locale: "id",
            };

      const res = await createManual(payload);
      if (res.ok) {
        router.push(`/manuals/${res.data.manualId}/edit`);
      } else {
        setFormError(res.issues?.[0]?.message ?? res.message);
      }
    });
  }

  const isLast = step === steps.length - 1;

  return (
    <div className="wizard-layout">
      <aside className="wizard-steps" aria-label="Tahapan pembuatan manual">
        <p className="eyebrow">Progress</p>
        <ol>
          {steps.map((label, index) => (
            <li key={label} data-active={step === index} data-complete={step > index}>
              <span>{step > index ? <Check aria-hidden="true" size={15} /> : index + 1}</span>
              <div>
                <strong>{label}</strong>
              </div>
            </li>
          ))}
        </ol>
      </aside>

      <div className="wizard-card card">
        {formError && (
          <div className="error-summary" role="alert">
            <CircleAlert aria-hidden="true" />
            <div>
              <h2>Periksa data berikut</h2>
              <p>{formError}</p>
            </div>
          </div>
        )}

        {/* choose source */}
        {step === 0 && (
          <section className="wizard-section">
            <div className="choice-grid">
              <label className="choice-card" data-active={mode === "existing"}>
                <input
                  type="radio"
                  checked={mode === "existing"}
                  disabled={products.length === 0}
                  onChange={() => {
                    setMode("existing");
                    setStep(0);
                  }}
                />
                <span>
                  <strong>Gunakan produk EA yang ada</strong>
                  <small>{products.length ? "Pilih produk dan versi EA." : "Belum ada produk EA."}</small>
                </span>
              </label>
              <label className="choice-card" data-active={mode === "new"}>
                <input
                  type="radio"
                  checked={mode === "new"}
                  onChange={() => {
                    setMode("new");
                    setStep(0);
                  }}
                />
                <span>
                  <strong>Buat produk EA baru</strong>
                  <small>Identitas + konfigurasi dibuat bersamaan.</small>
                </span>
              </label>
            </div>

            {mode === "existing" ? (
              <div className="form-grid">
                <label className="form-field">
                  <span>Produk EA</span>
                  <select
                    value={productId}
                    onChange={(e) => {
                      setProductId(e.target.value);
                      const p = products.find((x) => x.id === e.target.value);
                      setVersionId(p?.versions[0]?.id ?? "");
                    }}
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Versi EA</span>
                  <select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
                    {(selectedProduct?.versions ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.platform} · {v.version}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <div className="form-grid">
                <label className="form-field">
                  <span>Nama EA *</span>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="mis. Polaris EA" />
                </label>
                <label className="form-field">
                  <span>Platform *</span>
                  <select value={platform} onChange={(e) => setPlatform(e.target.value as "MT4" | "MT5")}>
                    <option value="MT5">MetaTrader 5</option>
                    <option value="MT4">MetaTrader 4</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Versi EA * (semver)</span>
                  <input className="mono" value={eaVersion} onChange={(e) => setEaVersion(e.target.value)} />
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
                  <span>Deskripsi</span>
                  <input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
                </label>
              </div>
            )}
          </section>
        )}

        {/* new path — setups */}
        {mode === "new" && step === 1 && (
          <section className="wizard-section">
            <h2>Konfigurasi yang didukung</h2>
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
                        onChange={(e) => patchRow(i, { symbol: e.target.value })}
                        onBlur={(e) => patchRow(i, { symbol: normalizeSymbol(e.target.value) })}
                        placeholder="XAUUSD / XAUUSD.m / EURUSD.pro"
                      />
                    </label>
                    <label className="setup-field">
                      <span>Timeframe</span>
                      <select value={row.timeframe} onChange={(e) => patchRow(i, { timeframe: e.target.value as MtTimeframe })}>
                        {MT_TIMEFRAMES.map((tf) => (
                          <option key={tf} value={tf}>
                            {MT_TIMEFRAME_LABELS[tf]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="setup-field">
                      <span>Preset</span>
                      <input value={row.presetRef} onChange={(e) => patchRow(i, { presetRef: e.target.value })} placeholder="opsional" />
                    </label>
                    <label className="setup-field">
                      <span>Tested Minimum Lot</span>
                      <input
                        inputMode="decimal"
                        value={row.testedMinimumLot}
                        onChange={(e) => patchRow(i, { testedMinimumLot: e.target.value })}
                        placeholder="opsional"
                      />
                      <small>data uji developer — bukan minimum broker</small>
                    </label>
                    <label className="setup-field setup-field-wide">
                      <span>Notes</span>
                      <input value={row.notes} onChange={(e) => patchRow(i, { notes: e.target.value })} placeholder="opsional" />
                    </label>
                    <label className="setup-checkbox">
                      <input type="checkbox" checked={row.isSupported} onChange={(e) => patchRow(i, { isSupported: e.target.checked })} />
                      <span>Supported</span>
                    </label>
                  </div>
                  <div className="setup-row-actions">
                    <button
                      type="button"
                      onClick={() => setRows((p) => (p.length === 1 ? [blankSetup()] : p.filter((_, idx) => idx !== i)))}
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
            <button type="button" className="secondary-button" onClick={() => setRows((p) => [...p, blankSetup()])}>
              <Plus aria-hidden="true" size={16} /> Tambah konfigurasi
            </button>
          </section>
        )}

        {/* manual version */}
        {((mode === "existing" && step === 1) || (mode === "new" && step === 2)) && (
          <section className="wizard-section">
            <h2>Versi manual</h2>
            <p>Versi manual harus unik untuk setiap Manual dan mengacu ke satu versi EA.</p>
            <label className="form-field">
              <span>Versi manual * (semver)</span>
              <input className="mono" value={manualVersion} onChange={(e) => setManualVersion(e.target.value)} />
            </label>
          </section>
        )}

        {/* review */}
        {isLast && (
          <section className="wizard-section review-section">
            <h2>Tinjau</h2>
            <div className="review-group">
              <h2>Identitas EA</h2>
              <dl>
                <div>
                  <dt>Sumber</dt>
                  <dd>{mode === "existing" ? "Produk EA yang ada" : "Produk EA baru"}</dd>
                </div>
                <div>
                  <dt>Produk</dt>
                  <dd>{mode === "existing" ? selectedProduct?.name : newName}</dd>
                </div>
                <div>
                  <dt>Versi EA</dt>
                  <dd className="mono">
                    {mode === "existing"
                      ? selectedProduct?.versions.find((v) => v.id === versionId)?.version
                      : `${platform} · ${eaVersion}`}
                  </dd>
                </div>
                <div>
                  <dt>Versi manual</dt>
                  <dd className="mono">{manualVersion}</dd>
                </div>
              </dl>
            </div>
            {mode === "new" && (
              <div className="review-group">
                <h2>Konfigurasi</h2>
                <ul>
                  {rows.map((r, i) => (
                    <li key={i} className="mono">
                      {normalizeSymbol(r.symbol) || "?"} / {r.timeframe}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="demo-disclosure">
              <CircleAlert aria-hidden="true" />
              <p>Manual dibuat dengan 18 bab kanonik dari template Smartin.</p>
            </div>
          </section>
        )}

        <footer className="wizard-footer">
          <button type="button" className="ghost-button" onClick={() => router.push("/manuals")}>
            Batal
          </button>
          <div>
            {step > 0 && (
              <button type="button" className="secondary-button" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft aria-hidden="true" size={17} /> Kembali
              </button>
            )}
            {!isLast ? (
              <button type="button" className="primary-button" onClick={next}>
                Lanjutkan <ChevronRight aria-hidden="true" size={17} />
              </button>
            ) : (
              <button type="button" className="primary-button" onClick={submit} disabled={pending}>
                {pending ? "Membuat…" : "Buat manual"} <ArrowRight aria-hidden="true" size={17} />
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
