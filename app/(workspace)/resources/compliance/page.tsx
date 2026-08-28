import { SectionPage } from "@/components/section-page";

export default function ComplianceGuidePage() {
  return <SectionPage eyebrow="Sumber daya" title="Checklist kepatuhan" description="Checklist membantu kesiapan dokumentasi dan tidak sama dengan persetujuan regulator." items={[{ title: "Identitas & versi produk", detail: "Nama EA, platform, versi, developer, dan tanggal rilis tercatat.", ready: true }, { title: "Risiko & bahasa klaim", detail: "Pernyataan risiko tersedia dan hasil historis tidak dipresentasikan sebagai jaminan.", ready: true }, { title: "Dukungan & transparansi", detail: "Kanal dukungan serta metode operasi dijelaskan secara memadai.", ready: true }]} />;
}
