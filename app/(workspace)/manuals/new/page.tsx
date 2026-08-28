import { CreateManualWizard } from "@/features/manuals/create-manual-wizard";

export default function CreateManualPage() {
  return (
    <div className="wizard-page">
      <div className="wizard-page-heading"><p className="eyebrow">Manual baru</p><h1>Buat Manual Book</h1><p>Masukkan fakta produk sekali, lalu gunakan kembali di seluruh dokumentasi.</p></div>
      <CreateManualWizard />
    </div>
  );
}
