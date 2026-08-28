import { SectionPage } from "@/components/section-page";

export default function TechnicalReviewPage() {
  return <SectionPage eyebrow="Review" title="Review teknis" description="Antrean verifikasi kesesuaian manual dengan perilaku Expert Advisor." items={[{ title: "Smart Grid Pro v2.4.0", detail: "Dikirim oleh Budi Pratama · 25 dari 26 item lengkap", ready: true }, { title: "VMax EA v1.0.0", detail: "Draf belum dikirim · lengkapi 2 catatan validasi" }]} />;
}
