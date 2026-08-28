import { ArrowLeft, FileDown, Info, Pencil } from "lucide-react";
import Link from "next/link";
import { ManualRenderer } from "@/components/manual-renderer/manual-renderer";

export default function ManualPreviewPage() {
  return (
    <div className="preview-page">
      <header className="preview-toolbar">
        <div><Link className="icon-button" href="/manuals/vmax-ea/edit" aria-label="Kembali ke editor"><ArrowLeft aria-hidden="true" /></Link><div><p className="eyebrow">Preview manual</p><h1>VMax EA · v1.0.0</h1></div></div>
        <div><Link className="secondary-button" href="/manuals/vmax-ea/edit"><Pencil aria-hidden="true" size={17} /> Edit manual</Link><button className="primary-button" disabled title="Ekspor PDF tersedia pada Phase 7"><FileDown aria-hidden="true" size={17} /> Ekspor PDF</button></div>
      </header>
      <div className="preview-disclosure"><InfoIcon /> Preview menggunakan model konten yang sama dengan editor. Ekspor PDF akan diaktifkan pada Phase 7.</div>
      <ManualRenderer />
    </div>
  );
}

function InfoIcon() {
  return <Info aria-hidden="true" size={17} />;
}
