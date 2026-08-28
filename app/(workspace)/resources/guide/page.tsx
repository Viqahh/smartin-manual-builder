import { SectionPage } from "@/components/section-page";

export default function GuidePage() {
  return <SectionPage eyebrow="Sumber daya" title="Panduan dokumentasi" description="Panduan praktis untuk menyusun manual EA yang jelas, faktual, dan dapat dipelihara." items={[{ title: "Menulis langkah instalasi yang dapat diikuti", detail: "Gunakan satu tindakan per langkah dan pasangkan screenshot dengan konteksnya.", ready: true }, { title: "Mendokumentasikan parameter EA", detail: "Catat nama teknis, nilai default, unit, rentang, dan efeknya pada order.", ready: true }, { title: "Menjaga bahasa tetap netral", detail: "Hindari janji profit atau klaim hasil yang tidak dapat diverifikasi.", ready: true }]} />;
}
