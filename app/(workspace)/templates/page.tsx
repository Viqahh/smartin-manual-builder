import { PageHeader } from "@/components/page-header";
import { ResourceAccordion, type ResourceItem } from "@/components/resource-accordion";
import { allChapterGuidance } from "@/lib/domain/chapter-guidance";

const BLOCK_LABEL: Record<string, string> = {
  text: "Teks",
  steps: "Langkah instalasi",
  image: "Gambar",
  callout: "Callout",
  parameterTable: "Tabel parameter",
  faq: "FAQ",
};

/**
 * UAT-30 — a live, READ-ONLY reference for the canonical Smartin manual template, generated from
 * the same chapter-guidance metadata the builder uses. No stale "Phase N" copy, no fake buttons.
 * Full Admin template lifecycle (versioned template editing) needs a schema + product decision and
 * is intentionally deferred; this page is the authoritative structure reference in the meantime.
 */
export default function TemplatesPage() {
  const chapters = allChapterGuidance();
  const items: ResourceItem[] = chapters.map((g) => ({
    id: g.key,
    title: `BAB ${String(g.order).padStart(2, "0")} — ${g.title}`,
    meta: g.required ? "Wajib" : "Kondisional / opsional",
    keywords: `${g.purpose} ${g.belongs.join(" ")} ${g.suggestedBlocks.join(" ")}`,
    body: (
      <>
        <p className="tpl-purpose">{g.purpose}</p>
        <p className="tpl-h">Fakta yang termasuk di bab ini</p>
        <ul>
          {g.belongs.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
        {g.doNotAssume.length > 0 && (
          <>
            <p className="tpl-h">Jangan diasumsikan / dikarang</p>
            <ul className="tpl-dont">
              {g.doNotAssume.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </>
        )}
        <p className="tpl-suggested">
          Blok yang disarankan: {g.suggestedBlocks.map((b) => BLOCK_LABEL[b] ?? b).join(" · ")}
        </p>
        {g.example && <p className="tpl-example">{g.example}</p>}
      </>
    ),
  }));

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Dokumentasi"
        title="Template Manual EA Standar"
        description="Struktur baku 18 bab. Setiap manual EA baru dibuat dari template ini; bab wajib tidak dapat dihapus dan judulnya tidak dapat diubah, tetapi isinya selalu dapat diedit."
      />
      <section className="card">
        <p className="tpl-note">
          {chapters.length} bab · {chapters.filter((c) => c.required).length} bab wajib. Referensi ini
          hanya dibaca — penyuntingan konten dilakukan di dalam Manual Builder per manual.
        </p>
        <ResourceAccordion items={items} searchPlaceholder="Cari bab atau topik…" />
      </section>
    </div>
  );
}
