"use client";

import { AlertTriangle, Check, ChevronRight, Circle, Eye, Info, PanelLeft, PanelRight, Save, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { manualIdentity, type ManualViewModel } from "@/lib/manual/view-model";
import { STATUS_LABELS } from "./manual-table";
import { SAVE_STATE_LABEL, type SaveState } from "@/lib/domain/autosave";
import { saveSection } from "./autosave-actions";
import { revalidateManualRoutes } from "./actions";
import { openPreviewTransition } from "./preview-nav";
import { ChapterNav } from "./editor/chapter-nav";
import { SectionEditor, type AiBlockTarget, type SectionEditorHandle } from "./editor/section-editor";
import type { BlockEditorCtx } from "./editor/block-editors";
import { AiPanel } from "@/features/ai/ai-panel";
import { ValidationPanel } from "@/features/validation/validation-panel";
import type { ValidationView } from "@/lib/validation/types";
import { ReviewControls } from "@/features/reviews/review-controls";
import { PublishControls } from "@/features/manuals/publish-controls";
import { AssignReviewersForm } from "@/features/reviews/assign-reviewers-form";
import { ReviewCommentsPanel } from "@/features/reviews/review-comments-panel";
import type { AssignableReviewer, ReviewCommentRow } from "@/features/reviews/queries";
import { ChangelogEditor, type ChangelogEntryView } from "@/features/changelog/changelog-editor";
import { CloneVersionForm } from "@/features/manuals/clone-version-form";
import { createAutosaveQueue, stableStringify, type SaveOutcome } from "@/lib/editor/autosave-queue";
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
import type { ParameterGroupWithParams } from "@/features/parameters/queries";
import { getParameterGroups } from "@/features/parameters/actions";

export type ReviewBundle = {
  manualId: string;
  status: string;
  reviewRound: number;
  isAdmin: boolean;
  isAssignedTechnical: boolean;
  isAssignedCompliance: boolean;
  canSubmit: boolean;
  canBeginRevision: boolean;
  technicalReviewerId: string | null;
  complianceReviewerId: string | null;
  technicalReviewerName: string | null;
  complianceReviewerName: string | null;
  blockingReasons: string[];
  lastRequestChangesSummary: string | null;
  assignableTechnical: AssignableReviewer[];
  assignableCompliance: AssignableReviewer[];
  // slice 3 — review comments
  comments: ReviewCommentRow[];
  /** active review stage the viewer may comment in, or null (history only) */
  canComment: "TECHNICAL" | "COMPLIANCE" | null;
  canResolveTechnical: boolean;
  canResolveCompliance: boolean;
};

export type ChangelogBundle = {
  manualVersionId: string;
  canEdit: boolean;
  entries: ChangelogEntryView[];
  pbkScope: "IN_SCOPE" | "OUT_OF_SCOPE";
  sourceOptions: { id: string; label: string }[];
  linkedEaVersionId: string;
};

export type CloneBundle = {
  sourceManualVersionId: string;
  sourceVersion: string;
  sourceEaVersionLabel: string;
  linkedEaVersionId: string;
  targetOptions: { id: string; label: string }[];
};

export type PublicationBundle = {
  manualId: string;
  status: string;
  isAdmin: boolean;
  reviewRound: number;
  eaName: string;
  eaVersion: string;
  manualVersion: string;
  publicSlug: string;
  technicalDecision: { reviewerName: string | null; decidedAt: string } | null;
  complianceDecision: { reviewerName: string | null; decidedAt: string } | null;
  readinessPercent: number | null;
  publishBlockers: { checkKey: string; label: string; state: string }[];
  /** present once the version is PUBLISHED / ARCHIVED */
  snapshot: { contentHash: string; publicSlug: string; publicVersion: string; publishedAt: string } | null;
};

type InspectorTab = "Validasi" | "Metadata" | "Komentar";

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
  saveState,
  tab,
  canEdit,
  canReview,
  completionBlockers,
  aiProviderMode,
  manualId,
  manualVersionId,
  aiTarget,
  aiApplyState,
  editorRef,
  initialValidation,
  validationNonce,
  evidenceSections,
  onNavigateSection,
  onFocusBlock,
  onTab,
  onSetCompletion,
  onClose,
  review,
  clone,
  publication,
}: {
  identity: ReturnType<typeof manualIdentity>;
  section: Section | undefined;
  saveState: SaveState;
  tab: InspectorTab;
  canEdit: boolean;
  canReview: boolean;
  completionBlockers: string[];
  aiProviderMode: "mock" | "configured" | "config-error";
  manualId: string;
  manualVersionId: string;
  aiTarget: AiBlockTarget | null;
  aiApplyState: SaveState | null;
  editorRef: React.RefObject<SectionEditorHandle | null>;
  initialValidation: ValidationView | null;
  validationNonce: number;
  evidenceSections: { id: string; key: string; title: string; blocks: { id: string; label: string }[] }[];
  onNavigateSection: (sectionKey: string) => void;
  onFocusBlock: (sectionKey: string, blockId: string) => void;
  onTab: (t: InspectorTab) => void;
  onSetCompletion: (s: CompletionState) => void;
  onClose?: () => void;
  review: ReviewBundle | null;
  clone: CloneBundle | null;
  publication: PublicationBundle | null;
}) {
  const unresolvedComments = review?.comments.filter((c) => !c.resolved).length ?? 0;
  return (
    <aside className="inspector-panel" aria-label="Inspector manual">
      {onClose && (
        <button className="icon-button panel-close" aria-label="Tutup inspector" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      )}
      <div className="inspector-tabs" role="tablist" aria-label="Inspector">
        {(["Validasi", "Metadata", "Komentar"] as const).map((item) => (
          <button role="tab" aria-selected={tab === item} key={item} onClick={() => onTab(item)}>
            {item}
            {item === "Komentar" && unresolvedComments > 0 && (
              <span className="inspector-tab-badge">{unresolvedComments}</span>
            )}
          </button>
        ))}
      </div>
      {tab === "Komentar" ? (
        <div className="inspector-content">
          {review ? (
            <ReviewCommentsPanel
              manualId={review.manualId}
              reviewRound={review.reviewRound}
              comments={review.comments}
              canComment={review.canComment}
              canResolveTechnical={review.canResolveTechnical}
              canResolveCompliance={review.canResolveCompliance}
              currentSection={
                section
                  ? { id: section.id, key: section.key, title: section.title, position: section.position }
                  : null
              }
              currentSectionBlocks={(section?.blocks ?? []).map((b, i) => ({
                id: b.id,
                label: `Blok #${i + 1} · ${b.type}`,
              }))}
              onNavigateSection={onNavigateSection}
              onFocusBlock={onFocusBlock}
            />
          ) : (
            <p className="rc-empty">Komentar review belum tersedia untuk manual ini.</p>
          )}
        </div>
      ) : tab === "Validasi" ? (
        <div className="inspector-content">
          <ValidationPanel
            manualId={manualId}
            manualVersionId={manualVersionId}
            canReview={canReview}
            initial={initialValidation}
            refreshNonce={validationNonce}
            evidenceSections={evidenceSections}
            onNavigateSection={onNavigateSection}
          />
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
          {review && (
            <section>
              <h3>Review</h3>
              <dl>
                <div>
                  <dt>Status alur</dt>
                  <dd>{STATUS_LABELS[review.status as keyof typeof STATUS_LABELS] ?? review.status}</dd>
                </div>
                <div>
                  <dt>Ronde review</dt>
                  <dd className="mono">{review.reviewRound}</dd>
                </div>
                <div>
                  <dt>Reviewer teknis</dt>
                  <dd>{review.technicalReviewerName ?? "belum ditetapkan"}</dd>
                </div>
                <div>
                  <dt>Reviewer kepatuhan</dt>
                  <dd>{review.complianceReviewerName ?? "belum ditetapkan"}</dd>
                </div>
              </dl>
              <Link className="inspector-history-link" href={`/manuals/${review.manualId}/reviews`}>
                Lihat riwayat review &rarr;
              </Link>
            </section>
          )}
          {publication?.snapshot && (
            <section>
              <h3>Snapshot publikasi</h3>
              <dl>
                <div>
                  <dt>Diterbitkan</dt>
                  <dd>{new Date(publication.snapshot.publishedAt).toLocaleString("id-ID")}</dd>
                </div>
                <div>
                  <dt>Slug / versi publik</dt>
                  <dd className="mono">{publication.snapshot.publicSlug}/{publication.snapshot.publicVersion}</dd>
                </div>
                <div>
                  <dt>Hash snapshot</dt>
                  <dd className="mono publish-hash" title={publication.snapshot.contentHash}>
                    {publication.snapshot.contentHash}
                  </dd>
                </div>
              </dl>
              <p className="publish-snapshot-note">
                Snapshot publik telah dibuat; halaman publik untuk versi ini sudah tersedia.
              </p>
            </section>
          )}
          {review?.isAdmin && (review.status === "DRAFT" || review.status === "CHANGES_REQUESTED") && (
            <AssignReviewersForm
              manualId={review.manualId}
              status={review.status}
              technicalReviewerId={review.technicalReviewerId}
              complianceReviewerId={review.complianceReviewerId}
              technicalOptions={review.assignableTechnical}
              complianceOptions={review.assignableCompliance}
            />
          )}
          {clone && (
            <CloneVersionForm
              sourceManualVersionId={clone.sourceManualVersionId}
              sourceVersion={clone.sourceVersion}
              sourceEaVersionLabel={clone.sourceEaVersionLabel}
              linkedEaVersionId={clone.linkedEaVersionId}
              targetOptions={clone.targetOptions}
            />
          )}
        </div>
      )}
    </aside>
  );
}

