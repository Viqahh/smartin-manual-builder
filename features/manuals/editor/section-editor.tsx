"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { richTextFromParagraphs, richTextToPlainText } from "@/lib/domain/rich-text";
import type { ProposalOutput, TargetField } from "@/lib/ai/types";
import {
  ChevronDown,
  Copy,
  GripVertical,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
} from "lucide-react";
import { BlockEditor, type BlockEditorCtx } from "./block-editors";
import { SectionContent } from "@/components/manual-renderer/manual-renderer";
import { BLOCK_TYPES, draftBlockPayload, parseBlockPayload, type BlockType } from "@/lib/domain/blocks";
import { arrayMove } from "@/lib/editor/reorder";
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo as redoHistory,
  undo as undoHistory,
  type History,
} from "@/lib/editor/history";
import {
  createAutosaveQueue,
  payloadsEqual,
  stableStringify,
  type SaveOutcome,
  type EntitySaveState,
} from "@/lib/editor/autosave-queue";
import type { ManualViewModel } from "@/lib/manual/view-model";
import {
  createBlock,
  updateBlock,
  softDeleteBlock,
  restoreBlock,
  reorderBlocks,
  duplicateBlock,
  getBlockRowVersions,
  getBlockState,
} from "@/features/blocks/actions";
import { SAVE_STATE_LABEL, type SaveState } from "@/lib/domain/autosave";

type Section = ManualViewModel["sections"][number];

const BLOCK_LABEL: Record<BlockType, string> = {
  text: "Teks",
  steps: "Langkah instalasi",
  image: "Gambar",
  callout: "Callout",
  parameterTable: "Tabel parameter",
  faq: "FAQ",
};

/** Suggested block types per chapter (docs/CONTENT_REQUIREMENTS.md chapter map). */
const SUGGESTED: Record<string, BlockType[]> = {
  installation: ["steps", "image", "callout"],
  "quick-start": ["steps", "callout"],
  parameters: ["parameterTable", "text"],
  risk: ["callout", "text"],
  presets: ["text", "parameterTable"],
  faq: ["faq"],
  troubleshooting: ["faq", "steps"],
  requirements: ["text", "callout"],
};

type EBlock = {
  key: string;
  id: string | null;
  type: BlockType;
  payload: Record<string, unknown>;
  rowVersion: number;
  save: SaveState;
  error: string | null;
};

type Snapshot = { key: string; id: string | null; type: BlockType; payload: Record<string, unknown>; rowVersion: number }[];

function toSnapshot(blocks: EBlock[]): Snapshot {
  return blocks.map((b) => ({ key: b.key, id: b.id, type: b.type, payload: b.payload, rowVersion: b.rowVersion }));
}

/** The AI-eligible block currently focused in the editor (drives the inspector AI panel). */
export type AiBlockTarget = {
  blockKey: string;
  blockId: string | null;
  blockType: "text" | "steps" | "image" | "callout" | "faq";
  targetField: TargetField;
  /** plain text of the target field — becomes `selectedText` in the GroundedRequest */
  selectedText: string;
  /** canonical hash of the block payload at focus time — for stale-target detection on Accept */
  payloadHash: string;
};

export type SectionEditorHandle = {
  /** Apply an accepted AI proposal to a block through the normal autosave/history pipeline. */
  applyProposal: (
    blockKey: string,
    targetField: TargetField,
    output: ProposalOutput,
  ) => { ok: true; changed: boolean } | { ok: false; reason: "not-found" | "invalid" | "stale" };
  /** Canonical hash of a block's current payload (stale-target guard, §18). */
  blockPayloadHash: (blockKey: string) => string | null;
};

type SectionEditorProps = {
  section: Section;
  vm: ManualViewModel;
  canEdit: boolean;
  ctx: BlockEditorCtx;
  onBlocksChanged: (count: number) => void;
  onAiTargetChange?: (target: AiBlockTarget | null) => void;
  /** Live per-block autosave state for the block an AI proposal was last applied to (§17). */
  onAiApplyStateChange?: (state: SaveState | null) => void;
};

function targetFieldFor(type: AiBlockTarget["blockType"]): TargetField {
  if (type === "faq") return "answer";
  if (type === "image") return "caption";
  if (type === "steps") return "steps";
  return "content";
}

