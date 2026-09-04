"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Check, Circle, GripVertical, LockKeyhole, Pencil, Plus, Trash2, X } from "lucide-react";
import { arrayMove } from "@/lib/editor/reorder";
import type { ManualViewModel } from "@/lib/manual/view-model";

type Section = ManualViewModel["sections"][number];

function StateDot({ state, current }: { state: Section["completionState"]; current: boolean }) {
  if (current) return <span className="current-dot" aria-label="Sedang diedit" />;
  if (state === "complete") return <Check aria-label="Selesai" size={13} />;
  if (state === "issue") return <AlertTriangle aria-label="Ada masalah" size={13} />;
  return <Circle aria-label="Belum lengkap" size={12} />;
}

export function ChapterNav({
  sections,
  selectedId,
  canEdit,
  progress,
  completedCount,
  onSelect,
  onReorder,
  onAdd,
  onRename,
  onDelete,
  onClose,
}: {
  sections: Section[];
  selectedId: string;
  canEdit: boolean;
  progress: number;
  completedCount: number;
  onSelect: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onAdd: (title: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  // Phase 8B-4 — chapter delete has no undo (unlike block delete's restore stash), so it requires
  // an explicit inline confirmation: Cancel is the default focus, Hapus needs its own click/Enter,
  // Escape cancels. Never fires onDelete from the initial Trash2 click.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const moveTo = (from: number, to: number, keepFocus: boolean) => {
    if (from === to || to < 0 || to >= sections.length) return;
    const ordered = arrayMove(sections, from, to).map((s) => s.id);
    onReorder(ordered);
    if (keepFocus) {
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-chapter-move="${to}"]`)?.focus());
    }
  };

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
        {sections.map((chapter, i) => {
          const current = selectedId === chapter.id;
          return (
            <div
              key={chapter.id}
              className="chapter-row"
              data-active={current}
              data-dragover={dragOver === i}
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
              {canEdit && (
                <button
                  type="button"
                  className="chapter-drag-handle"
                  aria-label={`Seret untuk memindahkan bab ${chapter.title}`}
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
                  <GripVertical aria-hidden="true" size={13} />
                </button>
              )}

              {renamingId === chapter.id ? (
                <form
                  className="chapter-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (renameTitle.trim().length >= 2) onRename(chapter.id, renameTitle.trim());
                    setRenamingId(null);
                  }}
                >
                  <input autoFocus value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} maxLength={120} />
                  <button type="submit" aria-label="Simpan judul">
                    <Check aria-hidden="true" size={13} />
                  </button>
                  <button type="button" aria-label="Batal" onClick={() => setRenamingId(null)}>
                    <X aria-hidden="true" size={13} />
                  </button>
                </form>
              ) : (
                <button className="chapter-open" data-state={chapter.completionState} onClick={() => onSelect(chapter.id)}>
                  <span className="chapter-state">
                    <StateDot state={chapter.completionState} current={current} />
                  </span>
                  <span className="chapter-copy">
                    <small>BAB {String(chapter.position).padStart(2, "0")}</small>
                    <strong>{chapter.title}</strong>
                  </span>
                  {!chapter.isCustom && (
                    <span
                      className="chapter-lock"
                      title="Bab wajib dari template Smartin. Judul bab tidak dapat dihapus atau diubah. Isi bab tetap dapat diedit."
                    >
                      <LockKeyhole
                        aria-label="Bab wajib dari template Smartin — judul tidak dapat diubah, isi tetap dapat diedit"
                        size={12}
                      />
                    </span>
                  )}
                  {chapter.isCustom && <span className="chapter-custom-tag">kustom</span>}
                </button>
              )}

              {canEdit && renamingId !== chapter.id && deletingId === chapter.id && (
                <div
                  className="chapter-delete-confirm"
                  role="group"
                  aria-label={`Konfirmasi hapus bab ${chapter.title}`}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setDeletingId(null);
                  }}
                >
                  <span className="chapter-delete-confirm-text">
                    Hapus bab &ldquo;{chapter.title}&rdquo;? Tidak dapat dibatalkan.
                  </span>
                  {/* Cancel is the default focus target — Enter here is always safe. */}
                  <button type="button" className="secondary-button" autoFocus onClick={() => setDeletingId(null)}>
                    Batal
                  </button>
                  <button
                    type="button"
                    className="chapter-delete-confirm-danger"
                    aria-label={`Ya, hapus bab ${chapter.title}`}
                    onClick={() => {
                      setDeletingId(null);
                      onDelete(chapter.id);
                    }}
                  >
                    <Trash2 aria-hidden="true" size={12} /> Hapus
                  </button>
                </div>
              )}
              {canEdit && renamingId !== chapter.id && deletingId !== chapter.id && (
                <div className="chapter-row-actions">
                  <button
                    type="button"
                    data-chapter-move={i}
                    aria-label={`Naikkan bab ${chapter.title}`}
                    disabled={i === 0}
                    onClick={() => moveTo(i, i - 1, true)}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={`Turunkan bab ${chapter.title}`}
                    disabled={i === sections.length - 1}
                    onClick={() => moveTo(i, i + 1, true)}
                  >
                    ▼
                  </button>
                  {chapter.isCustom && (
                    <>
                      <button
                        type="button"
                        aria-label={`Ubah judul bab ${chapter.title}`}
                        onClick={() => {
                          setRenamingId(chapter.id);
                          setRenameTitle(chapter.title);
                        }}
                      >
                        <Pencil aria-hidden="true" size={12} />
                      </button>
                      {/* First click only opens the inline confirmation — never deletes directly. */}
                      <button type="button" aria-label={`Hapus bab ${chapter.title}`} onClick={() => setDeletingId(chapter.id)}>
                        <Trash2 aria-hidden="true" size={12} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {canEdit &&
        (adding ? (
          <form
            className="chapter-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (newTitle.trim().length >= 2) {
                onAdd(newTitle.trim());
                setNewTitle("");
                setAdding(false);
              }
            }}
          >
            <input autoFocus placeholder="Judul bab baru" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={120} />
            <button type="submit" className="secondary-button">
              Tambah
            </button>
            <button type="button" className="ghost-button" onClick={() => setAdding(false)}>
              Batal
            </button>
          </form>
        ) : (
          <button type="button" className="secondary-button chapter-add-toggle" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" size={14} /> Tambah bab kustom
          </button>
        ))}
    </aside>
  );
}
