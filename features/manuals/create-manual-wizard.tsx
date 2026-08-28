"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleAlert, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FieldErrors, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { ManualRecord } from "./mock-data";

const schema = z.object({
  source: z.enum(["existing", "new"]),
  eaName: z.string().min(2, "Masukkan nama EA."),
  eaVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "Gunakan format semver, contoh 1.0.0."),
  manualVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "Gunakan format semver, contoh 1.0.0."),
  platform: z.enum(["MT4", "MT5"]),
  releaseDate: z.string().min(1, "Pilih tanggal rilis."),
  developer: z.string().min(2, "Masukkan nama developer."),
  organization: z.string().min(2, "Masukkan nama organisasi."),
  description: z.string().min(20, "Jelaskan fungsi EA minimal 20 karakter."),
  symbols: z.string().min(3, "Masukkan minimal satu simbol."),
  timeframes: z.string().min(2, "Masukkan timeframe yang didukung."),
  accountType: z.string().min(2, "Masukkan tipe akun."),
  minimumLot: z.string().min(1, "Masukkan minimum lot."),
  testingDeposit: z.string().min(1, "Masukkan deposit pengujian atau tandai tidak ditentukan."),
  brokerRequirements: z.string().min(5, "Jelaskan persyaratan broker."),
  vpsRequired: z.enum(["Ya", "Tidak", "Disarankan"]),
  dllRequired: z.enum(["Ya", "Tidak"]),
  webRequestRequired: z.enum(["Ya", "Tidak"]),
  email: z.string().email("Masukkan alamat email yang valid."),
  phone: z.string().min(8, "Masukkan nomor dukungan yang valid."),
  whatsapp: z.string().min(8, "Masukkan nomor WhatsApp yang valid."),
  supportHours: z.string().min(5, "Masukkan jam dukungan."),
});

type FormValues = z.infer<typeof schema>;

const defaults: FormValues = {
  source: "existing",
  eaName: "VMax EA",
  eaVersion: "1.0.0",
  manualVersion: "1.0.0",
  platform: "MT5",
  releaseDate: "2026-08-28",
  developer: "Andi Setiawan",
  organization: "PT Smartin Advisor Sistem",
  description: "Expert Advisor untuk membantu eksekusi strategi pada instrumen XAUUSD sesuai konfigurasi pengguna.",
  symbols: "XAUUSD",
  timeframes: "M15, H1",
  accountType: "Standard / ECN",
  minimumLot: "0.01",
  testingDeposit: "USD 1.000 (demo)",
  brokerRequirements: "Mendukung MetaTrader 5 dan simbol XAUUSD.",
  vpsRequired: "Disarankan",
  dllRequired: "Tidak",
  webRequestRequired: "Tidak",
  email: "support@smartin.id",
  phone: "+62 21 555 0199",
  whatsapp: "+62 812 3456 7890",
  supportHours: "Senin–Jumat, 09.00–17.00 WIB",
};

const steps = ["Pilih produk", "Identitas EA", "Kebutuhan teknis", "Dukungan", "Tinjau"];
const stepFields: (keyof FormValues)[][] = [
  ["source", "eaName"],
  ["eaName", "eaVersion", "manualVersion", "platform", "releaseDate", "developer", "organization", "description"],
  ["symbols", "timeframes", "accountType", "minimumLot", "testingDeposit", "brokerRequirements", "vpsRequired", "dllRequired", "webRequestRequired"],
  ["email", "phone", "whatsapp", "supportHours"],
  [],
];

function ErrorMessage({ name, errors }: { name: keyof FormValues; errors: FieldErrors<FormValues> }) {
  const message = errors[name]?.message;
  return message ? <p className="field-error" id={`${name}-error`} role="alert">{message}</p> : null;
}

function Field({
  label,
  name,
  errors,
  children,
  helper,
}: {
  label: string;
  name: keyof FormValues;
  errors: FieldErrors<FormValues>;
  children: React.ReactNode;
  helper?: string;
}) {
  return (
    <label className="form-field">
      <span>{label} <b aria-hidden="true">*</b></span>
      {children}
      {helper && !errors[name] && <small>{helper}</small>}
      <ErrorMessage name={name} errors={errors} />
    </label>
  );
}