function blockSelectedText(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "text":
    case "callout":
      return safeRichPlain(payload.content);
    case "faq":
      return safeRichPlain(payload.answer);
    case "image":
      return typeof payload.caption === "string" ? payload.caption : "";
    case "steps": {
      const steps = Array.isArray(payload.steps) ? (payload.steps as Record<string, unknown>[]) : [];
      return steps
        .map((s) => [s.title, s.instruction, s.menuPath].filter((x) => typeof x === "string" && x).join(" — "))
        .join("\n");
    }
    default:
      return "";
  }
}
function safeRichPlain(v: unknown): string {
  try {
    if (v && typeof v === "object") return richTextToPlainText(v as never);
  } catch {
    /* ignore */
  }
  return "";
}

export const SectionEditor = forwardRef<SectionEditorHandle, SectionEditorProps>(function SectionEditor(
  { section, vm, canEdit, ctx, onBlocksChanged, onAiTargetChange, onAiApplyStateChange },
  ref,
) {
  const initial: EBlock[] = useMemo(
    () =>
      section.blocks.map((b) => ({
        key: b.id,
        id: b.id,
        type: b.type,
        payload: b.payload,
        rowVersion: b.rowVersion,
        save: "idle" as SaveState,
        error: null,
      })),
    [section.blocks],
  );

  const [blocks, setBlocks] = useState<EBlock[]>(initial);
  const [history, setHistory] = useState<History<Snapshot>>(() => createHistory(toSnapshot(initial)));
  const [addOpen, setAddOpen] = useState(false);
  const [deletedCount, setDeletedCount] = useState(0);
  const [conflict, setConflict] = useState<{ key: string; serverRowVersion: number; serverPayload: unknown } | null>(null);
  // the block an accepted AI proposal was last applied to — its autosave state is mirrored to
  // the inspector AI panel so "Menyimpan… → Tersimpan" is the real Phase 3 result (§17).
  const aiApplyKey = useRef<string | null>(null);
  const deletedStash = useRef<Map<string, EBlock>>(new Map());
  const stashDelete = (id: string, b: EBlock) => {
    deletedStash.current.set(id, b);
    setDeletedCount(deletedStash.current.size);
  };
  const stashPop = (id: string) => {
    deletedStash.current.delete(id);
    setDeletedCount(deletedStash.current.size);
  };

  // ref of the latest blocks so history snapshots / async saves read current state
  const blocksRef = useRef<EBlock[]>(blocks);
  useEffect(() => {
    blocksRef.current = blocks;
  });
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  });
  // payload each block was loaded with — used to recognise "server content I've already seen".
  // Canonical (sorted-key) form so a jsonb round trip on the server side still compares equal.
  const initialPayloadByKey = useRef<Map<string, string>>(
    new Map(initial.map((b) => [b.key, stableStringify(b.payload)])),
  );

  const suggested = SUGGESTED[section.key] ?? [];

  // stable client key -> the server id it has ever been given (survives an undo that soft-deletes it)
  const keyToId = useRef<Map<string, string>>(new Map());
  const rememberId = useCallback((key: string, id: string | null | undefined) => {
    if (id) keyToId.current.set(key, id);
  }, []);

  /** Two snapshots represent the same DOCUMENT (ignore server id / row_version). */
  const sameDoc = useCallback(
    (a: Snapshot, b: Snapshot) =>
      a.length === b.length &&
      a.every(
        (s, i) => s.key === b[i].key && s.type === b[i].type && JSON.stringify(s.payload) === JSON.stringify(b[i].payload),
      ),
    [],
  );

  /** Push the POST-operation document state as the new `present` (clears redo). */
  const pushSnapshot = useCallback(
    (next: EBlock[]) => setHistory((h) => pushHistory(h, toSnapshot(next), sameDoc)),
    [sameDoc],
  );

  // ---------------------------------------------------------------- single-flight autosave
  const saveImpl = useCallback(
    async (key: string, payload: Record<string, unknown>, expectedRowVersion: number): Promise<SaveOutcome> => {
      const b = blocksRef.current.find((x) => x.key === key);
      if (!b) return { ok: false, kind: "error", message: "Blok tidak ditemukan." };
      const check = parseBlockPayload(payload);
      if (!check.ok) return { ok: false, kind: "error", message: check.issues[0]?.message ?? "Blok belum valid." };

      const res = b.id
        ? await updateBlock({ blockId: b.id, expectedRowVersion, blockType: b.type, payload })
        : await createBlock({ sectionId: section.id, blockType: b.type, payload });

      if (res.ok) {
        const data = res.data as { id?: string; rowVersion?: number };
        if (!b.id && data.id) {
          keyToId.current.set(key, data.id);
          setBlocks((p) => p.map((x) => (x.key === key ? { ...x, id: data.id ?? null } : x)));
        }
        // a committed payload edit is an undo step (sameDoc dedups a pure id/version fill)
        setHistory((h) =>
          pushHistory(
            h,
            toSnapshot(blocksRef.current.map((x) => (x.key === key ? { ...x, payload } : x))),
            (a, bb) =>
              a.length === bb.length &&
              a.every(
                (s, i) => s.key === bb[i].key && s.type === bb[i].type && JSON.stringify(s.payload) === JSON.stringify(bb[i].payload),
              ),
          ),
        );
        return { ok: true, rowVersion: data.rowVersion ?? 1 };
      }
      if (res.code === "CONFLICT" && b.id) {
        const st = await getBlockState({ blockId: b.id });
        if (st.ok && st.data.exists) {
          const serverJson = stableStringify(st.data.payload);
          // recognise the server content: the payload we loaded, or any payload in OUR history
          // for this key (an overlapping self-save or a structural row_version bump leaves the
          // content unchanged). Recognised => silent adopt+retry; unknown => genuine conflict.
          // Compare in canonical form — the server value has been through jsonb + Zod.
          const h = historyRef.current;
          const seenInHistory = [...h.past, h.present, ...h.future].some((snap) =>
            snap.some((s) => s.key === key && stableStringify(s.payload) === serverJson),
          );
          if (serverJson === initialPayloadByKey.current.get(key) || seenInHistory) {
            return { ok: false, kind: "retry", serverRowVersion: st.data.rowVersion };
          }
          return { ok: false, kind: "conflict", serverRowVersion: st.data.rowVersion, serverPayload: st.data.payload };
        }
      }
      return { ok: false, kind: "error", message: res.message ?? "Gagal menyimpan blok." };
    },
    [section.id],
  );

  const onSaveState = useCallback(
    (key: string, state: EntitySaveState, extra?: { message?: string; serverRowVersion?: number; serverPayload?: unknown }) => {
      setBlocks((p) =>
        p.map((x) =>
          x.key === key
            ? {
                ...x,
                save: state as SaveState,
                error:
                  state === "error"
                    ? extra?.message ?? "Gagal menyimpan blok."
                    : state === "conflict"
                      ? "Perubahan lain terdeteksi"
                      : null,
              }
            : x,
        ),
      );
      if (state === "conflict" && extra?.serverRowVersion != null) {
        setConflict({ key, serverRowVersion: extra.serverRowVersion, serverPayload: extra.serverPayload });
      }
      // mirror the AI-applied block's real persistence state to the inspector panel (§17)
      if (aiApplyKey.current === key) onAiApplyStateChange?.(state as SaveState);
    },
    [onAiApplyStateChange],
  );

  const onSaveVersion = useCallback((key: string, rowVersion: number) => {
    setBlocks((p) => p.map((x) => (x.key === key ? { ...x, rowVersion } : x)));
  }, []);

  // `createAutosaveQueue` only STORES these handlers — it never invokes them during construction,
  // so nothing reads a ref during render. Handlers are stable useCallbacks keyed on `section.id`
  // (which is stable for this component instance — <SectionEditor key={section.id}>).
  const [saver] = useState(() =>
    createAutosaveQueue<Record<string, unknown>>({
      debounceMs: 800,
      save: saveImpl,
      onState: onSaveState,
      onVersion: onSaveVersion,
    }),
  );

  const cancelTimer = useCallback((key: string) => saver.cancel(key), [saver]);

  /** current authoritative row_version for a block key (queue first, then local mirror). */
  const currentRv = useCallback(
    (key: string) => saver.currentVersion(key) ?? blocksRef.current.find((x) => x.key === key)?.rowVersion ?? 1,
    [saver],
  );

  /**
   * Re-read the server row_versions after an op that bumped them out-of-band (reorder RPC bumps
   * every live block; restore bumps one) and adopt them into BOTH the autosave queue and the
   * visible state — so the next edit's optimistic-concurrency guard uses a current version.
   * Does NOT change the Phase 2 conflict mechanism.
   */
  const resyncVersions = useCallback(async () => {
    const r = await getBlockRowVersions({ sectionId: section.id });
    if (!r.ok) return;
    const byId = new Map(r.data.blocks.map((b) => [b.id, b.rowVersion]));
    setBlocks((p) =>
      p.map((x) => {
        if (!x.id || !byId.has(x.id)) return x;
        // don't clobber a version the autosave queue is actively owning for this key
        if (saver.hasPending(x.key)) return x;
        const rv = byId.get(x.id) as number;
        for (const [k, id] of keyToId.current) if (id === x.id && !saver.hasPending(k)) saver.adoptVersion(k, rv);
        saver.adoptVersion(x.key, rv);
        return { ...x, rowVersion: rv };
      }),
    );
  }, [section.id, saver]);

  // the block whose editor currently holds focus — so a keystroke edit can refresh the AI target
  const aiTargetKey = useRef<string | null>(null);

  const changePayload = useCallback(
    (key: string, payload: Record<string, unknown>) => {
      // Ignore a no-op change (a rich-text editor re-normalising identical content on remount —
      // e.g. right after an undo/redo restore — must not enqueue a stale-version write).
      const current = blocksRef.current.find((x) => x.key === key);
      if (current && payloadsEqual(current.payload, payload)) return;
      setBlocks((prev) => prev.map((x) => (x.key === key ? { ...x, payload, save: "dirty" as SaveState } : x)));
      saver.queue(key, payload, currentRv(key));
      // keep the inspector AI target in step with what the developer is typing
      if (aiTargetKey.current === key) reportAiTarget(key, payload, current?.type);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saver, currentRv],
  );

  // ---------------------------------------------------------------- AI assistant bridge
  /** Report the focused AI-eligible block to the inspector panel (§17/§24). */
  const reportAiTarget = useCallback(
    (blockKey: string, payloadOverride?: Record<string, unknown>, typeOverride?: BlockType) => {
      if (!onAiTargetChange) return;
      const b = blocksRef.current.find((x) => x.key === blockKey);
      const type = (typeOverride ?? b?.type) as BlockType | undefined;
      if (!b || !type || type === "parameterTable") {
        aiTargetKey.current = null;
        onAiTargetChange(null);
        return;
      }
      const payload = payloadOverride ?? b.payload;
      const t = type as AiBlockTarget["blockType"];
      aiTargetKey.current = blockKey;
      onAiTargetChange({
        blockKey: b.key,
        blockId: b.id,
        blockType: t,
        targetField: targetFieldFor(t),
        selectedText: blockSelectedText(t, payload),
        payloadHash: stableStringify(payload),
      });
    },
    [onAiTargetChange],
  );
  /**
   * The AI target is "sticky": it follows the last AI-eligible block the developer focused and
   * is only replaced when another block is focused (`reportAiTarget`), the targeted block is
   * removed, or the chapter changes (parent clears on `selectedId`). It is NOT cleared on plain
   * blur — clicking an operation button in the inspector necessarily blurs the editor, and the
   * Accept path re-checks the block payload hash for staleness anyway (§18).
   */
  const clearAiTargetIfBlock = useCallback(
    (blockKey: string) => {
      if (aiTargetKey.current === blockKey) {
        aiTargetKey.current = null;
        onAiTargetChange?.(null);
      }
      if (aiApplyKey.current === blockKey) {
        aiApplyKey.current = null;
        onAiApplyStateChange?.(null);
      }
    },
    [onAiTargetChange, onAiApplyStateChange],
  );

  useImperativeHandle(
    ref,
    (): SectionEditorHandle => ({
      blockPayloadHash: (blockKey) => {
        const b = blocksRef.current.find((x) => x.key === blockKey);
        return b ? stableStringify(b.payload) : null;
      },
      applyProposal: (blockKey, targetField, output) => {
        const b = blocksRef.current.find((x) => x.key === blockKey);
        if (!b) return { ok: false, reason: "not-found" };

        let nextPayload: Record<string, unknown>;
        let nextType = b.type as BlockType;
        if (output.kind === "text") {
          const doc = richTextFromParagraphs(output.text.split(/\n/).map((l) => l.trim())).doc;
          if (b.type === "callout") {
            nextPayload = { type: "callout", schemaVersion: 1, tone: (b.payload.tone as string) ?? "info", content: { schemaVersion: 2, format: "doc", doc } };
          } else if (b.type === "faq" && targetField === "answer") {
            nextPayload = { type: "faq", schemaVersion: 1, question: (b.payload.question as string) ?? "", answer: { schemaVersion: 2, format: "doc", doc } };
          } else {
            nextPayload = { type: "text", schemaVersion: 1, content: { schemaVersion: 2, format: "doc", doc } };
            nextType = "text";
          }
        } else if (output.kind === "caption") {
          if (b.type !== "image" || typeof b.payload.imageAssetId !== "string") return { ok: false, reason: "invalid" };
          nextPayload = { type: "image", schemaVersion: 1, imageAssetId: b.payload.imageAssetId, caption: output.caption };
        } else {
          // steps — convert the block into (or refine) a steps block
          nextPayload = { type: "steps", schemaVersion: 1, steps: output.steps.map((s) => ({ title: s.title, instruction: s.instruction, ...(s.menuPath ? { menuPath: s.menuPath } : {}) })) };
          nextType = "steps";
        }

        if (!parseBlockPayload(nextPayload).ok) return { ok: false, reason: "invalid" };
        if (payloadsEqual(b.payload, nextPayload)) return { ok: true, changed: false };

        // Accepting a proposal is an EDIT (§19): apply optimistically, record ONE undo step for
        // the pre-AI state, then persist through the normal single-flight autosave queue. Undo
        // restores the pre-AI text; Redo re-applies the accepted proposal.
        const next = blocksRef.current.map((x) =>
          x.key === blockKey ? { ...x, type: nextType, payload: nextPayload, save: "dirty" as SaveState } : x,
        );
        setBlocks(next);
        pushSnapshot(next);
        // track this block so its autosave transitions reach the inspector AI panel
        aiApplyKey.current = blockKey;
        onAiApplyStateChange?.("dirty");
        saver.queue(blockKey, nextPayload, currentRv(blockKey), true);
        return { ok: true, changed: true };
      },
    }),
    [saver, currentRv, pushSnapshot, onAiApplyStateChange],
  );

  useEffect(() => () => saver.dispose(), [saver]);

  // report the persisted-block count to the parent — at most once per distinct count
  const lastReported = useRef(-1);
  useEffect(() => {
    const c = blocks.filter((b) => b.id !== null).length;
    if (c === lastReported.current) return;
    lastReported.current = c;
    onBlocksChanged(c);
  }, [blocks, onBlocksChanged]);

  const addBlock = useCallback(
    (type: BlockType) => {
      setAddOpen(false);
      if (type === "parameterTable" && ctx.groups.length === 0) return;
      const key = `new-${crypto.randomUUID()}`;
      let payload = draftBlockPayload(type);
      if (type === "faq") payload = { ...payload, question: "Pertanyaan baru" };
      if (type === "steps") {
        payload = { type: "steps", schemaVersion: 1, steps: [{ title: "Langkah 1", instruction: "Tuliskan instruksi." }] };
      }
      if (type === "parameterTable") {
        payload = { type: "parameterTable", schemaVersion: 1, groupIds: [ctx.groups[0].id] };
      }
      const eb: EBlock = { key, id: null, type, payload, rowVersion: 1, save: "dirty", error: null };
      const next = [...blocksRef.current, eb];
      setBlocks(next);
      pushSnapshot(next); // POST-add state — undo goes back to before the add, redo re-adds
      // image needs an asset chosen before it persists; everything else persists now
      if (type !== "image") saver.queue(key, payload, 1);
    },
    [ctx.groups, pushSnapshot, saver],
  );

  const removeBlock = useCallback(
    (key: string) => {
      const b = blocksRef.current.find((x) => x.key === key);
      if (!b) return;
      cancelTimer(key); // drop any queued save for an unsaved block
      setConflict((c) => (c?.key === key ? null : c));
      clearAiTargetIfBlock(key); // don't leave the inspector pointed at a removed block
      const next = blocksRef.current.filter((x) => x.key !== key);
      setBlocks(next);
      pushSnapshot(next); // POST-delete state — undo restores it, redo removes it again
      if (b.id) {
        rememberId(b.key, b.id);
        stashDelete(b.id, b);
        void softDeleteBlock({ blockId: b.id });
      }
    },
    [cancelTimer, pushSnapshot, rememberId, clearAiTargetIfBlock],
  );

  const restoreLast = useCallback(() => {
    const last = [...deletedStash.current.values()].pop();
    if (!last?.id) return;
    stashPop(last.id);
    void restoreBlock({ blockId: last.id }).then((res) => {
      if (!res.ok) return;
      const rv = (res.data as { rowVersion?: number }).rowVersion ?? last.rowVersion;
      const restored: EBlock = { ...last, rowVersion: rv, save: "saved", error: null };
      rememberId(restored.key, restored.id);
      if (restored.key) saver.adoptVersion(restored.key, rv);
      const next = [...blocksRef.current, restored];
      setBlocks(next);
      pushSnapshot(next);
    });
  }, [pushSnapshot, rememberId, saver]);

  const duplicate = useCallback(
    (key: string) => {
      const b = blocksRef.current.find((x) => x.key === key);
      if (!b?.id) return;
      void duplicateBlock({ blockId: b.id }).then((res) => {
        if (!res.ok) return;
        const idx = blocksRef.current.findIndex((x) => x.key === key);
        if (idx === -1) return;
        const copy: EBlock = {
          key: res.data.id,
          id: res.data.id,
          type: b.type,
          payload: structuredClone(b.payload),
          rowVersion: 1,
          save: "saved",
          error: null,
        };
        rememberId(copy.key, copy.id);
        const next = [...blocksRef.current.slice(0, idx + 1), copy, ...blocksRef.current.slice(idx + 1)];
        setBlocks(next);
        pushSnapshot(next);
        void resyncVersions(); // the server duplicate ran reorder_manual_blocks
      });
    },
    [pushSnapshot, rememberId, resyncVersions],
  );

  const moveTo = useCallback(
    (from: number, to: number, keepFocus: boolean) => {
      if (from === to || to < 0 || to >= blocksRef.current.length) return;
      const next = arrayMove(blocksRef.current, from, to);
      setBlocks(next);
      pushSnapshot(next); // POST-reorder state
      const persistedIds = next.filter((b) => b.id).map((b) => b.id as string);
      if (persistedIds.length === next.length && persistedIds.length > 1) {
        void reorderBlocks({ sectionId: section.id, orderedBlockIds: persistedIds }).then(() => resyncVersions());
      }
      if (keepFocus) {
        requestAnimationFrame(() => {
          document.querySelector<HTMLButtonElement>(`[data-block-move="${to}"]`)?.focus();
        });
      }
    },
    [pushSnapshot, resyncVersions, section.id],
  );
  const move = useCallback((index: number, dir: -1 | 1) => moveTo(index, index + dir, true), [moveTo]);

  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  /**
   * Reconcile the live editor + the server to a target snapshot (used by undo AND redo).
   * Blocks are matched by their stable client `key`, so a block whose id was still `null` when
   * the snapshot was taken is still recognised after it later persisted. Every server write goes
   * through the same typed actions — undo/redo can never diverge the database.
   */
  const applySnapshot = useCallback(
    async (snap: Snapshot) => {
      const live = blocksRef.current;
      const liveByKey = new Map(live.map((b) => [b.key, b]));
      const snapByKey = new Map(snap.map((s) => [s.key, s]));
      const writes: Promise<unknown>[] = [];
      let orderChanged = false;

      // (a) blocks present live but not in the target -> soft-delete on the server
      for (const b of live) {
        if (!snapByKey.has(b.key)) {
          cancelTimer(b.key);
          const id = b.id ?? keyToId.current.get(b.key) ?? null;
          if (id) {
            keyToId.current.set(b.key, id);
            writes.push(softDeleteBlock({ blockId: id }));
          }
        }
      }

      // (b) target list, keeping the best-known server id + current row_version per key
      const next: EBlock[] = snap.map((s) => {
        const l = liveByKey.get(s.key);
        const id = l?.id ?? keyToId.current.get(s.key) ?? s.id ?? null;
        return {
          key: s.key,
          id,
          type: s.type,
          payload: s.payload,
          rowVersion: l?.rowVersion ?? s.rowVersion,
          save: "saved" as SaveState,
          error: null,
        };
      });

      // (c) blocks in the target but not live -> restore on the server (or re-create if never saved).
      // The restore RPC returns the block's NEW row_version (delete + restore each bumped it) —
      // adopt it straight away so a payload revert / a fast edit right after undo can't fire with
      // the pre-delete version and hit a false conflict.
      const toRecreate: string[] = [];
      for (const n of next) {
        if (!liveByKey.has(n.key)) {
          if (n.id) {
            stashPop(n.id);
            writes.push(
              restoreBlock({ blockId: n.id }).then((res) => {
                const rv = res.ok ? (res.data as { rowVersion?: number }).rowVersion : undefined;
                if (typeof rv === "number") {
                  saver.adoptVersion(n.key, rv);
                  setBlocks((p) => p.map((x) => (x.key === n.key ? { ...x, rowVersion: rv } : x)));
                }
                return res;
              }),
            );
          } else {
            toRecreate.push(n.key);
          }
        }
      }

      // (d) payload reverts for blocks present in both — through the SAME single-flight queue
      // (immediate, no debounce) so an undo/redo can never race an in-flight autosave. Canonical
      // compare so a jsonb-round-tripped live payload isn't treated as different content.
      for (const n of next) {
        const l = liveByKey.get(n.key);
        if (l && l.id && n.id && !payloadsEqual(l.payload, n.payload) && parseBlockPayload(n.payload).ok) {
          saver.queue(n.key, n.payload, saver.currentVersion(n.key) ?? l.rowVersion, true);
        }
      }

      // (e) order revert (only when every block in the target is persisted)
      const targetIds = next.filter((n) => n.id).map((n) => n.id as string);
      const liveOrder = live.filter((b) => b.id).map((b) => b.id as string);
      if (targetIds.length === next.length && targetIds.length > 1 && targetIds.join() !== liveOrder.join()) {
        orderChanged = true;
        writes.push(reorderBlocks({ sectionId: section.id, orderedBlockIds: targetIds }));
      }

      // optimistic local state now; row_versions reconciled from the server below
      setBlocks(next.map((n) => (toRecreate.includes(n.key) ? { ...n, save: "dirty" as SaveState } : n)));
      for (const n of next) {
        if (toRecreate.includes(n.key)) saver.queue(n.key, n.payload, 1);
      }

      // wait for the reconciling structural writes, then re-read row_versions (server bumped them)
      await Promise.allSettled(writes);
      if (writes.length > 0 || orderChanged) await resyncVersions();
    },
    [section.id, cancelTimer, resyncVersions, saver],
  );

  const onUndo = useCallback(() => {
    if (!canUndo(history)) return;
    const nh = undoHistory(history);
    setHistory(nh);
    void applySnapshot(nh.present);
  }, [history, applySnapshot]);

  const onRedo = useCallback(() => {
    if (!canRedo(history)) return;
    const nh = redoHistory(history);
    setHistory(nh);
    void applySnapshot(nh.present);
  }, [history, applySnapshot]);

  const resolveConflict = useCallback(
    (choice: "mine" | "theirs") => {
      if (!conflict) return;
      const { key, serverRowVersion, serverPayload } = conflict;
      if (choice === "mine") {
        // explicit: save my retained draft against the current server version
        saver.resolveUseMine(key, serverRowVersion);
      } else {
        // explicit: replace local content with the server version, then adopt it
        const parsed = parseBlockPayload(serverPayload);
        const adopted =
          parsed.ok && serverPayload && typeof serverPayload === "object"
            ? (serverPayload as Record<string, unknown>)
            : blocksRef.current.find((x) => x.key === key)?.payload ?? {};
        setBlocks((p) => p.map((x) => (x.key === key ? { ...x, payload: adopted, save: "saved" as SaveState, error: null } : x)));
        saver.resolveUseTheirs(key, serverRowVersion, adopted);
      }
      setConflict(null);
    },
    [conflict, saver],
  );

  // ---------------------------------------------------------------- read-only view
  if (!canEdit) {
    return (
      <div className="section-editor" data-readonly="true">
        <p className="readonly-banner">
          <Undo2 aria-hidden="true" size={14} /> Peran Anda hanya dapat membaca manual ini.
        </p>
        <div className="editor-canvas">
          <SectionContent section={section} vm={vm} />
        </div>
      </div>
    );
  }

  return (
    <div className="section-editor">
      <div className="editor-actionbar">
        <button type="button" className="secondary-button" aria-label="Batalkan" disabled={!canUndo(history)} onClick={onUndo}>
          <RotateCcw aria-hidden="true" size={15} /> Undo
        </button>
        <button type="button" className="secondary-button" aria-label="Ulangi" disabled={!canRedo(history)} onClick={onRedo}>
          <RotateCw aria-hidden="true" size={15} /> Redo
        </button>
        {deletedCount > 0 && (
          <button type="button" className="secondary-button" onClick={restoreLast}>
            Pulihkan blok terakhir
          </button>
        )}
        <div className="add-block">
          <button type="button" className="primary-button" aria-expanded={addOpen} onClick={() => setAddOpen((o) => !o)}>
            <Plus aria-hidden="true" size={16} /> Tambah blok <ChevronDown aria-hidden="true" size={14} />
          </button>
          {addOpen && (
            <ul className="add-block-menu" role="menu">
              {BLOCK_TYPES.map((t) => (
                <li key={t}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={t === "parameterTable" && ctx.groups.length === 0}
                    onClick={() => addBlock(t)}
                  >
                    {BLOCK_LABEL[t]}
                    {suggested.includes(t) && <span className="suggested-tag">disarankan</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="editor-canvas">
        {blocks.length === 0 ? (
          <div className="editor-empty">
            <h3>Tambah blok pertama</h3>
            <p>Susun bab ini dari blok terstruktur.</p>
            {suggested.length > 0 && (
              <div className="editor-empty-suggested">
                {suggested.map((t) => (
                  <button key={t} type="button" className="secondary-button" onClick={() => addBlock(t)}>
                    <Plus aria-hidden="true" size={14} /> {BLOCK_LABEL[t]}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <ol className="block-list">
            {blocks.map((b, i) => (
              <li
                key={b.key}
                className="block-item"
                data-save={b.save}
                data-dragover={dragOver === i}
                onFocusCapture={() => reportAiTarget(b.key)}
                onDragOver={(e) => {
                  if (dragFrom.current === null) return;
                  e.preventDefault();
                  setDragOver(i);
                }}
                onDrop={(e) => {
                  if (dragFrom.current === null) return;
                  e.preventDefault();
                  moveTo(dragFrom.current, i, false);
                  dragFrom.current = null;
                  setDragOver(null);
                }}
              >
                <div className="block-item-bar">
                  <button
                    type="button"
                    className="block-drag-handle"
                    aria-label={`Seret untuk memindahkan blok ${i + 1}`}
                    draggable
                    onDragStart={(e) => {
                      dragFrom.current = i;
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      dragFrom.current = null;
                      setDragOver(null);
                    }}
                  >
                    <GripVertical aria-hidden="true" size={14} />
                  </button>
                  <span className="block-item-type">{BLOCK_LABEL[b.type]}</span>
                  <span className="block-item-state" role="status">
                    {b.error ? b.error : SAVE_STATE_LABEL[b.save === "idle" ? "saved" : b.save]}
                  </span>
                  <div className="block-item-actions">
                    <button
                      type="button"
                      data-block-move={i}
                      aria-label={`Naikkan blok ${i + 1}`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={`Turunkan blok ${i + 1}`}
                      disabled={i === blocks.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ▼
                    </button>
                    <button type="button" aria-label={`Gandakan blok ${i + 1}`} disabled={!b.id} onClick={() => duplicate(b.key)}>
                      <Copy aria-hidden="true" size={14} />
                    </button>
                    <button type="button" aria-label={`Hapus blok ${i + 1}`} onClick={() => removeBlock(b.key)}>
                      <Trash2 aria-hidden="true" size={14} />
                    </button>
                  </div>
                </div>
                <div className="block-item-body">
                  {conflict?.key === b.key && (
                    <div className="block-conflict" role="alert">
                      <p>
                        <strong>Perubahan lain terdeteksi.</strong> Tulisan Anda tetap aman.
                      </p>
                      <div className="block-conflict-actions">
                        <button type="button" className="primary-button" onClick={() => resolveConflict("mine")}>
                          Gunakan perubahan saya
                        </button>
                        <button type="button" className="secondary-button" onClick={() => resolveConflict("theirs")}>
                          Muat versi terbaru
                        </button>
                      </div>
                    </div>
                  )}
                  <BlockEditor
                    blockType={b.type}
                    payload={b.payload}
                    readOnly={false}
                    ctx={ctx}
                    onChange={(p) => changePayload(b.key, p)}
                  />
                  {b.save === "error" && (
                    <button type="button" className="secondary-button retry" onClick={() => saver.retry(b.key)}>
                      Coba simpan lagi
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
});
