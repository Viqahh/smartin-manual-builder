import { AlertTriangle, Info, Lightbulb } from "lucide-react";
import Image from "next/image";
import { BROKER_MIN_LOT_NOTE_ID } from "@/lib/domain/setups";
import { manualIdentity, type ManualViewModel } from "@/lib/manual/view-model";

/**
 * The ONE shared manual renderer (spec §18). It consumes a typed ManualViewModel — no
 * hardcoded product — so the builder preview, and later the public web manual + PDF, all
 * render from the same content model.
 */

type Section = ManualViewModel["sections"][number];
type Block = Section["blocks"][number];

function paragraphsOf(payload: Record<string, unknown>): string[] {
  const content = (payload.content ?? payload.answer) as { paragraphs?: unknown } | undefined;
  const list = content?.paragraphs;
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
}

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
          {paragraphsOf(block.payload).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      );
    case "callout": {
      const tone = String(block.payload.tone ?? "info");
      return (
        <aside className={`manual-callout ${tone}`}>
          <CalloutIcon tone={tone} />
          <div>
            {paragraphsOf(block.payload).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </aside>
      );
    }
    case "steps": {
      const steps = (block.payload.steps as { title?: string; instruction?: string; menuPath?: string }[]) ?? [];
      return (
        <div className="step-list">
          {steps.map((s, i) => (
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
              </div>
            </article>
          ))}
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
          <Image src={asset.signedUrl} width={960} height={540} alt={asset.altText ?? ""} unoptimized />
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
          {paragraphsOf(block.payload).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
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

export function SectionContent({ section, vm }: { section: Section; vm: ManualViewModel }) {
  const injectSetups = section.key === "requirements" || section.key === "presets";
  return (
    <div className="manual-content generic-chapter">
      {section.blocks.length === 0 && !injectSetups && (
        <p className="lead">Bab ini telah disiapkan dari template Smartin. Konten akan disusun pada editor (Phase 3).</p>
      )}
      {section.blocks.map((b) => (
        <BlockView key={b.id} block={b} vm={vm} />
      ))}
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
        <section className="manual-page" key={section.id}>
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
