"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ArrowDown, ArrowUp, ImagePlus, Trash2, Upload } from "lucide-react";
import { RichTextEditor } from "./rich-text-editor";
import { arrayMove } from "@/lib/editor/reorder";
import { upgradeRichText, richTextFromParagraphs, type RichText } from "@/lib/domain/rich-text";
import { faqItems } from "@/lib/domain/blocks";
import type { OrgImage } from "@/features/images/queries";
import type { ParameterGroupWithParams } from "@/features/parameters/queries";
import { InlineParameterManager } from "@/features/parameters/inline-parameter-manager";

export type BlockEditorCtx = {
  images: OrgImage[];
  groups: { id: string; name: string; count: number }[];
  onUploadImage: (file: File, altText: string) => Promise<{ ok: boolean; id?: string; message?: string }>;
  onUpdateImageMeta: (id: string, patch: { altText?: string; caption?: string }) => Promise<void>;
  /** full parameter definitions of the linked EA Version (GI-11 source of truth) + inline mgmt hooks */
  eaVersionId: string;
  parameterGroupsFull: ParameterGroupWithParams[];
  onParametersChanged: () => void;
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
      placeholder="Tulis konten bab di sini…"
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
        placeholder="Tulis isi callout…"
        value={upgradeRichText(asRichText(payload.content))}
        onChange={(doc) =>
          onChange({ type: "callout", schemaVersion: 1, tone, content: { schemaVersion: 2, format: "doc", doc } })
        }
      />
    </div>
  );
}

// --------------------------------------------------------------------------- faq (multi-item, UAT-20)
type FaqRow = { question: string; answer: unknown };

