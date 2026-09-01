import { PageHeader } from "@/components/page-header";
import { ResourceAccordion, type ResourceItem } from "@/components/resource-accordion";
import { chapterGuidance } from "@/lib/domain/chapter-guidance";

/**
 * UAT-31 — a practical documentation guide. Chapter-scoped topics reuse the same chapter-guidance
 * metadata the builder shows (so instructions never conflict); a few cross-cutting topics are
 * curated. No stale internal-phase wording.
 */
function fromChapter(key: string, extra?: { do?: string[]; dont?: string[] }): ResourceItem | null {
  const g = chapterGuidance(key);
  if (!g) return null;
  const dos = [...g.belongs, ...(extra?.do ?? [])];
  const donts = [...g.doNotAssume, ...(extra?.dont ?? [])];
  return {
    id: key,
    title: g.title,
    meta: `Bab ${String(g.order).padStart(2, "0")}`,
    keywords: `${g.purpose} ${dos.join(" ")} ${donts.join(" ")}`,
    body: (
      <Topic
        purpose={g.purpose}
        dos={dos}
        donts={donts}
        example={g.example}
        chapterRef={`BAB ${String(g.order).padStart(2, "0")} — ${g.title}`}
      />
    ),
  };
}

function Topic({
  purpose,
  dos,
  donts,
  example,
  chapterRef,
}: {
  purpose: string;
  dos: string[];
  donts: string[];
  example?: string;
  chapterRef?: string;
}) {
  return (
    <>
      <p className="guide-purpose">{purpose}</p>
      <div className="guide-cols">
        <div>
          <p className="guide-h guide-do">Lakukan</p>
          <ul>
            {dos.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="guide-h guide-dont">Hindari</p>
          <ul>
            {donts.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      </div>
      {example && <p className="guide-example">Contoh aman: {example}</p>}
      {chapterRef && <p className="guide-chapter-ref">Bab terkait: {chapterRef}</p>}
    </>
  );
}

const CROSS_CUTTING: ResourceItem[] = [
  {
    id: "screenshots",
    title: "Screenshot yang menjelaskan",
    meta: "Lintas bab",
    keywords: "gambar screenshot alt caption instalasi antarmuka",
    body: (
      <Topic
        purpose="Screenshot dipakai untuk menjelaskan posisi, status, atau kontrol tertentu — bukan hiasan."
        dos={[
          "Satu screenshot per klik yang menentukan (Data Folder, Navigator Refresh, izin Algo Trading).",
          "Isi teks alternatif (ALT) yang menjelaskan isi gambar untuk aksesibilitas.",
          "Tulis caption yang mendeskripsikan apa yang ditunjukkan, bukan “Gambar 3”.",
        ]}
        donts={[
          "Jangan menampilkan nomor akun, saldo, atau nama broker asli — samarkan.",
          "Jangan memakai screenshot untuk fitur yang tidak ada pada EA.",
        ]}
        example="Contoh: “Tampilan Navigator setelah klik kanan Expert Advisors → Refresh.”"
        chapterRef="BAB 04 — Instalasi, BAB 10 — Antarmuka EA"
      />
    ),
  },
  {
    id: "claim-language",
    title: "Bahasa klaim yang diperbolehkan",
    meta: "Lintas bab · kepatuhan",
    keywords: "klaim profit winrate bappebti approved certified compliant disclaimer",
    body: (
      <Topic
        purpose="Berlaku untuk setiap bab termasuk judul, caption, dan FAQ (Perba 12/2022 Pasal 5(3))."
        dos={[
          "Sebut EA sebagai alat bantu; hasil tidak dijamin.",
          "Sertakan broker, spread, model, dan rentang tanggal saat menampilkan data uji.",
          'Gunakan “siap untuk review kepatuhan” / “checklist dokumentasi selesai”.',
        ]}
        donts={[
          "“Profit pasti / konsisten / bebas risiko”, “winrate tinggi”, “cocok semua pair”.",
          '“Disetujui Bappebti” / “Bappebti Approved” / “Approved” / “Certified” / “Compliant”.',
          "Framing bagi hasil, MLM/referral, atau EA bertransaksi atas nama klien.",
        ]}
        chapterRef="BAB 08 — Risiko, BAB 15 — Pernyataan Risiko"
      />
    ),
  },
  {
    id: "versioning",
    title: "Versi manual mengikuti rilis EA",
    meta: "Lintas bab",
    keywords: "versi versioning changelog semver manual EA",
    body: (
      <Topic
        purpose="Manual vX.Y tidak boleh menjelaskan perilaku vX.(Y+n). Versi EA dan versi Manual adalah dua konsep terpisah — nilainya boleh sama."
        dos={[
          "Tampilkan Versi EA dan Versi Manual sebagai dua field terpisah di Sampul.",
          'Tulis “Dokumentasi ini berlaku untuk versi X.Y.Z.”.',
          "Tambahkan entri changelog untuk setiap versi EA, termasuk perubahan besar dan dampaknya.",
        ]}
        donts={[
          "Jangan menyebut versi EA lain yang bertentangan dengan EA Version yang tertaut.",
          "Jangan menghilangkan perubahan besar secara diam-diam.",
        ]}
        chapterRef="BAB 00 — Sampul, BAB 14 — Catatan Perubahan"
      />
    ),
  },
];

export default function GuidePage() {
  const chapterTopics = [
    fromChapter("overview"),
    fromChapter("requirements"),
    fromChapter("installation"),
    fromChapter("how-it-works"),
    fromChapter("parameters"),
    fromChapter("risk"),
    fromChapter("presets"),
    fromChapter("performance"),
    fromChapter("troubleshooting"),
    fromChapter("faq"),
    fromChapter("changelog"),
    fromChapter("support"),
    fromChapter("transparency"),
  ].filter((x): x is ResourceItem => x !== null);

  const items: ResourceItem[] = [
    {
      id: "structure",
      title: "Struktur manual & template",
      meta: "Dasar",
      keywords: "struktur 18 bab template kanonik wajib",
      body: (
        <Topic
          purpose="Setiap manual EA memakai 18 bab kanonik. Bab wajib tidak dihapus; bab kondisional (Antarmuka, bab lingkup Bappebti) menjadi N/A sesuai lingkup."
          dos={[
            "Isi bab dari fakta yang benar-benar dikonfirmasi (source-of-truth EA, data organisasi, data kepatuhan).",
            "Gunakan blok terstruktur: langkah, gambar, callout, tabel parameter, FAQ.",
            "Tandai status penyelesaian bab dari kontrol di dekat judul bab.",
          ]}
          donts={[
            "Jangan membuat bab paralel yang menduplikasi fakta yang sudah punya tempat.",
            "Jangan menulis teks hanya untuk memuaskan pemeriksa — dokumentasikan EA-nya.",
          ]}
        />
      ),
    },
    ...chapterTopics,
    ...CROSS_CUTTING,
  ];

  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Sumber daya"
        title="Panduan Dokumentasi"
        description="Panduan praktis untuk menyusun manual EA yang jelas, faktual, dan dapat dipelihara. Instruksi di sini konsisten dengan panduan bab di dalam Manual Builder."
      />
      <section className="card">
        <ResourceAccordion items={items} searchPlaceholder="Cari topik panduan…" />
      </section>
    </div>
  );
}
