"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ArrowDown, ArrowUp, ImagePlus, Trash2, Upload } from "lucide-react";
import { RichTextEditor } from "./rich-text-editor";
import { arrayMove } from "@/lib/editor/reorder";
import { upgradeRichText, richTextFromParagraphs, type RichText } from "@/lib/domain/rich-text";
import type { OrgImage } from "@/features/images/queries";

export type BlockEditorCtx = {
  images: OrgImage[];
  groups: { id: string; name: string; count: number }[];
  onUploadImage: (file: File, altText: string) => Promise<{ ok: boolean; id?: string; message?: string }>;
  onUpdateImageMeta: (id: string, patch: { altText?: string; caption?: string }) => Promise<void>;
};

type Props = {
  payload: Record<string, unknown>;
  onChange: (payload: Record<string, unknown>) => void;
  readOnly: boolean;
  ctx: BlockEditorCtx;
};

function asRichText(v: unknown): RichText {
  if (v && typeof v === "object" && "schemaVersion" in (v as object)) return v as RichText;
  return richTextFromParagraphs([]);
}

// --------------------------------------------------------------------------- text
function TextBlockEditor({ payload, onChange, readOnly }: Props) {
  return (
    <RichTextEditor
      ariaLabel="Isi blok teks"
      readOnly={readOnly}
      value={upgradeRichText(asRichText(payload.content))}
      onChange={(doc) =>
        onChange({ type: "text", schemaVersion: 1, content: { schemaVersion: 2, format: "doc", doc } })
      }
    />
  );
}

// --------------------------------------------------------------------------- callout
const CALLOUT_TONES = [
  { value: "warning", label: "Peringatan" },
  { value: "info", label: "Info" },
  { value: "tip", label: "Tips" },
] as const;

