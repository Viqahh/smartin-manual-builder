import { AlertTriangle, CheckCircle2, Info, Lightbulb } from "lucide-react";
import Image from "next/image";
import { Chapter, parameters } from "@/features/manuals/mock-data";

function InstallationContent() {
  return (
    <div className="manual-content">
      <p className="lead">Ikuti langkah berikut untuk memasang VMax EA pada MetaTrader 5. Tutup platform sebelum menyalin berkas jika broker Anda mensyaratkannya.</p>
      <div className="step-list">
        <article><span>1</span><div><h3>Buka folder data MetaTrader 5</h3><p>Di menu utama, pilih <strong>File → Open Data Folder</strong>.</p></div></article>
        <article><span>2</span><div><h3>Buka direktori Expert Advisor</h3><p>Masuk ke folder <code>MQL5</code>, lalu buka folder <code>Experts</code>.</p></div></article>
      </div>
      <figure className="manual-image-block">
        <Image src="/images/metatrader-setup.svg" width={960} height={540} alt="Contoh navigasi dari menu File menuju folder MQL5 Experts di MetaTrader 5" priority />
        <figcaption>Gambar 4.1 — Lokasi folder Expert Advisor pada MetaTrader 5. Ilustrasi demo.</figcaption>
      </figure>
      <div className="step-list">
        <article><span>3</span><div><h3>Salin berkas EA</h3><p>Salin berkas <code>VMaxEA.ex5</code> ke dalam folder <code>Experts</code>.</p></div></article>
        <article><span>4</span><div><h3>Muat ulang Navigator</h3><p>Kembali ke MetaTrader 5, klik kanan panel Navigator, lalu pilih <strong>Refresh</strong>.</p></div></article>
        <article><span>5</span><div><h3>Pasang EA pada chart</h3><p>Tarik VMax EA ke chart XAUUSD dan periksa seluruh parameter sebelum mengaktifkan Algo Trading.</p></div></article>
      </div>
      <aside className="manual-callout warning"><AlertTriangle aria-hidden="true" /><div><strong>Periksa akun sebelum aktivasi</strong><p>Gunakan akun demo untuk pengujian awal. EA merupakan alat bantu dan hasil perdagangan tidak dapat dijamin.</p></div></aside>
    </div>
  );
}

function ParameterContent() {
  return (
    <div className="manual-content">
      <p className="lead">Parameter berikut merupakan data contoh untuk menunjukkan struktur referensi input. Nilai harus diverifikasi terhadap EA sebelum review teknis.</p>
      <div className="parameter-group-heading"><div><span>TR</span><div><h3>Trading</h3><p>Pengaturan dasar eksekusi dan identifikasi order</p></div></div><span>3 parameter</span></div>
      <div className="manual-table-wrap">
        <table className="parameter-table">
          <thead><tr><th>Parameter</th><th>Tipe</th><th>Default</th><th>Rentang aman</th><th>Efek pada order</th></tr></thead>
          <tbody>{parameters.map((parameter) => <tr key={parameter.technicalName}><td><strong>{parameter.displayName}</strong><code>{parameter.technicalName}</code></td><td><code>{parameter.type}</code></td><td><code>{parameter.defaultValue}</code></td><td>{parameter.safeRange}</td><td>{parameter.effect}</td></tr>)}</tbody>
        </table>
      </div>
      <aside className="manual-callout info"><Info aria-hidden="true" /><div><strong>Data terstruktur</strong><p>Parameter dikelola sebagai data reusable. Tabel editor lengkap akan tersedia pada Phase 3.</p></div></aside>
    </div>
  );
}

function OverviewContent() {
  return (
    <div className="manual-content">
      <p className="lead">VMax EA adalah Expert Advisor MetaTrader 5 yang membantu pengguna menjalankan konfigurasi perdagangan pada XAUUSD. Seluruh keputusan konfigurasi dan risiko penggunaan tetap menjadi tanggung jawab pengguna.</p>
      <div className="fact-grid"><div><span>Platform</span><strong>MetaTrader 5</strong></div><div><span>Versi EA</span><strong>1.0.0</strong></div><div><span>Simbol demo</span><strong>XAUUSD</strong></div><div><span>Timeframe demo</span><strong>M15, H1</strong></div></div>
      <aside className="manual-callout tip"><Lightbulb aria-hidden="true" /><div><strong>Informasi demo</strong><p>Konten Phase 1 menunjukkan format dokumentasi dan tidak menyatakan performa produk nyata.</p></div></aside>
    </div>
  );
}

function GenericContent({ chapter }: { chapter: Chapter }) {
  return (
    <div className="manual-content generic-chapter">
      <p className="lead">Bab ini telah disiapkan dari template Smartin agar developer tidak memulai dari halaman kosong.</p>
      <div className="content-outline">
        <CheckCircle2 aria-hidden="true" />
        <div><h3>Konten terstruktur untuk {chapter.title}</h3><p>Fakta produk, panduan pengguna, gambar, dan catatan validasi akan disusun dalam blok yang mudah ditinjau.</p></div>
      </div>
      {chapter.state === "issue" && <aside className="manual-callout warning"><AlertTriangle aria-hidden="true" /><div><strong>Perlu verifikasi teknis</strong><p>Tambahkan informasi faktual dari developer sebelum bab ini dikirim ke reviewer.</p></div></aside>}
    </div>
  );
}

export function ManualChapterContent({ chapter }: { chapter: Chapter }) {
  if (chapter.id === "installation") return <InstallationContent />;
  if (chapter.id === "parameters") return <ParameterContent />;
  if (chapter.id === "overview") return <OverviewContent />;
  return <GenericContent chapter={chapter} />;
}

export function ManualRenderer() {
  return (
    <article className="a4-document">
      <section className="manual-cover">
        <div className="manual-cover-brand"><span>S</span><div><strong>SMARTIN</strong><small>Advisor Sistem</small></div></div>
        <div className="manual-cover-copy"><p>EXPERT ADVISOR MANUAL</p><h1>VMax EA</h1><h2>User Manual Book</h2><div className="cover-rule" /><dl><div><dt>Platform</dt><dd>MetaTrader 5</dd></div><div><dt>EA Version</dt><dd>1.0.0</dd></div><div><dt>Manual Version</dt><dd>1.0.0</dd></div><div><dt>Release Date</dt><dd>28 August 2026</dd></div></dl></div>
        <footer><span>PT Smartin Advisor Sistem</span><span>Sample / Demo Document</span></footer>
      </section>
      <section className="manual-page"><header><span>VMax EA · User Manual</span><span>Version 1.0.0</span></header><div className="manual-page-body"><p className="chapter-kicker">01 · PRODUCT OVERVIEW</p><h2>Ringkasan Produk</h2><OverviewContent /></div><footer><span>SMARTIN MANUAL BUILDER</span><span>2</span></footer></section>
      <section className="manual-page"><header><span>VMax EA · User Manual</span><span>Version 1.0.0</span></header><div className="manual-page-body"><p className="chapter-kicker">04 · INSTALLATION</p><h2>Instalasi</h2><InstallationContent /></div><footer><span>SMARTIN MANUAL BUILDER</span><span>3</span></footer></section>
      <section className="manual-page"><header><span>VMax EA · User Manual</span><span>Version 1.0.0</span></header><div className="manual-page-body"><p className="chapter-kicker">07 · INPUT REFERENCE</p><h2>Referensi Input / Parameter</h2><ParameterContent /></div><footer><span>SMARTIN MANUAL BUILDER</span><span>4</span></footer></section>
    </article>
  );
}
