"use client";

import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  Eye,
  FileText,
  Info,
  LockKeyhole,
  PanelLeft,
  PanelRight,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { SectionContent } from "@/components/manual-renderer/manual-renderer";
import { manualIdentity, type ManualViewModel } from "@/lib/manual/view-model";
import { STATUS_LABELS } from "./manual-table";
import { SAVE_STATE_LABEL, DEFAULT_AUTOSAVE_DEBOUNCE_MS, type SaveState } from "@/lib/domain/autosave";
import { saveSection } from "./autosave-actions";

type Section = ManualViewModel["sections"][number];
type CompletionState = Section["completionState"];

const COMPLETION_LABEL: Record<CompletionState, string> = {
  incomplete: "Belum lengkap",
  in_progress: "Sedang dikerjakan",
  complete: "Selesai",
  issue: "Ada masalah",
};

function StateIcon({ state }: { state: CompletionState | "current" }) {
  if (state === "complete") return <Check aria-label="Selesai" size={14} />;
  if (state === "issue") return <AlertTriangle aria-label="Ada masalah" size={14} />;
  if (state === "current") return <span className="current-dot" aria-label="Sedang diedit" />;
  return <Circle aria-label="Belum lengkap" size={13} />;
}

function ChapterPanel({
  sections,
  selectedId,
  progress,
  completedCount,
  onSelect,
  onClose,
}: {
  sections: Section[];
  selectedId: string;
  progress: number;
  completedCount: number;
  onSelect: (id: string) => void;
  onClose?: () => void;
}) {
  return (
    <aside className="chapter-panel" aria-label="Navigasi bab">
      {onClose && (
        <button className="icon-button panel-close" aria-label="Tutup daftar bab" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      )}
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Manual Book</p>
          <h2>Daftar bab</h2>
        </div>
        <span>{progress}%</span>
      </div>
      <div className="overall-progress">
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className="progress-copy">
        {completedCount} dari {sections.length} bab ditandai selesai
      </p>
      <nav className="chapter-list">
        {sections.map((chapter) => (
          <button
            key={chapter.id}
            data-active={selectedId === chapter.id}
            data-state={chapter.completionState}
            onClick={() => {
              onSelect(chapter.id);
              onClose?.();
            }}
          >
            <span className="chapter-state">
              <StateIcon state={selectedId === chapter.id ? "current" : chapter.completionState} />
            </span>
            <span className="chapter-copy">
              <small>BAB {String(chapter.position).padStart(2, "0")}</small>
              <strong>{chapter.title}</strong>
            </span>
            {chapter.required && <LockKeyhole aria-label="Bab wajib" size={13} />}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function Inspector({
  identity,
  section,
  progress,
  saveState,
  tab,
  canEdit,
  onTab,
  onSetCompletion,
  onClose,
}: {
  identity: ReturnType<typeof manualIdentity>;
  section: Section | undefined;
  progress: number;
  saveState: SaveState;
  tab: "Validasi" | "Metadata";
  canEdit: boolean;
  onTab: (t: "Validasi" | "Metadata") => void;
  onSetCompletion: (s: CompletionState) => void;
  onClose?: () => void;
}) {
  return (
    <aside className="inspector-panel" aria-label="Inspector manual">
      {onClose && (
        <button className="icon-button panel-close" aria-label="Tutup inspector" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      )}
      <div className="inspector-tabs" role="tablist" aria-label="Inspector">
        {(["Validasi", "Metadata"] as const).map((item) => (
          <button role="tab" aria-selected={tab === item} key={item} onClick={() => onTab(item)}>
            {item}
          </button>
        ))}
      </div>
      {tab === "Validasi" ? (
        <div className="inspector-content">
          <div className="inspector-score">
            <span>
              {progress}
              <small>%</small>
            </span>
            <div>
              <strong>Kelengkapan bab</strong>
              <p>Ditandai manual (Phase 2)</p>
            </div>
          </div>
          <section>
            <h3>Status bab ini</h3>
            {canEdit ? (
              <>
                <div className="chapter-status-buttons">
                  {(["incomplete", "in_progress", "complete", "issue"] as const).map((s) => (
                    <button
                      key={s}
                      className="secondary-button"
                      data-active={section?.completionState === s}
                      onClick={() => onSetCompletion(s)}
                    >
                      {COMPLETION_LABEL[s]}
                    </button>
                  ))}
                </div>
                <p className="save-state" role="status">
                  <Save aria-hidden="true" size={14} /> {SAVE_STATE_LABEL[saveState]}
                </p>
              </>
            ) : (
              <p className="chapter-status-readonly">
                <StateIcon state={section?.completionState ?? "incomplete"} />
                {COMPLETION_LABEL[section?.completionState ?? "incomplete"]}
                <span className="readonly-flag">Baca-saja</span>
              </p>
            )}
          </section>
          <section>
            <h3>Asisten penulisan</h3>
            <button className="ai-placeholder" disabled title="Asisten AI direncanakan untuk Phase 4">
              <Sparkles aria-hidden="true" />
              <span>
                <strong>AI Assistant</strong>
                <small>Tersedia pada Phase 4</small>
              </span>
            </button>
          </section>
          <div className="compliance-note">
            <Info aria-hidden="true" />
            <p>Skor ini mengukur kelengkapan dokumentasi, bukan persetujuan hukum atau regulator.</p>
          </div>
        </div>
      ) : (
        <div className="inspector-content metadata-list">
          <section>
            <h3>Produk</h3>
            <dl>
              <div>
                <dt>EA</dt>
                <dd>{identity.eaName}</dd>
              </div>
              <div>
                <dt>Platform</dt>
                <dd>{identity.platform}</dd>
              </div>
              <div>
                <dt>Versi EA</dt>
                <dd className="mono">{identity.eaVersion}</dd>
              </div>
              <div>
                <dt>Versi manual</dt>
                <dd className="mono">{identity.manualVersion}</dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>Kepemilikan</h3>
            <dl>
              <div>
                <dt>Developer</dt>
                <dd>{identity.developer ?? "—"}</dd>
              </div>
              <div>
                <dt>Organisasi</dt>
                <dd>{identity.organization}</dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </aside>
  );
}

export function ManualBuilder({ vm, canEdit = false }: { vm: ManualViewModel; canEdit?: boolean }) {
  const identity = manualIdentity(vm);
  const [selectedId, setSelectedId] = useState(vm.sections[0]?.id ?? "");
  const [mobilePanel, setMobilePanel] = useState<"chapters" | "inspector" | null>(null);
  const [tab, setTab] = useState<"Validasi" | "Metadata">("Validasi");
  const [sections, setSections] = useState(vm.sections);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const section = useMemo(
    () => sections.find((s) => s.id === selectedId) ?? sections[0],
    [sections, selectedId],
  );

  const completedCount = sections.filter((s) => s.completionState === "complete").length;
  const progress = sections.length ? Math.round((completedCount / sections.length) * 100) : 0;

  /**
   * Debounced autosave of the chapter completion state (Phase 2's small editable surface).
   * The row_version-guarded UPDATE (features/manuals/autosave-actions.ts) is the real conflict
   * mechanism: a stale write returns CONFLICT and we surface "Konflik perubahan" — never a
   * silent overwrite (AC-P2-20). The full block editor + its autosave arrive in Phase 3.
   */
  function setCompletion(next: CompletionState) {
    if (!canEdit) return; // server also enforces manual:update
    const target = section;
    if (!target) return;
    setSections((prev) => prev.map((s) => (s.id === target.id ? { ...s, completionState: next } : s)));
    setSaveState("dirty");
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setSaveState("saving");
      void saveSection({
        sectionId: target.id,
        expectedRowVersion: target.rowVersion,
        patch: { completionState: next },
      }).then((result) => {
        if (result.ok) {
          const rv = result.data.rowVersion;
          setSections((prev) => prev.map((s) => (s.id === target.id ? { ...s, rowVersion: rv } : s)));
          setSaveState("saved");
        } else if (result.code === "CONFLICT") {
          setSaveState("conflict");
        } else {
          setSaveState("error");
        }
      });
    }, DEFAULT_AUTOSAVE_DEBOUNCE_MS);
  }

  return (
    <div className="builder-page">
      <header className="builder-topbar">
        <div className="builder-breadcrumb">
          <Link href="/manuals">Manual Book</Link>
          <ChevronRight aria-hidden="true" size={14} />
          <strong>{identity.eaName}</strong>
          <span className="status-badge" data-status={identity.status}>
            {STATUS_LABELS[identity.status]}
          </span>
        </div>
        <div className="save-state" role="status">
          {canEdit ? (
            <>
              <Save aria-hidden="true" size={15} /> {SAVE_STATE_LABEL[saveState]}
            </>
          ) : (
            <span className="readonly-flag">Tampilan baca-saja</span>
          )}
        </div>
        <div className="builder-top-actions">
          <Link className="secondary-button" href={`/manuals/${vm.manual.id}/preview`}>
            <Eye aria-hidden="true" size={17} /> Preview manual
          </Link>
          {canEdit && (
            <button className="primary-button" disabled title="Pengiriman review tersedia pada Phase 6">
              Kirim review
            </button>
          )}
        </div>
      </header>

      <div className="builder-mobile-controls">
        <button className="secondary-button" onClick={() => setMobilePanel("chapters")}>
          <PanelLeft aria-hidden="true" size={17} /> Bab
        </button>
        <span>
          {section?.position}. {section?.title}
        </span>
        <button className="secondary-button" onClick={() => setMobilePanel("inspector")}>
          <PanelRight aria-hidden="true" size={17} /> Inspector
        </button>
      </div>

      <div className="builder-grid">
        <div className="builder-chapters-desktop">
          <ChapterPanel
            sections={sections}
            selectedId={selectedId}
            progress={progress}
            completedCount={completedCount}
            onSelect={setSelectedId}
          />
        </div>
        <section className="editor-workspace" aria-labelledby="chapter-title">
          <div className="editor-toolbar">
            <div>
              <p className="eyebrow">BAB {String(section?.position ?? 0).padStart(2, "0")}</p>
              <h1 id="chapter-title">{section?.title}</h1>
            </div>
            <div>
              <span className="block-count">
                <FileText aria-hidden="true" size={15} /> {section?.blocks.length ?? 0} blok
              </span>
              {canEdit && (
                <button className="secondary-button" disabled title="Block editor tersedia pada Phase 3">
                  Tambah blok
                </button>
              )}
            </div>
          </div>
          <div className="editor-canvas">{section && <SectionContent section={section} vm={vm} />}</div>
        </section>
        <div className="builder-inspector-desktop">
          <Inspector
            identity={identity}
            section={section}
            progress={progress}
            saveState={saveState}
            tab={tab}
            canEdit={canEdit}
            onTab={setTab}
            onSetCompletion={setCompletion}
          />
        </div>
      </div>

      {mobilePanel && (
        <div className="panel-drawer-layer">
          <button className="drawer-scrim" aria-label="Tutup panel" onClick={() => setMobilePanel(null)} />
          {mobilePanel === "chapters" ? (
            <ChapterPanel
              sections={sections}
              selectedId={selectedId}
              progress={progress}
              completedCount={completedCount}
              onSelect={setSelectedId}
              onClose={() => setMobilePanel(null)}
            />
          ) : (
            <Inspector
              identity={identity}
              section={section}
              progress={progress}
              saveState={saveState}
              tab={tab}
              canEdit={canEdit}
              onTab={setTab}
              onSetCompletion={setCompletion}
              onClose={() => setMobilePanel(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