export function CreateManualWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [restored, setRestored] = useState(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const {
    register,
    handleSubmit,
    trigger,
    reset,
    getValues,
    control,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults, mode: "onBlur" });
  const formValues = useWatch({ control });

  useEffect(() => {
    const saved = localStorage.getItem("smartin-manual-wizard");
    if (!saved) return;
    let frame = 0;
    try {
      const restoredValues = { ...defaults, ...JSON.parse(saved) };
      frame = requestAnimationFrame(() => { reset(restoredValues); setRestored(true); });
    } catch {
      localStorage.removeItem("smartin-manual-wizard");
    }
    return () => cancelAnimationFrame(frame);
  }, [reset]);

  useEffect(() => {
    localStorage.setItem("smartin-manual-wizard", JSON.stringify(formValues));
  }, [formValues]);

  async function nextStep() {
    const valid = await trigger(stepFields[step], { shouldFocus: true });
    if (!valid) {
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancel() {
    if (window.confirm("Keluar dari wizard? Draf tetap tersimpan di perangkat ini.")) router.push("/manuals");
  }

  function createManual(values: FormValues) {
    const id = values.eaName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "manual-baru";
    const record: ManualRecord = {
      id,
      eaName: values.eaName,
      platform: values.platform,
      eaVersion: values.eaVersion,
      manualVersion: values.manualVersion,
      completion: 24,
      compliance: "6 / 26",
      status: "DRAFT",
      updated: "Baru saja",
    };
    localStorage.setItem("smartin-new-manual", JSON.stringify(record));
    localStorage.removeItem("smartin-manual-wizard");
    router.push(`/manuals/${id}/edit?created=1`);
  }

  const values = getValues();
  const visibleErrors = stepFields[step].filter((field) => errors[field]);

  return (
    <div className="wizard-layout">
      <aside className="wizard-steps" aria-label="Tahapan pembuatan manual">
        <p className="eyebrow">Progress</p>
        <ol>
          {steps.map((label, index) => (
            <li key={label} data-active={step === index} data-complete={step > index}>
              <span>{step > index ? <Check aria-hidden="true" size={15} /> : index + 1}</span>
              <div><strong>{label}</strong><small>{index === 0 ? "Sumber data produk" : index === 4 ? "Konfirmasi data" : "Data terstruktur"}</small></div>
            </li>
          ))}
        </ol>
        <div className="autosave-note"><Save aria-hidden="true" size={16} /><span><strong>Draf lokal aktif</strong><small>Perubahan tersimpan otomatis.</small></span></div>
      </aside>
      <form className="wizard-card card" onSubmit={handleSubmit(createManual)} noValidate>
        <div className="wizard-mobile-progress"><span>Langkah {step + 1} dari {steps.length}</span><strong>{steps[step]}</strong><div><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div></div>
        {restored && <div className="restored-banner" role="status">Draf sebelumnya telah dipulihkan.</div>}
        {visibleErrors.length > 0 && (
          <div className="error-summary" role="alert" tabIndex={-1} ref={errorSummaryRef} aria-labelledby="wizard-errors-title">
            <CircleAlert aria-hidden="true" />
            <div><h2 id="wizard-errors-title">Periksa data berikut</h2><ul>{visibleErrors.map((name) => <li key={name}><a href={`#${name}`}>{errors[name]?.message}</a></li>)}</ul></div>
          </div>
        )}
        {step === 0 && (
          <section className="wizard-section">
            <p className="eyebrow">Langkah 1</p><h2>Pilih produk EA</h2><p>Mulai dari data produk yang sudah ada atau buat identitas produk baru.</p>
            <div className="choice-grid">
              <label className="choice-card"><input type="radio" value="existing" {...register("source")} /><span><strong>Gunakan produk yang ada</strong><small>Data VMax EA akan dipakai sebagai sumber terstruktur.</small></span></label>
              <label className="choice-card"><input type="radio" value="new" {...register("source")} /><span><strong>Buat produk EA baru</strong><small>Masukkan identitas produk sebelum menyusun manual.</small></span></label>
            </div>
            <Field label="Produk EA" name="eaName" errors={errors} helper="Produk demo untuk Phase 1."><select id="eaName" aria-describedby={errors.eaName ? "eaName-error" : undefined} {...register("eaName")}><option>VMax EA</option><option>Smart Grid Pro</option><option>Momentum Edge</option></select></Field>
          </section>
        )}
        {step === 1 && (
          <section className="wizard-section">
            <p className="eyebrow">Langkah 2</p><h2>Identitas produk</h2><p>Data ini digunakan kembali pada sampul, metadata, dan informasi versi.</p>
            <div className="form-grid">
              <Field label="Nama EA" name="eaName" errors={errors}><input id="eaName" aria-describedby={errors.eaName ? "eaName-error" : undefined} {...register("eaName")} /></Field>
              <Field label="Platform" name="platform" errors={errors}><select id="platform" {...register("platform")}><option value="MT5">MetaTrader 5</option><option value="MT4">MetaTrader 4</option></select></Field>
              <Field label="Versi EA" name="eaVersion" errors={errors}><input id="eaVersion" className="mono" aria-describedby={errors.eaVersion ? "eaVersion-error" : undefined} {...register("eaVersion")} /></Field>
              <Field label="Versi manual" name="manualVersion" errors={errors}><input id="manualVersion" className="mono" aria-describedby={errors.manualVersion ? "manualVersion-error" : undefined} {...register("manualVersion")} /></Field>
              <Field label="Tanggal rilis" name="releaseDate" errors={errors}><input id="releaseDate" type="date" aria-describedby={errors.releaseDate ? "releaseDate-error" : undefined} {...register("releaseDate")} /></Field>
              <Field label="Developer" name="developer" errors={errors}><input id="developer" aria-describedby={errors.developer ? "developer-error" : undefined} {...register("developer")} /></Field>
              <Field label="Organisasi" name="organization" errors={errors}><input id="organization" aria-describedby={errors.organization ? "organization-error" : undefined} {...register("organization")} /></Field>
              <Field label="Deskripsi produk" name="description" errors={errors}><textarea id="description" rows={4} aria-describedby={errors.description ? "description-error" : undefined} {...register("description")} /></Field>
            </div>
          </section>
        )}
        {step === 2 && (
          <section className="wizard-section">
            <p className="eyebrow">Langkah 3</p><h2>Kebutuhan teknis</h2><p>Catat fakta operasional EA. Informasi ini tidak akan ditebak oleh sistem.</p>
            <div className="form-grid">
              <Field label="Simbol / pair" name="symbols" errors={errors}><input id="symbols" aria-describedby={errors.symbols ? "symbols-error" : undefined} {...register("symbols")} /></Field>
              <Field label="Timeframe" name="timeframes" errors={errors}><input id="timeframes" aria-describedby={errors.timeframes ? "timeframes-error" : undefined} {...register("timeframes")} /></Field>
              <Field label="Tipe akun" name="accountType" errors={errors}><input id="accountType" aria-describedby={errors.accountType ? "accountType-error" : undefined} {...register("accountType")} /></Field>
              <Field label="Minimum lot" name="minimumLot" errors={errors}><input id="minimumLot" inputMode="decimal" aria-describedby={errors.minimumLot ? "minimumLot-error" : undefined} {...register("minimumLot")} /></Field>
              <Field label="Deposit pengujian" name="testingDeposit" errors={errors}><input id="testingDeposit" aria-describedby={errors.testingDeposit ? "testingDeposit-error" : undefined} {...register("testingDeposit")} /></Field>
              <Field label="Persyaratan broker" name="brokerRequirements" errors={errors}><textarea id="brokerRequirements" rows={3} aria-describedby={errors.brokerRequirements ? "brokerRequirements-error" : undefined} {...register("brokerRequirements")} /></Field>
              <Field label="Kebutuhan VPS" name="vpsRequired" errors={errors}><select id="vpsRequired" {...register("vpsRequired")}><option>Disarankan</option><option>Ya</option><option>Tidak</option></select></Field>
              <Field label="Kebutuhan DLL" name="dllRequired" errors={errors}><select id="dllRequired" {...register("dllRequired")}><option>Tidak</option><option>Ya</option></select></Field>
              <Field label="Kebutuhan WebRequest" name="webRequestRequired" errors={errors}><select id="webRequestRequired" {...register("webRequestRequired")}><option>Tidak</option><option>Ya</option></select></Field>
            </div>
          </section>
        )}
        {step === 3 && (
          <section className="wizard-section">
            <p className="eyebrow">Langkah 4</p><h2>Kanal dukungan</h2><p>Informasi ini akan digunakan pada bab Dukungan tanpa penyalinan manual.</p>
            <div className="form-grid">
              <Field label="Email" name="email" errors={errors}><input id="email" type="email" autoComplete="email" aria-describedby={errors.email ? "email-error" : undefined} {...register("email")} /></Field>
              <Field label="Telepon" name="phone" errors={errors}><input id="phone" type="tel" autoComplete="tel" aria-describedby={errors.phone ? "phone-error" : undefined} {...register("phone")} /></Field>
              <Field label="WhatsApp" name="whatsapp" errors={errors}><input id="whatsapp" type="tel" aria-describedby={errors.whatsapp ? "whatsapp-error" : undefined} {...register("whatsapp")} /></Field>
              <Field label="Jam dukungan" name="supportHours" errors={errors}><input id="supportHours" aria-describedby={errors.supportHours ? "supportHours-error" : undefined} {...register("supportHours")} /></Field>
            </div>
          </section>
        )}
        {step === 4 && (
          <section className="wizard-section review-section">
            <p className="eyebrow">Langkah 5</p><h2>Tinjau data manual</h2><p>Pastikan fakta berikut sesuai produk. Anda masih dapat mengubahnya sebelum manual dibuat.</p>
            <div className="review-group"><h2>Identitas EA <button type="button" onClick={() => setStep(1)}>Ubah</button></h2><dl><div><dt>Produk</dt><dd>{values.eaName}</dd></div><div><dt>Platform</dt><dd>{values.platform}</dd></div><div><dt>Versi</dt><dd>EA {values.eaVersion} · Manual {values.manualVersion}</dd></div><div><dt>Developer</dt><dd>{values.developer}</dd></div></dl></div>
            <div className="review-group"><h2>Kebutuhan teknis <button type="button" onClick={() => setStep(2)}>Ubah</button></h2><dl><div><dt>Simbol</dt><dd>{values.symbols}</dd></div><div><dt>Timeframe</dt><dd>{values.timeframes}</dd></div><div><dt>Akun</dt><dd>{values.accountType}</dd></div><div><dt>Dependensi</dt><dd>DLL: {values.dllRequired} · WebRequest: {values.webRequestRequired}</dd></div></dl></div>
            <div className="review-group"><h2>Dukungan <button type="button" onClick={() => setStep(3)}>Ubah</button></h2><dl><div><dt>Email</dt><dd>{values.email}</dd></div><div><dt>WhatsApp</dt><dd>{values.whatsapp}</dd></div><div><dt>Jam</dt><dd>{values.supportHours}</dd></div></dl></div>
            <div className="demo-disclosure"><CircleAlert aria-hidden="true" /><p><strong>Data demo Phase 1</strong> Data teknis ini adalah contoh antarmuka dan bukan spesifikasi atau klaim performa produk nyata.</p></div>
          </section>
        )}
        <footer className="wizard-footer">
          <button type="button" className="ghost-button" onClick={cancel}>Batal</button>
          <div>
            {step > 0 && <button type="button" className="secondary-button" onClick={() => setStep((current) => current - 1)}><ArrowLeft aria-hidden="true" size={17} /> Kembali</button>}
            {step < steps.length - 1 ? <button type="button" className="primary-button" onClick={nextStep}>Lanjutkan <ChevronRight aria-hidden="true" size={17} /></button> : <button type="submit" className="primary-button">Buat manual <ArrowRight aria-hidden="true" size={17} /></button>}
          </div>
        </footer>
      </form>
    </div>
  );
}
