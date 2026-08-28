"use client";

import { AlertTriangle, Check, ChevronRight, Circle, Eye, FileText, Info, LockKeyhole, PanelLeft, PanelRight, Save, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ManualChapterContent } from "@/components/manual-renderer/manual-renderer";
import { chapters } from "./mock-data";

function StateIcon({ state }: { state: (typeof chapters)[number]["state"] }) {
  if (state === "complete") return <Check aria-label="Selesai" size={14} />;
  if (state === "issue") return <AlertTriangle aria-label="Ada masalah" size={14} />;
  if (state === "current") return <span className="current-dot" aria-label="Sedang diedit" />;
  return <Circle aria-label="Belum lengkap" size={13} />;
}

function ChapterPanel({ selected, onSelect, close }: { selected: string; onSelect: (id: string) => void; close?: () => void }) {
  return (
    <aside className="chapter-panel" aria-label="Navigasi bab">
      {close && <button className="icon-button panel-close" aria-label="Tutup daftar bab" onClick={close}><X aria-hidden="true" /></button>}
      <div className="panel-heading"><div><p className="eyebrow">Manual Book</p><h2>Daftar bab</h2></div><span>82%</span></div>
      <div className="overall-progress"><span style={{ width: "82%" }} /></div>
      <p className="progress-copy">14 dari 18 bab memiliki konten</p>
      <nav className="chapter-list">
        {chapters.map((chapter) => (
          <button key={chapter.id} data-active={selected === chapter.id} data-state={chapter.state} onClick={() => { onSelect(chapter.id); close?.(); }}>
            <span className="chapter-state"><StateIcon state={selected === chapter.id ? "current" : chapter.state} /></span>
            <span className="chapter-copy"><small>BAB {chapter.number.padStart(2, "0")}</small><strong>{chapter.title}</strong></span>
            {chapter.required && <LockKeyhole aria-label="Bab wajib" size={13} />}
          </button>
        ))}
      </nav>
      <button className="secondary-button full-button" disabled title="Bab kustom tersedia pada Phase 2">Tambah bab kustom</button>
    </aside>
  );
}

function Inspector({ tab, setTab, close }: { tab: string; setTab: (tab: string) => void; close?: () => void }) {
  return (
    <aside className="inspector-panel" aria-label="Inspector manual">
      {close && <button className="icon-button panel-close" aria-label="Tutup inspector" onClick={close}><X aria-hidden="true" /></button>}
      <div className="inspector-tabs" role="tablist" aria-label="Inspector">
        {["Validasi", "Metadata"].map((item) => <button role="tab" aria-selected={tab === item} key={item} onClick={() => setTab(item)}>{item}</button>)}
      </div>
      {tab === "Validasi" ? (
        <div className="inspector-content">
          <div className="inspector-score"><span>82<small>%</small></span><div><strong>Kelengkapan bab</strong><p>3 pemeriksaan aktif</p></div></div>
          <section><h3>Status bab</h3><div className="validation-item success"><Check aria-hidden="true" /><div><strong>Judul bab tersedia</strong><p>Struktur mengikuti template.</p></div></div><div className="validation-item success"><Check aria-hidden="true" /><div><strong>Langkah instalasi tersedia</strong><p>5 langkah terdokumentasi.</p></div></div><div className="validation-item warning"><AlertTriangle aria-hidden="true" /><div><strong>Tambahkan alt text final</strong><p>Teks saat ini masih berstatus demo.</p></div></div></section>
          <section><h3>Asisten penulisan</h3><button className="ai-placeholder" disabled title="Asisten AI direncanakan untuk Phase 4"><Sparkles aria-hidden="true" /><span><strong>AI Assistant</strong><small>Tersedia pada Phase 4</small></span></button></section>
          <div className="compliance-note"><Info aria-hidden="true" /><p>Skor ini mengukur kelengkapan dokumentasi, bukan persetujuan hukum atau regulator.</p></div>
        </div>
      ) : (
        <div className="inspector-content metadata-list"><section><h3>Produk</h3><dl><div><dt>EA</dt><dd>VMax EA</dd></div><div><dt>Platform</dt><dd>MT5</dd></div><div><dt>Versi EA</dt><dd className="mono">1.0.0</dd></div><div><dt>Versi manual</dt><dd className="mono">1.0.0</dd></div></dl></section><section><h3>Kepemilikan</h3><dl><div><dt>Developer</dt><dd>Andi Setiawan</dd></div><div><dt>Organisasi</dt><dd>PT Smartin Advisor Sistem</dd></div></dl></section></div>
      )}
    </aside>
  );
}

