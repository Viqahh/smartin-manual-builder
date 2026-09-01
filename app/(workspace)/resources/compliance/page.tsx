import { PageHeader } from "@/components/page-header";
import { ResourceAccordion, type ResourceItem } from "@/components/resource-accordion";
import { CHECKLIST_V1, notApplicableReason } from "@/lib/validation/rules";
import { CATEGORY_LABELS, CHECKLIST_OWNER_LABEL, checklistOwner } from "@/lib/validation/types";

/**
 * UAT-32 — a single READ-ONLY compliance reference built from the SAME checklist-rule metadata the
 * builder's validation inspector uses. It never shows a per-manual status (that lives only in the
 * Manual Builder). It states clearly that the checklist is documentation readiness, not regulator
 * approval.
 */
const CATEGORY_WHY: Record<string, string> = {
  identity: "Pembeli harus tahu produk dan versi persis yang didokumentasikan (Perba 12/2022 Pasal 5(4)).",
  installation: "Perba 12/2022 mensyaratkan penjelasan cara instalasi yang dapat diikuti.",
  "how-it-works": "Perba 12/2022 mensyaratkan penjelasan cara kerja dan cara setting yang jujur, tanpa mengarang.",
  risk: "Perba 12/2022 Pasal 5(3)/(5) — bahasa klaim dibatasi dan pernyataan risiko wajib.",
  support: "Perba 12/2022 Pasal 5(4)f/(6) — bantuan 24/7 yang benar-benar beroperasi dan transparansi strategi.",
  performance: "Perba 12/2022 Pasal 4(3)/5(4)e — angka kinerja hanya dengan kondisi ujinya.",
  bappebti: "Kewajiban khusus lingkup PBK Indonesia (disclosure Pasal 9, ekspektasi margin onboarding).",
};

export default function ComplianceReferencePage() {
  const items: ResourceItem[] = CHECKLIST_V1.map((c) => {
    const naReason = notApplicableReason(c.checkKey);
    const canBeNa = naReason !== "Tidak berlaku." || c.bappebtiOnly;
    return {
      id: c.checkKey,
      title: c.label,
      meta: `${CATEGORY_LABELS[c.category] ?? c.category}${c.bappebtiOnly ? " · lingkup PBK" : ""}`,
      keywords: `${c.checkKey} ${c.category} ${CHECKLIST_OWNER_LABEL[checklistOwner(c.checkKey)]}`,
      body: (
        <dl className="ref-item">
          <dt>Mengapa ada</dt>
          <dd>{CATEGORY_WHY[c.category] ?? "Bagian dari checklist kesiapan dokumentasi Smartin."}</dd>
          <dt>Bukti yang diharapkan</dt>
          <dd>{c.label} terdokumentasi pada bab terkait dengan fakta yang benar-benar dikonfirmasi.</dd>
          <dt>Penanggung jawab</dt>
          <dd>{CHECKLIST_OWNER_LABEL[checklistOwner(c.checkKey)]}</dd>
          <dt>Lingkup PBK</dt>
          <dd>{c.bappebtiOnly ? "Hanya berlaku bila EA dalam lingkup PBK Indonesia" : "Berlaku untuk semua EA"}</dd>
          <dt>Dapat ditandai “tidak berlaku”?</dt>
          <dd>
            {canBeNa
              ? `Ya — ${c.bappebtiOnly ? "otomatis N/A bila EA di luar lingkup PBK; " : ""}${
                  naReason !== "Tidak berlaku." ? naReason.replace(/^Tidak berlaku:\s*/, "") : ""
                }`.trim() || "Ya, sesuai kondisi."
              : "Tidak — item wajib untuk setiap EA dalam lingkup."}
          </dd>
          <dt>Menghambat publikasi?</dt>
          <dd>{c.publishBlocking ? "Ya, jika belum lolos / masih perlu ditinjau" : "Tidak"}</dd>
        </dl>
      ),
    };
  });

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Sumber daya"
        title="Referensi Kepatuhan"
        description="Penjelasan setiap pemeriksaan pada checklist kesiapan dokumentasi Smartin — persyaratan, bukti yang diharapkan, penanggung jawab, dan lingkup PBK."
      />
      <section className="card">
        <p className="ref-disclaimer">
          Checklist membantu kesiapan dokumentasi dan bukan persetujuan regulator. Status kesiapan
          per manual hanya muncul di inspektur validasi di dalam Manual Builder.
        </p>
        <ResourceAccordion items={items} searchPlaceholder="Cari pemeriksaan…" />
      </section>
    </div>
  );
}