function CalloutBlockEditor({ payload, onChange, readOnly }: Props) {
  const tone = (payload.tone as string) ?? "info";
  return (
    <div className="callout-editor" data-tone={tone}>
      <div className="segmented" role="radiogroup" aria-label="Jenis callout">
        {CALLOUT_TONES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={tone === t.value}
            disabled={readOnly}
            onClick={() =>
              onChange({ type: "callout", schemaVersion: 1, tone: t.value, content: payload.content })
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <RichTextEditor
        ariaLabel="Isi callout"
        minimalToolbar
        readOnly={readOnly}
        value={upgradeRichText(asRichText(payload.content))}
        onChange={(doc) =>
          onChange({ type: "callout", schemaVersion: 1, tone, content: { schemaVersion: 2, format: "doc", doc } })
        }
      />
    </div>
  );
}

// --------------------------------------------------------------------------- faq
function FaqBlockEditor({ payload, onChange, readOnly }: Props) {
  const question = (payload.question as string) ?? "";
  return (
    <div className="faq-editor">
      <label className="form-field">
        <span>Pertanyaan</span>
        <input
          value={question}
          disabled={readOnly}
          maxLength={500}
          onChange={(e) =>
            onChange({ type: "faq", schemaVersion: 1, question: e.target.value, answer: payload.answer })
          }
        />
      </label>
      <label className="form-field">
        <span>Jawaban</span>
      </label>
      <RichTextEditor
        ariaLabel="Jawaban FAQ"
        minimalToolbar
        readOnly={readOnly}
        value={upgradeRichText(asRichText(payload.answer))}
        onChange={(doc) =>
          onChange({ type: "faq", schemaVersion: 1, question, answer: { schemaVersion: 2, format: "doc", doc } })
        }
      />
    </div>
  );
}

// --------------------------------------------------------------------------- steps
type StepShape = { title: string; instruction: string; menuPath?: string; imageAssetId?: string };

function StepsBlockEditor({ payload, onChange, readOnly, ctx }: Props) {
  const steps = ((payload.steps as StepShape[]) ?? []).map((s) => ({ ...s }));
  const emit = (next: StepShape[]) => onChange({ type: "steps", schemaVersion: 1, steps: next });
  const patch = (i: number, p: Partial<StepShape>) => emit(steps.map((s, idx) => (idx === i ? { ...s, ...p } : s)));
  const move = (i: number, dir: -1 | 1) => emit(arrayMove(steps, i, i + dir));

  return (
    <ol className="steps-editor">
      {steps.map((s, i) => (
        <li key={i} className="steps-editor-row">
          <div className="steps-editor-index" aria-hidden="true">{i + 1}</div>
          <div className="steps-editor-fields">
            <label className="form-field">
              <span>Judul langkah</span>
              <input value={s.title} disabled={readOnly} maxLength={200} onChange={(e) => patch(i, { title: e.target.value })} />
            </label>
            <label className="form-field">
              <span>Instruksi</span>
              <textarea rows={2} value={s.instruction} disabled={readOnly} maxLength={2000} onChange={(e) => patch(i, { instruction: e.target.value })} />
            </label>
            <label className="form-field">
              <span>Menu / jalur (opsional)</span>
              <input value={s.menuPath ?? ""} disabled={readOnly} maxLength={300} onChange={(e) => patch(i, { menuPath: e.target.value || undefined })} />
            </label>
            <label className="form-field">
              <span>Gambar (opsional)</span>
              <select
                value={s.imageAssetId ?? ""}
                disabled={readOnly}
                onChange={(e) => patch(i, { imageAssetId: e.target.value || undefined })}
              >
                <option value="">— tidak ada —</option>
                {ctx.images.map((img) => (
                  <option key={img.id} value={img.id}>
                    {img.altText || img.caption || img.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!readOnly && (
            <div className="steps-editor-actions">
              <button type="button" aria-label={`Naikkan langkah ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp aria-hidden="true" size={14} />
              </button>
              <button type="button" aria-label={`Turunkan langkah ${i + 1}`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown aria-hidden="true" size={14} />
              </button>
              <button
                type="button"
                aria-label={`Hapus langkah ${i + 1}`}
                disabled={steps.length <= 1}
                onClick={() => emit(steps.filter((_, idx) => idx !== i))}
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
            </div>
          )}
        </li>
      ))}
      {!readOnly && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => emit([...steps, { title: "", instruction: "" }])}
        >
          Tambah langkah
        </button>
      )}
    </ol>
  );
}

// --------------------------------------------------------------------------- image
function ImageBlockEditor({ payload, onChange, readOnly, ctx }: Props) {
  const assetId = (payload.imageAssetId as string) ?? "";
  const asset = ctx.images.find((i) => i.id === assetId);
  const [alt, setAlt] = useState(asset?.altText ?? "");
  const [caption, setCaption] = useState((payload.caption as string) ?? asset?.caption ?? "");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onFile = async (file: File) => {
    setUploading(true);
    setErr(null);
    const res = await ctx.onUploadImage(file, alt);
    setUploading(false);
    if (res.ok && res.id) {
      onChange({ type: "image", schemaVersion: 1, imageAssetId: res.id, caption: caption || undefined });
    } else {
      setErr(res.message ?? "Gagal mengunggah gambar.");
    }
  };

  return (
    <div className="image-editor">
      {asset?.signedUrl ? (
        <figure className="image-editor-preview">
          <Image src={asset.signedUrl} width={640} height={360} alt={asset.altText ?? ""} unoptimized />
        </figure>
      ) : (
        <div className="image-editor-empty">
          <ImagePlus aria-hidden="true" size={22} />
          <p>Belum ada gambar dipilih.</p>
        </div>
      )}

      {!readOnly && (
        <>
          <div className="image-editor-controls">
            <select
              value={assetId}
              aria-label="Pilih gambar yang sudah ada"
              onChange={(e) => {
                const id = e.target.value;
                const picked = ctx.images.find((i) => i.id === id);
                setAlt(picked?.altText ?? "");
                setCaption(picked?.caption ?? "");
                onChange({ type: "image", schemaVersion: 1, imageAssetId: id, caption: picked?.caption || undefined });
              }}
            >
              <option value="">— pilih gambar —</option>
              {ctx.images.map((img) => (
                <option key={img.id} value={img.id}>
                  {img.altText || img.caption || img.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <button type="button" className="secondary-button" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Upload aria-hidden="true" size={15} /> {uploading ? "Mengunggah…" : "Unggah baru"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
          </div>
          {err && (
            <p className="field-error" role="alert">
              {err}
            </p>
          )}
          <label className="form-field">
            <span>Teks alternatif (ALT) — wajib untuk menandai bab selesai</span>
            <input
              value={alt}
              maxLength={300}
              aria-invalid={assetId !== "" && alt.trim() === ""}
              onChange={(e) => setAlt(e.target.value)}
              onBlur={() => assetId && void ctx.onUpdateImageMeta(assetId, { altText: alt })}
            />
            {assetId !== "" && alt.trim() === "" && (
              <small className="field-error">ALT kosong: bab tidak bisa ditandai selesai sampai ALT diisi.</small>
            )}
          </label>
          <label className="form-field">
            <span>Keterangan (caption)</span>
            <input
              value={caption}
              maxLength={500}
              onChange={(e) => setCaption(e.target.value)}
              onBlur={() => {
                if (assetId) void ctx.onUpdateImageMeta(assetId, { caption });
                onChange({ type: "image", schemaVersion: 1, imageAssetId: assetId, caption: caption || undefined });
              }}
            />
          </label>
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- parameterTable
function ParameterTableBlockEditor({ payload, onChange, readOnly, ctx }: Props) {
  const groupIds = (payload.groupIds as string[]) ?? [];
  const toggle = (id: string) => {
    const next = groupIds.includes(id) ? groupIds.filter((g) => g !== id) : [...groupIds, id];
    onChange({ type: "parameterTable", schemaVersion: 1, groupIds: next });
  };
  if (ctx.groups.length === 0) {
    return (
      <p className="param-empty">
        Belum ada grup parameter pada EA Version ini. Buat grup di halaman Produk EA terlebih dahulu.
      </p>
    );
  }
  return (
    <fieldset className="param-table-editor" disabled={readOnly}>
      <legend>Grup parameter dari EA Version ini</legend>
      {ctx.groups.map((g) => (
        <label key={g.id} className="param-table-choice">
          <input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => toggle(g.id)} />
          <span>
            <strong>{g.name}</strong> <small>{g.count} parameter</small>
          </span>
        </label>
      ))}
      {groupIds.length === 0 && <p className="field-error">Pilih setidaknya satu grup.</p>}
    </fieldset>
  );
}

// --------------------------------------------------------------------------- dispatch
export function BlockEditor(props: Props & { blockType: string }) {
  switch (props.blockType) {
    case "text":
      return <TextBlockEditor {...props} />;
    case "callout":
      return <CalloutBlockEditor {...props} />;
    case "faq":
      return <FaqBlockEditor {...props} />;
    case "steps":
      return <StepsBlockEditor {...props} />;
    case "image":
      return <ImageBlockEditor {...props} />;
    case "parameterTable":
      return <ParameterTableBlockEditor {...props} />;
    default:
      return <p className="field-error">Tipe blok tidak dikenal: {props.blockType}</p>;
  }
}
