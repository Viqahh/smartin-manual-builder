import { AlertTriangle, Info, Lightbulb } from "lucide-react";
import { BROKER_MIN_LOT_NOTE_ID } from "@/lib/domain/setups";
import { chapterAnchor, manualIdentity, type ManualViewModel } from "@/lib/manual/view-model";
import { RichTextView } from "./rich-text-view";

/**
 * The ONE shared manual renderer (spec §18). It consumes a typed ManualViewModel — no
 * hardcoded product — so the builder preview, and later the public web manual + PDF, all
 * render from the same content model.
 */

type Section = ManualViewModel["sections"][number];
type Block = Section["blocks"][number];

function CalloutIcon({ tone }: { tone: string }) {
  if (tone === "warning") return <AlertTriangle aria-hidden="true" />;
  if (tone === "tip") return <Lightbulb aria-hidden="true" />;
  return <Info aria-hidden="true" />;
}

function BlockView({ block, vm }: { block: Block; vm: ManualViewModel }) {
  switch (block.type) {
    case "text":
      return (
        <div className="manual-content">
          <RichTextView value={block.payload.content} />
        </div>
      );
    case "callout": {
      const tone = String(block.payload.tone ?? "info");
      return (
        <aside className={`manual-callout ${tone}`}>
          <CalloutIcon tone={tone} />
          <div>
            <RichTextView value={block.payload.content} />
          </div>
        </aside>
      );
    }
    case "steps": {
      const steps =
        (block.payload.steps as {
          title?: string;
          instruction?: string;
          menuPath?: string;
          imageAssetId?: string;
        }[]) ?? [];
      return (
        <div className="step-list">
          {steps.map((s, i) => {
            // same publication-local image namespace as image blocks; missing object => no image,
            // the surrounding step still renders (never crashes the manual).
            const img = s.imageAssetId ? vm.images[s.imageAssetId] : undefined;
            return (
              <article key={i}>
                <span>{i + 1}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.instruction}</p>
                  {s.menuPath && (
                    <p>
                      <code>{s.menuPath}</code>
                    </p>
                  )}
                  {img?.signedUrl && (
                    <figure className="manual-step-image">
                      {/* eslint-disable-next-line @next/next/no-img-element -- proxy/signed URL, no optimization; natural aspect ratio */}
                      <img src={img.signedUrl} alt={img.altText ?? ""} />
                      {img.caption && <figcaption>{img.caption}</figcaption>}
                    </figure>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      );
    }
    case "image": {
      const asset = block.imageAssetId ? vm.images[block.imageAssetId] : undefined;
      if (!asset?.signedUrl) {
        return <p className="manual-image-missing">[gambar belum tersedia]</p>;
      }
      return (
        <figure className="manual-image-block">
          {/* eslint-disable-next-line @next/next/no-img-element -- proxy/signed URL, no optimization; natural aspect ratio */}
          <img src={asset.signedUrl} alt={asset.altText ?? ""} />
          {(asset.caption || (block.payload.caption as string)) && (
            <figcaption>{asset.caption ?? (block.payload.caption as string)}</figcaption>
          )}
        </figure>
      );
    }
    case "parameterTable": {
      const groups = vm.parameterGroups.filter((g) => block.parameterGroupIds.includes(g.id));
      const shown = groups.length ? groups : vm.parameterGroups;
      return (
        <div className="manual-content">
          {shown.map((g) => (
            <div key={g.id}>
              <div className="parameter-group-heading">
                <div>
                  <div>
                    <h3>{g.name}</h3>
                    <p>{g.parameters.length} parameter</p>
                  </div>
                </div>
              </div>
              <div className="manual-table-wrap">
                <table className="parameter-table">
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th>Tipe</th>
                      <th>Default</th>
                      <th>Rentang aman</th>
                      <th>Efek pada order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.parameters.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.displayName}</strong>
                          <code>{p.technicalName}</code>
                        </td>
                        <td>
                          <code>{p.paramType}</code>
                        </td>
                        <td>
                          <code>{p.defaultValue ?? "—"}</code>
                        </td>
                        <td>{p.safeRange ?? "—"}</td>
                        <td>{p.orderEffect ?? p.description ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      );
    }
    case "faq":
      return (
        <div className="manual-content">
          <h3>{String(block.payload.question ?? "")}</h3>
          <RichTextView value={block.payload.answer} />
        </div>
      );
    default:
      return null;
  }
}

function SupportedConfigTable({ vm }: { vm: ManualViewModel }) {
  if (vm.supportedSetups.length === 0) return null;
  return (
    <div className="manual-content">
      <div className="manual-table-wrap">
        <table className="parameter-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Timeframe</th>
              <th>Preset</th>
              <th>Tested Minimum Lot</th>
              <th>Didukung</th>
            </tr>
          </thead>
          <tbody>
            {vm.supportedSetups.map((s) => (
              <tr key={s.id}>
                <td className="mono">{s.symbol}</td>
                <td className="mono">{s.timeframe}</td>
                <td>{s.presetRef ?? "—"}</td>
                <td>{s.testedMinimumLot === null ? "—" : `${s.testedMinimumLot} (data uji developer)`}</td>
                <td>{s.isSupported ? "Ya" : "Tidak"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <aside className="manual-callout info">
        <Info aria-hidden="true" />
        <div>
          <p>{BROKER_MIN_LOT_NOTE_ID}</p>
        </div>
      </aside>
    </div>
  );
}

export function SectionContent({
  section,
  vm,
  anchored = false,
}: {
  section: Section;
  vm: ManualViewModel;
  /** wrap each block in a `[data-block-id]` element so review-comment anchors can focus it (§17). */
  anchored?: boolean;
}) {
  const injectSetups = section.key === "requirements" || section.key === "presets";
  return (
    <div className="manual-content generic-chapter">
      {section.blocks.length === 0 && !injectSetups && (
        <p className="lead">Bab ini telah disiapkan dari template Smartin. Konten akan disusun pada editor (Phase 3).</p>
      )}
      {section.blocks.map((b) =>
        anchored ? (
          <div key={b.id} data-block-id={b.id} className="rc-anchor-block">
            <BlockView block={b} vm={vm} />
          </div>
        ) : (
          <BlockView key={b.id} block={b} vm={vm} />
        ),
      )}
      {injectSetups && <SupportedConfigTable vm={vm} />}
      {section.completionState === "issue" && (
        <aside className="manual-callout warning">
          <AlertTriangle aria-hidden="true" />
          <div>
            <p>Perlu verifikasi teknis sebelum bab ini dikirim ke reviewer.</p>
          </div>
        </aside>
      )}
    </div>
  );
}

export function ManualRenderer({ vm }: { vm: ManualViewModel }) {
  const id = manualIdentity(vm);
  return (
    <article className="a4-document">
      <section className="manual-cover">
        <div className="manual-cover-brand">
          <span>S</span>
          <div>
            <strong>SMARTIN</strong>
            <small>{id.organization}</small>
          </div>
        </div>
        <div className="manual-cover-copy">
          <p>EXPERT ADVISOR MANUAL</p>
          <h1>{id.eaName}</h1>
          <h2>User Manual Book</h2>
          <div className="cover-rule" />
          <dl>
            <div>
              <dt>Platform</dt>
              <dd>{id.platform}</dd>
            </div>
            <div>
              <dt>EA Version</dt>
              <dd className="mono">{id.eaVersion}</dd>
            </div>
            <div>
              <dt>Manual Version</dt>
              <dd className="mono">{id.manualVersion}</dd>
            </div>
            <div>
              <dt>Release Date</dt>
              <dd>{id.releaseDate ?? "—"}</dd>
            </div>
          </dl>
        </div>
        <footer>
          <span>{id.organization}</span>
          <span>{id.developer ? `Developer: ${id.developer}` : "Sample / Demo Document"}</span>
        </footer>
      </section>

      {vm.sections.map((section, index) => (
        // `id` is a deterministic, publication-safe chapter anchor (no DB identity); harmless in
        // the workspace preview and future PDF. TOC + search deep-link to it.
        <section className="manual-page" key={section.id} id={chapterAnchor(index)}>
          <header>
            <span>{id.eaName} · User Manual</span>
            <span>Version {id.manualVersion}</span>
          </header>
          <div className="manual-page-body">
            <p className="chapter-kicker">
              {String(section.position).padStart(2, "0")} · {section.title.toUpperCase()}
            </p>
            <h2>{section.title}</h2>
            <SectionContent section={section} vm={vm} />
          </div>
          <footer>
            <span>SMARTIN MANUAL BUILDER</span>
            <span>{index + 2}</span>
          </footer>
        </section>
      ))}
    </article>
  );
}
