import { SectionPage } from "@/components/section-page";

export default function ComplianceReviewPage() {
  return <SectionPage eyebrow="Review" title="Review kepatuhan" description="Tinjau kelengkapan dokumentasi dan klaim yang memerlukan perhatian." items={[{ title: "Smart Grid Pro v2.4.0", detail: "Review teknis selesai · siap ditinjau kepatuhan", ready: true }, { title: "Claim checker & keputusan reviewer", detail: "Workflow penuh akan tersedia pada Phase 5–6." }]} />;
}
