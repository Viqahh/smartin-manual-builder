import { SectionPage } from "@/components/section-page";

export default function TemplatesPage() {
  return <SectionPage eyebrow="Dokumentasi" title="Template manual" description="Struktur standar menjaga setiap manual EA konsisten dan mudah ditinjau." items={[{ title: "Template Manual EA Standar", detail: "18 bab · 13 bab wajib · diperbarui 20 Agu 2026", ready: true }, { title: "Template Checklist Dokumentasi", detail: "26 pemeriksaan awal untuk identitas, instalasi, teknis, risiko, dan dukungan", ready: true }, { title: "Editor template admin", detail: "Pengelolaan template penuh akan dihubungkan pada Phase 2." }]} />;
}