function FaqBlockEditor({ payload, onChange, readOnly }: Props) {
  const items: FaqRow[] = faqItems(payload);
  // only the currently-edited item is expanded; others collapse to a compact question row
  const [open, setOpen] = useState<number>(items.length <= 1 ? 0 : -1);

  const emit = (next: FaqRow[]) =>
    onChange({ type: "faq", schemaVersion: 2, items: next.map((r) => ({ question: r.question, answer: r.answer })) });
  const patch = (i: number, p: Partial<FaqRow>) => emit(items.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const move = (i: number, dir: -1 | 1) => {
    emit(arrayMove(items, i, i + dir));
    setOpen(i + dir);
  };
  const remove = (i: number) => {
    emit(items.filter((_, idx) => idx !== i));
    setOpen(-1);
  };
  const add = () => {
    emit([...items, { question: "", answer: richTextFromParagraphs([]) }]);
    setOpen(items.length);
  };

  if (readOnly) {
    return (
      <div className="faq-editor">
        {items.map((r, i) => (
          <div className="faq-ro-item" key={i}>
            <h4>{r.question || "—"}</h4>
            <RichTextEditor ariaLabel="Jawaban FAQ" minimalToolbar readOnly value={upgradeRichText(asRichText(r.answer))} onChange={() => {}} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="faq-editor">
      <ol className="faq-item-list">
        {items.map((r, i) => {
          const expanded = open === i;
          return (
            <li className="faq-item" key={i} data-expanded={expanded}>
              <div className="faq-item-head">
                <button
                  type="button"
                  className="faq-item-toggle"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? -1 : i)}
                >
                  <span className="faq-item-q">{r.question.trim() || `Pertanyaan ${i + 1}`}</span>
                </button>
                <div className="faq-item-actions">
                  <button type="button" aria-label={`Naikkan pertanyaan ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp aria-hidden="true" size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Turunkan pertanyaan ${i + 1}`}
                    disabled={i === items.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown aria-hidden="true" size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Hapus pertanyaan ${i + 1}`}
                    disabled={items.length <= 1}
                    onClick={() => remove(i)}
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </button>
                </div>
              </div>
              {expanded && (
                <div className="faq-item-body">
                  <label className="form-field">
                    <span>Pertanyaan</span>
                    <input
                      value={r.question}
                      maxLength={500}
                      placeholder="Contoh: EA tidak muncul di Navigator"
                      onChange={(e) => patch(i, { question: e.target.value })}
                    />
                  </label>
                  <label className="form-field">
                    <span>Jawaban</span>
                  </label>
                  <RichTextEditor
                    ariaLabel="Jawaban FAQ"
                    minimalToolbar
                    placeholder="Tulis jawaban singkat dan konsisten dengan bab lain…"
                    value={upgradeRichText(asRichText(r.answer))}
                    onChange={(doc) => patch(i, { answer: { schemaVersion: 2, format: "doc", doc } })}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <button type="button" className="secondary-button faq-add" onClick={add}>
        + Tambah pertanyaan
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------- steps
type StepShape = { title: string; instruction: string; menuPath?: string; imageAssetId?: string };

/** Per-step image control (UAT-07): upload directly OR pick from the library, with preview + ALT + caption. */
function StepImagePicker({
  assetId,
  onPick,
  ctx,
}: {
  assetId: string | undefined;
  onPick: (id: string | undefined) => void;
  ctx: BlockEditorCtx;
}) {
  const asset = ctx.images.find((i) => i.id === assetId);
  const [alt, setAlt] = useState(asset?.altText ?? "");
  const [caption, setCaption] = useState(asset?.caption ?? "");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const onFile = async (file: File) => {
    setUploading(true);
    setErr(null);
    const res = await ctx.onUploadImage(file, alt);
    setUploading(false);
    if (res.ok && res.id) onPick(res.id);
    else setErr(res.message ?? "Gagal mengunggah gambar.");
  };

  return (
    <div className="step-image">
      <span className="step-image-label">Gambar (opsional)</span>
      {asset?.signedUrl ? (
        <figure className="step-image-preview">
          <Image src={asset.signedUrl} width={320} height={180} alt={asset.altText ?? ""} unoptimized />
        </figure>
      ) : null}
      <div className="step-image-controls">
        <button type="button" className="secondary-button" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden="true" size={14} /> {uploading ? "Mengunggah…" : "Upload gambar"}
        </button>
        <select
          aria-label="Pilih dari library"
          value={assetId ?? ""}
          onChange={(e) => {
            const id = e.target.value || undefined;
            const picked = ctx.images.find((x) => x.id === id);
            setAlt(picked?.altText ?? "");
            setCaption(picked?.caption ?? "");
            onPick(id);
          }}
        >
          <option value="">Pilih dari library…</option>
          {ctx.images.map((img) => (
            <option key={img.id} value={img.id}>
              {img.altText || img.caption || img.id.slice(0, 8)}
            </option>
          ))}
        </select>
        {assetId && (
          <button type="button" className="link-button" onClick={() => onPick(undefined)}>
            Hapus gambar
          </button>
        )}
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
      {err && <p className="field-error" role="alert">{err}</p>}
      {assetId && (
        <div className="step-image-meta">
          <label className="form-field">
            <span>Teks alternatif (ALT)</span>
            <input
              value={alt}
              maxLength={300}
              placeholder="Jelaskan isi gambar untuk aksesibilitas"
              onChange={(e) => setAlt(e.target.value)}
              onBlur={() => void ctx.onUpdateImageMeta(assetId, { altText: alt })}
            />
          </label>
          <label className="form-field">
            <span>Keterangan (caption)</span>
            <input
              value={caption}
              maxLength={500}
              placeholder="Contoh: Tampilan Navigator setelah Refresh"
              onChange={(e) => setCaption(e.target.value)}
              onBlur={() => void ctx.onUpdateImageMeta(assetId, { caption })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

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
              <input
                value={s.title}
                disabled={readOnly}
                maxLength={200}
                placeholder="Contoh: Buka folder Experts"
                onChange={(e) => patch(i, { title: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>Instruksi</span>
              <textarea
                rows={2}
                value={s.instruction}
                disabled={readOnly}
                maxLength={2000}
                placeholder="Jelaskan tindakan yang harus dilakukan…"
                onChange={(e) => patch(i, { instruction: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>Menu / jalur (opsional)</span>
              <input
                value={s.menuPath ?? ""}
                disabled={readOnly}
                maxLength={300}
                placeholder="Contoh: File > Open Data Folder"
                onChange={(e) => patch(i, { menuPath: e.target.value || undefined })}
              />
            </label>
            {!readOnly && (
              <StepImagePicker
                assetId={s.imageAssetId}
                onPick={(id) => patch(i, { imageAssetId: id })}
                ctx={ctx}
              />
            )}
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
              placeholder="Jelaskan isi gambar untuk aksesibilitas"
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
              placeholder="Contoh: Tampilan EA pada chart XAUUSD"
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
  const [manage, setManage] = useState(false);
  const toggle = (id: string) => {
    const next = groupIds.includes(id) ? groupIds.filter((g) => g !== id) : [...groupIds, id];
    onChange({ type: "parameterTable", schemaVersion: 1, groupIds: next });
  };
  const shownGroups = ctx.parameterGroupsFull.filter(
    (g) => groupIds.length === 0 || groupIds.includes(g.id),
  );

  // no parameters yet on the linked EA Version — recover in-context, no page hop (UAT-10)
  if (ctx.groups.length === 0) {
    return (
      <div className="param-table-editor">
        <p className="param-empty">Belum ada parameter untuk EA Version ini.</p>
        {!readOnly &&
          (manage ? (
            <InlineParameterManager
              eaVersionId={ctx.eaVersionId}
              initialGroups={ctx.parameterGroupsFull}
              onChanged={ctx.onParametersChanged}
              onClose={() => setManage(false)}
            />
          ) : (
            <button type="button" className="secondary-button" onClick={() => setManage(true)}>
              + Tambah parameter
            </button>
          ))}
      </div>
    );
  }

  return (
    <div className="param-table-editor">
      <fieldset disabled={readOnly}>
        <legend>Grup parameter dari EA Version ini</legend>
        {ctx.groups.map((g) => (
          <label key={g.id} className="param-table-choice">
            <input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => toggle(g.id)} />
            <span>
              <strong>{g.name}</strong> <small>{g.count} parameter</small>
            </span>
          </label>
        ))}
        {groupIds.length === 0 && <p className="field-hint">Belum ada grup dipilih — semua grup akan ditampilkan.</p>}
      </fieldset>

      {/* UAT-14: compact in-context preview of the actual parameter content */}
      {shownGroups.map((g) => (
        <div className="param-preview" key={g.id}>
          <p className="param-preview-title">{g.name}</p>
          {g.parameters.length === 0 ? (
            <p className="param-empty">Grup ini belum berisi parameter.</p>
          ) : (
            <table className="param-preview-table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Technical</th>
                  <th>Type</th>
                  <th>Default</th>
                </tr>
              </thead>
              <tbody>
                {g.parameters.slice(0, 12).map((p) => (
                  <tr key={p.id}>
                    <td>{p.display_name}</td>
                    <td className="mono">{p.technical_name}</td>
                    <td>{p.param_type}</td>
                    <td className="mono">{p.default_value ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {g.parameters.length > 12 && <p className="param-preview-more">+{g.parameters.length - 12} parameter lain</p>}
        </div>
      ))}

      {!readOnly && (
        <div className="param-table-manage">
          {manage ? (
            <InlineParameterManager
              eaVersionId={ctx.eaVersionId}
              initialGroups={ctx.parameterGroupsFull}
              onChanged={ctx.onParametersChanged}
              onClose={() => setManage(false)}
            />
          ) : (
            <button type="button" className="secondary-button" onClick={() => setManage(true)}>
              + Tambah / Kelola parameter
            </button>
          )}
        </div>
      )}
    </div>
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