export function ManualBuilder() {
  const [selected, setSelected] = useState("installation");
  const [mobilePanel, setMobilePanel] = useState<"chapters" | "inspector" | null>(null);
  const [tab, setTab] = useState("Validasi");

  useEffect(() => {
    const saved = localStorage.getItem("smartin-builder-chapter");
    if (!saved || !chapters.some((chapter) => chapter.id === saved)) return;
    const frame = requestAnimationFrame(() => setSelected(saved));
    return () => cancelAnimationFrame(frame);
  }, []);

  function selectChapter(id: string) {
    setSelected(id);
    localStorage.setItem("smartin-builder-chapter", id);
  }

  const chapter = useMemo(() => chapters.find((item) => item.id === selected) ?? chapters[4], [selected]);

  return (
    <div className="builder-page">
      <header className="builder-topbar">
        <div className="builder-breadcrumb"><Link href="/manuals">Manual Book</Link><ChevronRight aria-hidden="true" size={14} /><strong>VMax EA</strong><span className="status-badge" data-status="DRAFT">Draf</span></div>
        <div className="save-state" role="status"><Save aria-hidden="true" size={15} /> Tersimpan barusan</div>
        <div className="builder-top-actions"><Link className="secondary-button" href="/manuals/vmax-ea/preview"><Eye aria-hidden="true" size={17} /> Preview manual</Link><button className="primary-button" disabled title="Pengiriman review tersedia pada Phase 6">Kirim review</button></div>
      </header>
      <div className="builder-mobile-controls">
        <button className="secondary-button" onClick={() => setMobilePanel("chapters")}><PanelLeft aria-hidden="true" size={17} /> Bab</button>
        <span>{chapter.number}. {chapter.title}</span>
        <button className="secondary-button" onClick={() => setMobilePanel("inspector")}><PanelRight aria-hidden="true" size={17} /> Inspector</button>
      </div>
      <div className="builder-grid">
        <div className="builder-chapters-desktop"><ChapterPanel selected={selected} onSelect={selectChapter} /></div>
        <section className="editor-workspace" aria-labelledby="chapter-title">
          <div className="editor-toolbar"><div><p className="eyebrow">BAB {chapter.number.padStart(2, "0")}</p><h1 id="chapter-title">{chapter.title}</h1></div><div><span className="block-count"><FileText aria-hidden="true" size={15} /> {chapter.id === "installation" ? "9 blok" : chapter.id === "parameters" ? "5 blok" : "3 blok"}</span><button className="secondary-button" disabled title="Block editor tersedia pada Phase 3">Tambah blok</button></div></div>
          <div className="editor-canvas"><ManualChapterContent chapter={chapter} /></div>
        </section>
        <div className="builder-inspector-desktop"><Inspector tab={tab} setTab={setTab} /></div>
      </div>
      {mobilePanel && <div className="panel-drawer-layer"><button className="drawer-scrim" aria-label="Tutup panel" onClick={() => setMobilePanel(null)} />{mobilePanel === "chapters" ? <ChapterPanel selected={selected} onSelect={selectChapter} close={() => setMobilePanel(null)} /> : <Inspector tab={tab} setTab={setTab} close={() => setMobilePanel(null)} />}</div>}
    </div>
  );
}
