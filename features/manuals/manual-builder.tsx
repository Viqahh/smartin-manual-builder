"use client";

import { AlertTriangle, Check, ChevronRight, Circle, Eye, Info, PanelLeft, PanelRight, Save, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { manualIdentity, type ManualViewModel } from "@/lib/manual/view-model";
import { STATUS_LABELS } from "./manual-table";
import { SAVE_STATE_LABEL, type SaveState } from "@/lib/domain/autosave";
import { saveSection } from "./autosave-actions";
import { ChapterNav } from "./editor/chapter-nav";
import { SectionEditor, type AiBlockTarget, type SectionEditorHandle } from "./editor/section-editor";
import type { BlockEditorCtx } from "./editor/block-editors";
import { AiPanel } from "@/features/ai/ai-panel";
import { createAutosaveQueue, type SaveOutcome } from "@/lib/editor/autosave-queue";
import {
  addCustomSection,
  renameSection,
  deleteCustomSection,
  reorderSections,
  getSectionRowVersions,
} from "@/features/sections/actions";
import { uploadManualImage, updateImageAsset, signImageUrl } from "@/features/images/actions";
import { sectionCompletionBlockers, eaDeclaresDangerMode } from "@/lib/domain/section-completion";
import type { OrgImage } from "@/features/images/queries";

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

function Inspector({
  identity,
  section,
  progress,
  saveState,
  tab,
  canEdit,
  completionBlockers,
  aiProviderMode,
  manualId,
  aiTarget,
  aiApplyState,
  editorRef,
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
  completionBlockers: string[];
  aiProviderMode: "mock" | "configured" | "config-error";
  manualId: string;
  aiTarget: AiBlockTarget | null;
  aiApplyState: SaveState | null;
  editorRef: React.RefObject<SectionEditorHandle | null>;
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
              <p>Ditandai manual (Phase 3)</p>
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
                      disabled={s === "complete" && completionBlockers.length > 0}
                      onClick={() => onSetCompletion(s)}
                    >
                      {COMPLETION_LABEL[s]}
                    </button>
                  ))}
                </div>
                {completionBlockers.length > 0 && (
                  <ul className="completion-blockers" role="alert">
                    {completionBlockers.map((b) => (
                      <li key={b}>
                        <AlertTriangle aria-hidden="true" size={13} /> {b}
                      </li>
                    ))}
                  </ul>
                )}
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
          {section && (
            <AiPanel
              providerMode={aiProviderMode}
              canEdit={canEdit}
              manualId={manualId}
              sectionId={section.id}
              target={aiTarget}
              applyState={aiApplyState}
              editorRef={editorRef}
            />
          )}
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