export function ManualBuilder({
  vm,
  canEdit = false,
  canReview = false,
  images: initialImages = [],
  groups = [],
  parameterGroups: initialParameterGroups = [],
  aiProviderMode = "mock",
  initialValidation = null,
  review = null,
  changelog = null,
  clone = null,
  publication = null,
}: {
  vm: ManualViewModel;
  canEdit?: boolean;
  canReview?: boolean;
  images?: OrgImage[];
  groups?: { id: string; name: string; count: number }[];
  parameterGroups?: ParameterGroupWithParams[];
  aiProviderMode?: "mock" | "configured" | "config-error";
  initialValidation?: ValidationView | null;
  review?: ReviewBundle | null;
  changelog?: ChangelogBundle | null;
  clone?: CloneBundle | null;
  publication?: PublicationBundle | null;
}) {
  const identity = manualIdentity(vm);
  const router = useRouter();
  const [sections, setSections] = useState(vm.sections);
  // Phase 8A.5 — navigation save barrier. `navInFlightRef` is the SYNCHRONOUS re-entrancy guard
  // (a repeated click before React re-renders must not start a second transition); `navBusy` /
  // `previewOpening` drive the disabled + loading UI; `navMsg` surfaces a failed flush or a
  // failed Preview transition so navigation never fails silently.
  const navInFlightRef = useRef(false);
  const [navBusy, setNavBusy] = useState(false);
  const [previewOpening, setPreviewOpening] = useState(false);
  const [navMsg, setNavMsg] = useState<string | null>(null);
  // UAT-25 — restore the last-edited chapter when returning to the editor (per manual, per tab).
  const chapterMemoKey = `smb:lastChapter:${vm.manual.id}`;
  const [selectedId, setSelectedIdRaw] = useState(() => {
    const first = vm.sections[0]?.id ?? "";
    if (typeof window === "undefined") return first;
    try {
      const saved = window.sessionStorage.getItem(chapterMemoKey);
      return saved && vm.sections.some((s) => s.id === saved) ? saved : first;
    } catch {
      return first;
    }
  });
  // Every internal chapter/section switch funnels through here. Phase 8A.5: it is the SINGLE
  // save barrier — persist the mounted editor's pending edits and wait, then navigate. On a
  // failed flush (conflict / error / still unsaved) it does NOT navigate; the user stays put and
  // the unsaved warning shows. Correctness never depends on React unmount cleanup.
  const sectionEditorRef = useRef<SectionEditorHandle | null>(null);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  });
  const commitSelectedId = useCallback(
    (id: string) => {
      setSelectedIdRaw(id);
      try {
        window.sessionStorage.setItem(chapterMemoKey, id);
      } catch {
        /* private mode / storage disabled — non-fatal */
      }
    },
    [chapterMemoKey],
  );
  const setSelectedId = useCallback(
    async (id: string) => {
      if (!id || id === selectedIdRef.current) return;
      if (navInFlightRef.current) return; // synchronous: ignore a click while a transition runs
      navInFlightRef.current = true;
      setNavBusy(true);
      try {
        const r = await sectionEditorRef.current?.flushPending();
        if (r && !r.ok) {
          setNavMsg("Perubahan belum tersimpan — perbaiki blok yang gagal sebelum berpindah bab.");
          return;
        }
        setNavMsg(null);
        commitSelectedId(id);
      } catch {
        setNavMsg("Gagal menyimpan perubahan bab ini. Coba lagi.");
      } finally {
        navInFlightRef.current = false;
        setNavBusy(false);
      }
    },
    [commitSelectedId],
  );
  const [mobilePanel, setMobilePanel] = useState<"chapters" | "inspector" | null>(null);
  const [tab, setTab] = useState<InspectorTab>("Validasi");
  const [pendingBlockFocus, setPendingBlockFocus] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [images, setImages] = useState<OrgImage[]>(initialImages);
  const [aiTarget, setAiTarget] = useState<AiBlockTarget | null>(null);
  const [aiApplyState, setAiApplyState] = useState<SaveState | null>(null);
  // Phase 5 — bump this after a persisted builder change so the readiness panel re-evaluates
  // (server-side, from the DB). Coalesced: one re-eval ~1.2s after edits settle (§27).
  const [validationNonce, setValidationNonce] = useState(0);
  const validationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleValidationRefresh = useCallback(() => {
    if (validationTimer.current) clearTimeout(validationTimer.current);
    validationTimer.current = setTimeout(() => setValidationNonce((n) => n + 1), 1200);
  }, []);
  useEffect(() => () => {
    if (validationTimer.current) clearTimeout(validationTimer.current);
  }, []);
  const navigateToSection = useCallback(
    (key: string) => {
      const target = vm.sections.find((s) => s.key === key);
      if (target) {
        setSelectedId(target.id);
        setMobilePanel(null);
      }
    },
    [vm.sections, setSelectedId],
  );

  // Review-comment anchor navigation (§17): jump to the block's section, then focus + flash the
  // block once the SectionEditor for that section has mounted.
  const handleFocusBlock = useCallback(
    (sectionKey: string, blockId: string) => {
      const target = vm.sections.find((s) => s.key === sectionKey);
      if (target) setSelectedId(target.id);
      setMobilePanel(null);
      setPendingBlockFocus(blockId);
    },
    [vm.sections, setSelectedId],
  );
  useEffect(() => {
    if (!pendingBlockFocus) return;
    const t = setTimeout(() => {
      sectionEditorRef.current?.focusBlock(pendingBlockFocus);
      setPendingBlockFocus(null);
    }, 140);
    return () => clearTimeout(t);
  }, [pendingBlockFocus, selectedId]);
  const [blockCounts, setBlockCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(vm.sections.map((s) => [s.id, s.blocks.length])),
  );
  const section = useMemo(() => sections.find((s) => s.id === selectedId) ?? sections[0], [sections, selectedId]);
  const sectionId = section?.id ?? "";

  // UAT-35 — slim chapter/block list for the human-evidence chapter+block picker in the inspector
  const evidenceSections = useMemo(
    () =>
      sections.map((s) => ({
        id: s.id,
        key: s.key,
        title: s.title,
        blocks: s.blocks.map((b, i) => ({ id: b.id, label: `Blok #${i + 1} · ${b.type}` })),
      })),
    [sections],
  );

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

  // UAT-01: fold the editor's committed block state back into `sections` so switching chapters
  // A → B → A rebuilds A from current data (no page refresh). Deduped so an unchanged set is a
  // no-op and can't cause an update loop.
  const handleSectionBlocksCommitted = useCallback((sectionKey: string, nextBlocks: Section["blocks"]) => {
    setSections((prev) => {
      const cur = prev.find((s) => s.id === sectionKey);
      if (!cur) return prev;
      const same =
        cur.blocks.length === nextBlocks.length &&
        cur.blocks.every((b, i) => {
          const n = nextBlocks[i];
          return (
            b.id === n.id &&
            b.rowVersion === n.rowVersion &&
            stableStringify(b.payload) === stableStringify(n.payload)
          );
        });
      if (same) return prev;
      return prev.map((s) => (s.id === sectionKey ? { ...s, blocks: nextBlocks } : s));
    });
  }, []);
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
    [vm.manualVersion.id, setSelectedId],
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
      // The chapter (and its unsaved block edits) is being discarded — skip the save barrier and
      // switch directly, so a pending edit in the deleted chapter can't strand the user here.
      setSections((prev) => {
        const next = prev.filter((s) => s.id !== id).map((s, i) => ({ ...s, position: i }));
        if (selectedIdRef.current === id) commitSelectedId(next[0]?.id ?? "");
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
    [completionSaver, commitSelectedId],
  );

  // -------------------------------------------------------------- parameter groups (inline mgmt)
  const [paramGroups, setParamGroups] = useState<ParameterGroupWithParams[]>(initialParameterGroups);
  const groupSummaries = useMemo(
    () => paramGroups.map((g) => ({ id: g.id, name: g.name, count: g.parameters.length })),
    [paramGroups],
  );
  const handleParametersChanged = useCallback(() => {
    void getParameterGroups({ eaVersionId: vm.eaVersion.id }).then((res) => {
      if (res.ok) setParamGroups(res.data.groups);
    });
    scheduleValidationRefresh();
  }, [vm.eaVersion.id, scheduleValidationRefresh]);

  // -------------------------------------------------------------- image ctx
  const editorCtx: BlockEditorCtx = useMemo(
    () => ({
      images,
      groups: groupSummaries.length ? groupSummaries : groups,
      eaVersionId: vm.eaVersion.id,
      parameterGroupsFull: paramGroups,
      onParametersChanged: handleParametersChanged,
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
    [images, groups, groupSummaries, paramGroups, vm.eaVersion.id, handleParametersChanged],
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
              {navMsg && (
                <span className="save-state-warn" role="alert">
                  {" "}
                  · {navMsg}
                </span>
              )}
            </>
          ) : (
            <span className="readonly-flag">Tampilan baca-saja</span>
          )}
        </div>
        <div className="builder-top-actions">
          {/* Phase 8A.5 — Preview: synchronous re-entrancy guard → save barrier (flushPending) →
              navigate. `/preview` is `force-dynamic` and never prefetched, so `router.push`
              always renders fresh; route revalidation is fired non-blocking (the block save
              actions already `revalidatePath` on every write) so it never adds nav latency. The
              button shows "Membuka preview…" and stays disabled for the whole transition. */}
          <button
            type="button"
            className="secondary-button compact-action"
            disabled={navBusy || previewOpening}
            aria-busy={previewOpening}
            onClick={() =>
              void openPreviewTransition({
                guard: navInFlightRef,
                flushPending: () => sectionEditorRef.current?.flushPending() ?? Promise.resolve(undefined),
                revalidate: () => void revalidateManualRoutes(vm.manual.id),
                navigate: () => router.push(`/manuals/${vm.manual.id}/preview`),
                setOpening: setPreviewOpening,
                setMessage: setNavMsg,
              })
            }
          >
            <Eye aria-hidden="true" size={16} /> {previewOpening ? "Membuka preview…" : "Preview"}
          </button>
          {review && (
            <ReviewControls
              manualId={review.manualId}
              status={review.status}
              reviewRound={review.reviewRound}
              isAssignedTechnical={review.isAssignedTechnical}
              isAssignedCompliance={review.isAssignedCompliance}
              canSubmit={review.canSubmit}
              canBeginRevision={review.canBeginRevision}
              technicalReviewerSet={review.technicalReviewerId !== null}
              complianceReviewerSet={review.complianceReviewerId !== null}
              blockingReasons={review.blockingReasons}
              lastRequestChangesSummary={review.lastRequestChangesSummary}
            />
          )}
          {publication && ["APPROVED", "PUBLISHED", "ARCHIVED"].includes(publication.status) && (
            <PublishControls
              manualId={publication.manualId}
              status={publication.status}
              isAdmin={publication.isAdmin}
              eaName={publication.eaName}
              eaVersion={publication.eaVersion}
              manualVersion={publication.manualVersion}
              publicSlug={publication.publicSlug}
              reviewRound={publication.reviewRound}
              technicalDecision={publication.technicalDecision}
              complianceDecision={publication.complianceDecision}
              readinessPercent={publication.readinessPercent}
              publishBlockers={publication.publishBlockers}
            />
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
            <div className="editor-toolbar-right">
              <span className="block-count">
                {(section && blockCounts[section.id]) ?? section?.blocks.length ?? 0} blok
              </span>
              {section &&
                (canEdit ? (
                  <label className="chapter-completion" data-state={section.completionState}>
                    <span className="sr-only">Status bab {section.title}</span>
                    <StateIcon state={section.completionState} />
                    <select
                      aria-label={`Status penyelesaian bab ${section.title}`}
                      value={section.completionState}
                      onChange={(e) => setCompletion(e.target.value as CompletionState)}
                    >
                      {(["incomplete", "in_progress", "complete", "issue"] as const).map((s) => (
                        <option
                          key={s}
                          value={s}
                          disabled={s === "complete" && completionBlockers.length > 0}
                        >
                          {COMPLETION_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="chapter-completion" data-state={section.completionState}>
                    <StateIcon state={section.completionState} /> {COMPLETION_LABEL[section.completionState]}
                  </span>
                ))}
            </div>
          </div>
          {section && canEdit && section.completionState !== "complete" && completionBlockers.length > 0 && (
            <p className="chapter-completion-blocked" role="status">
              <AlertTriangle aria-hidden="true" size={13} /> Belum bisa ditandai selesai: {completionBlockers[0]}
              {completionBlockers.length > 1 && ` (+${completionBlockers.length - 1} lagi)`}
            </p>
          )}
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
              onBlockSaved={scheduleValidationRefresh}
              onSectionBlocksCommitted={handleSectionBlocksCommitted}
              // UAT-33: the structured changelog is authored INLINE inside the BAB 14 canvas —
              // not as a separate panel above it. In read-only states the shared renderer
              // (SectionContent) already shows vm.changelog, so no prefix is needed there.
              canvasPrefix={
                canEdit && section.key === "changelog" && changelog ? (
                  <ChangelogEditor
                    manualVersionId={changelog.manualVersionId}
                    canEdit={changelog.canEdit}
                    entries={changelog.entries}
                    pbkScope={changelog.pbkScope}
                    sourceOptions={changelog.sourceOptions}
                    linkedEaVersionId={changelog.linkedEaVersionId}
                    onChanged={scheduleValidationRefresh}
                  />
                ) : undefined
              }
            />
          )}
        </section>

        <div className="builder-inspector-desktop">
          <Inspector
            identity={identity}
            section={section}
            saveState={saveState}
            tab={tab}
            canEdit={canEdit}
            canReview={canReview}
            completionBlockers={completionBlockers}
            aiProviderMode={aiProviderMode}
            manualId={vm.manual.id}
            manualVersionId={vm.manualVersion.id}
            aiTarget={aiTarget}
            aiApplyState={aiApplyState}
            editorRef={sectionEditorRef}
            initialValidation={initialValidation}
            validationNonce={validationNonce}
            evidenceSections={evidenceSections}
            onNavigateSection={navigateToSection}
            onFocusBlock={handleFocusBlock}
            onTab={setTab}
            onSetCompletion={setCompletion}

            review={review}

            clone={clone}

            publication={publication}
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
              saveState={saveState}
              tab={tab}
              canEdit={canEdit}
              canReview={canReview}
              completionBlockers={completionBlockers}
              aiProviderMode={aiProviderMode}
              manualId={vm.manual.id}
              manualVersionId={vm.manualVersion.id}
              aiTarget={aiTarget}
              aiApplyState={aiApplyState}
              editorRef={sectionEditorRef}
              initialValidation={initialValidation}
              validationNonce={validationNonce}
              evidenceSections={evidenceSections}
              onNavigateSection={navigateToSection}
              onFocusBlock={handleFocusBlock}
              onTab={setTab}
              onSetCompletion={setCompletion}

              review={review}

              clone={clone}

              publication={publication}
              onClose={() => setMobilePanel(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