export function ManualBuilder({
  vm,
  canEdit = false,
  images: initialImages = [],
  groups = [],
  aiProviderMode = "mock",
}: {
  vm: ManualViewModel;
  canEdit?: boolean;
  images?: OrgImage[];
  groups?: { id: string; name: string; count: number }[];
  aiProviderMode?: "mock" | "configured" | "config-error";
}) {
  const identity = manualIdentity(vm);
  const [sections, setSections] = useState(vm.sections);
  const [selectedId, setSelectedId] = useState(vm.sections[0]?.id ?? "");
  const [mobilePanel, setMobilePanel] = useState<"chapters" | "inspector" | null>(null);
  const [tab, setTab] = useState<"Validasi" | "Metadata">("Validasi");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [images, setImages] = useState<OrgImage[]>(initialImages);
  const sectionEditorRef = useRef<SectionEditorHandle | null>(null);
  const [aiTarget, setAiTarget] = useState<AiBlockTarget | null>(null);
  const [aiApplyState, setAiApplyState] = useState<SaveState | null>(null);
  const [blockCounts, setBlockCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(vm.sections.map((s) => [s.id, s.blocks.length])),
  );
  const section = useMemo(() => sections.find((s) => s.id === selectedId) ?? sections[0], [sections, selectedId]);
  const sectionId = section?.id ?? "";

  // the AI target belongs to the mounted SectionEditor — drop it when the chapter changes
  // (store-previous-prop render-phase reset; see react.dev "You Might Not Need an Effect")
  const [aiTargetSection, setAiTargetSection] = useState(selectedId);
  if (aiTargetSection !== selectedId) {
    setAiTargetSection(selectedId);
    setAiTarget(null);
    setAiApplyState(null);
  }

  // stable + idempotent: never re-set state to the same count (prevents an update loop)
  const handleBlocksChanged = useCallback(
    (count: number) => {
      setBlockCounts((c) => (c[sectionId] === count ? c : { ...c, [sectionId]: count }));
    },
    [sectionId],
  );
  const completedCount = sections.filter((s) => s.completionState === "complete").length;
  const progress = sections.length ? Math.round((completedCount / sections.length) * 100) : 0;
  const dangerMode = eaDeclaresDangerMode(vm.eaVersion.requirements);

  const imageAltText = useMemo(
    () => Object.fromEntries(images.map((i) => [i.id, i.altText])) as Record<string, string | null>,
    [images],
  );

  const completionBlockers = useMemo(() => {
    if (!section) return [];
    return sectionCompletionBlockers({
      sectionKey: section.key,
      blocks: section.blocks.map((b) => ({ type: b.type, payload: b.payload, imageAssetId: b.imageAssetId })),
      imageAltText,
      eaDangerMode: dangerMode,
    });
  }, [section, imageAltText, dangerMode]);

  // -------------------------------------------------------------- completion save
  // Single-flight per section, same discipline as the block autosave queue: one request in
  // flight per section, the authoritative row_version lives in the queue (never a stale
  // closure), and a self-generated stale-version race (e.g. a chapter reorder bumped
  // row_version, or an overlapping completion save) is re-read and retried silently instead
  // of surfacing a false "Konflik perubahan". Completion is an explicit enum toggle with no
  // user-typed text to lose, so a genuine concurrent change is also resolved by adopting the
  // latest version and re-applying the click.
  const sectionsRef = useRef(sections);
  useEffect(() => {
    sectionsRef.current = sections;
  });

  const saveCompletionImpl = useCallback(
    async (key: string, payload: { completionState: CompletionState }, expectedRowVersion: number): Promise<SaveOutcome> => {
      const res = await saveSection({
        sectionId: key,
        expectedRowVersion,
        patch: { completionState: payload.completionState },
      });
      if (res.ok) return { ok: true, rowVersion: res.data.rowVersion };
      if (res.code === "CONFLICT") {
        const fresh = await getSectionRowVersions({ manualVersionId: vm.manualVersion.id });
        const row = fresh.ok ? fresh.data.sections.find((s) => s.id === key) : undefined;
        if (row) return { ok: false, kind: "retry", serverRowVersion: row.rowVersion };
      }
      return { ok: false, kind: "error", message: res.message ?? "Gagal menyimpan status bab." };
    },
    [vm.manualVersion.id],
  );

  const [completionSaver] = useState(() =>
    createAutosaveQueue<{ completionState: CompletionState }>({
      debounceMs: 600,
      save: saveCompletionImpl,
      onState: (_key, state) => setSaveState(state as SaveState),
      onVersion: (key, rowVersion) =>
        setSections((prev) => prev.map((s) => (s.id === key ? { ...s, rowVersion } : s))),
    }),
  );
  useEffect(() => () => completionSaver.dispose(), [completionSaver]);

  /**
   * After a structural chapter mutation (reorder / rename / add / delete) the section
   * row_versions on the server have moved — reorder is a two-phase RPC that bumps every live
   * section by +2. Adopt the fresh versions so a following completion save doesn't fire with
   * a pre-mutation row_version and hit a false conflict.
   */
  const resyncSectionVersions = useCallback(async () => {
    const fresh = await getSectionRowVersions({ manualVersionId: vm.manualVersion.id });
    if (!fresh.ok) return;
    const byId = new Map(fresh.data.sections.map((s) => [s.id, s]));
    setSections((prev) =>
      prev.map((s) => {
        const f = byId.get(s.id);
        return f ? { ...s, rowVersion: f.rowVersion, position: f.position } : s;
      }),
    );
    for (const [id, f] of byId) if (!completionSaver.hasPending(id)) completionSaver.adoptVersion(id, f.rowVersion);
  }, [vm.manualVersion.id, completionSaver]);

  function setCompletion(next: CompletionState) {
    if (!canEdit || !section) return;
    if (next === "complete" && completionBlockers.length > 0) return;
    const target = section;
    setSections((prev) => prev.map((s) => (s.id === target.id ? { ...s, completionState: next } : s)));
    completionSaver.queue(
      target.id,
      { completionState: next },
      completionSaver.currentVersion(target.id) ?? target.rowVersion,
    );
  }

  // -------------------------------------------------------------- chapter actions
  const handleReorderChapters = useCallback(
    (orderedIds: string[]) => {
      setSections((prev) => {
        const byId = new Map(prev.map((s) => [s.id, s]));
        return orderedIds.map((id, i) => ({ ...(byId.get(id) as Section), position: i }));
      });
      void reorderSections({ manualVersionId: vm.manualVersion.id, orderedSectionIds: orderedIds }).then((res) => {
        if (res.ok) void resyncSectionVersions();
      });
    },
    [vm.manualVersion.id, resyncSectionVersions],
  );

  const handleAddChapter = useCallback(
    (title: string) => {
      void addCustomSection({ manualVersionId: vm.manualVersion.id, title }).then((res) => {
        if (!res.ok) return;
        const newSection: Section = {
          id: res.data.id,
          key: res.data.sectionKey,
          title,
          required: false,
          isCustom: true,
          position: res.data.position,
          completionState: "incomplete",
          rowVersion: 1,
          blocks: [],
        };
        setSections((prev) => [...prev, newSection]);
        setBlockCounts((c) => ({ ...c, [res.data.id]: 0 }));
        setSelectedId(res.data.id);
      });
    },
    [vm.manualVersion.id],
  );

  const handleRenameChapter = useCallback(
    (id: string, title: string) => {
      setSections((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
      void renameSection({ sectionId: id, title }).then((res) => {
        if (res.ok) void resyncSectionVersions();
      });
    },
    [resyncSectionVersions],
  );

  const handleDeleteChapter = useCallback(
    (id: string) => {
      // Optimistically drop the chapter AND recompact positions so BAB numbering closes the gap
      // immediately; the server also recompacts (AC-P3-5) and resyncSectionVersions reconciles.
      setSections((prev) => {
        const next = prev.filter((s) => s.id !== id).map((s, i) => ({ ...s, position: i }));
        if (selectedId === id) setSelectedId(next[0]?.id ?? "");
        return next;
      });
      void deleteCustomSection({ sectionId: id }).then((res) => {
        if (!res.ok) return;
        // reconcile straight from the atomic RPC result (id -> {position, rowVersion})
        const byId = new Map(res.data.sections.map((s) => [s.id, s]));
        setSections((prev) =>
          prev
            .filter((s) => byId.has(s.id))
            .map((s) => ({ ...s, position: byId.get(s.id)!.position, rowVersion: byId.get(s.id)!.rowVersion })),
        );
        for (const s of res.data.sections) {
          if (!completionSaver.hasPending(s.id)) completionSaver.adoptVersion(s.id, s.rowVersion);
        }
      });
    },
    [selectedId, completionSaver],
  );

  // -------------------------------------------------------------- image ctx
  const editorCtx: BlockEditorCtx = useMemo(
    () => ({
      images,
      groups,
      onUploadImage: async (file, altText) => {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("altText", altText);
        const res = await uploadManualImage(fd);
        if (!res.ok) return { ok: false, message: res.message };
        const signed = await signImageUrl(res.data.id);
        setImages((prev) => [
          {
            id: res.data.id,
            altText: altText || null,
            caption: null,
            width: res.data.width,
            height: res.data.height,
            signedUrl: signed.ok ? signed.data.url : null,
          },
          ...prev,
        ]);
        return { ok: true, id: res.data.id };
      },
      onUpdateImageMeta: async (id, patch) => {
        await updateImageAsset({ id, altText: patch.altText, caption: patch.caption });
        setImages((prev) =>
          prev.map((i) =>
            i.id === id
              ? { ...i, altText: patch.altText ?? i.altText, caption: patch.caption ?? i.caption }
              : i,
          ),
        );
      },
    }),
    [images, groups],
  );

  const chapterNavProps = {
    sections,
    selectedId,
    canEdit,
    progress,
    completedCount,
    onSelect: setSelectedId,
    onReorder: handleReorderChapters,
    onAdd: handleAddChapter,
    onRename: handleRenameChapter,
    onDelete: handleDeleteChapter,
  };

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
          <ChapterNav {...chapterNavProps} />
        </div>

        <section className="editor-workspace" aria-labelledby="chapter-title">
          <div className="editor-toolbar">
            <div>
              <p className="eyebrow">BAB {String(section?.position ?? 0).padStart(2, "0")}</p>
              <h1 id="chapter-title">{section?.title}</h1>
            </div>
            <div>
              <span className="block-count">
                {(section && blockCounts[section.id]) ?? section?.blocks.length ?? 0} blok
              </span>
            </div>
          </div>
          {section && (
            <SectionEditor
              key={section.id}
              ref={sectionEditorRef}
              section={section}
              vm={vm}
              canEdit={canEdit}
              ctx={editorCtx}
              onBlocksChanged={handleBlocksChanged}
              onAiTargetChange={setAiTarget}
              onAiApplyStateChange={setAiApplyState}
            />
          )}
        </section>

        <div className="builder-inspector-desktop">
          <Inspector
            identity={identity}
            section={section}
            progress={progress}
            saveState={saveState}
            tab={tab}
            canEdit={canEdit}
            completionBlockers={completionBlockers}
            aiProviderMode={aiProviderMode}
            manualId={vm.manual.id}
            aiTarget={aiTarget}
            aiApplyState={aiApplyState}
            editorRef={sectionEditorRef}
            onTab={setTab}
            onSetCompletion={setCompletion}
          />
        </div>
      </div>

      {mobilePanel && (
        <div className="panel-drawer-layer">
          <button className="drawer-scrim" aria-label="Tutup panel" onClick={() => setMobilePanel(null)} />
          {mobilePanel === "chapters" ? (
            <ChapterNav {...chapterNavProps} onClose={() => setMobilePanel(null)} />
          ) : (
            <Inspector
              identity={identity}
              section={section}
              progress={progress}
              saveState={saveState}
              tab={tab}
              canEdit={canEdit}
              completionBlockers={completionBlockers}
              aiProviderMode={aiProviderMode}
              manualId={vm.manual.id}
              aiTarget={aiTarget}
              aiApplyState={aiApplyState}
              editorRef={sectionEditorRef}
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
