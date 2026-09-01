"use client";

/**
 * Inline parameter management inside the Manual Builder (UAT-10/11/13/14).
 *
 * Parameter definitions are OWNED BY THE EA VERSION (GI-11, PRD-CNT-010). This panel is a
 * human-labelled surface over the existing `features/parameters/actions` — it creates / edits /
 * deletes rows on the linked EA Version, never a manual-local copy. After any mutation it re-reads
 * the groups (`getParameterGroups`) and calls `onChanged()` so the block preview + Phase-5
 * validation refresh without a full route refetch.
 */

import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { EA_PARAM_TYPES, type EaParamType, type EaParamMutability } from "@/lib/domain/parameters";
import {
  createParameter,
  createParameterGroup,
  deleteParameter,
  getParameterGroups,
  updateParameter,
} from "./actions";
import type { ParameterGroupWithParams } from "./queries";

const TYPE_HELP: Record<EaParamType, string> = {
  bool: "benar / salah",
  int: "bilangan bulat",
  double: "angka desimal",
  string: "teks",
  enum: "pilihan tetap",
  color: "warna",
};

const MUTABILITY: { value: EaParamMutability; label: string }[] = [
  { value: "before_start", label: "Sebelum EA dijalankan" },
  { value: "may_change_live", label: "Boleh diubah saat EA berjalan" },
  { value: "needs_reattach", label: "Perlu attach ulang EA" },
];

type Draft = {
  id?: string;
  groupId: string;
  displayName: string;
  technicalName: string;
  paramType: EaParamType;
  defaultValue: string;
  safeRange: string;
  orderEffect: string;
  mutability: EaParamMutability;
};

const emptyDraft = (groupId: string): Draft => ({
  groupId,
  displayName: "",
  technicalName: "",
  paramType: "double",
  defaultValue: "",
  safeRange: "",
  orderEffect: "",
  mutability: "before_start",
});

export function InlineParameterManager({
  eaVersionId,
  initialGroups,
  onChanged,
  onClose,
}: {
  eaVersionId: string;
  initialGroups: ParameterGroupWithParams[];
  onChanged: () => void;
  onClose?: () => void;
}) {
  const [groups, setGroups] = useState(initialGroups);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const res = await getParameterGroups({ eaVersionId });
    if (res.ok) setGroups(res.data.groups);
    onChanged();
  };

  const startAdd = async () => {
    setError(null);
    let groupId = groups[0]?.id;
    if (!groupId) {
      setBusy(true);
      const g = await createParameterGroup({ eaVersionId, name: "Parameter" });
      setBusy(false);
      if (!g.ok) {
        setError(g.message ?? "Gagal membuat grup parameter.");
        return;
      }
      groupId = g.data.id;
      await refresh();
    }
    setDraft(emptyDraft(groupId));
  };

  const startEdit = (groupId: string, p: ParameterGroupWithParams["parameters"][number]) => {
    setError(null);
    setDraft({
      id: p.id,
      groupId,
      displayName: p.display_name,
      technicalName: p.technical_name,
      paramType: p.param_type as EaParamType,
      defaultValue: p.default_value ?? "",
      safeRange: p.safe_range ?? "",
      orderEffect: p.order_effect ?? "",
      mutability: (p.mutability as EaParamMutability) ?? "before_start",
    });
  };

  const save = async () => {
    if (!draft) return;
    setError(null);
    if (!draft.displayName.trim()) return setError("Isi “Nama yang tampil di MT5”.");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(draft.technicalName.trim())) {
      return setError("Nama teknis harus identifier valid (huruf/angka/underscore, tidak diawali angka).");
    }
    setBusy(true);
    const common = {
      displayName: draft.displayName.trim(),
      technicalName: draft.technicalName.trim(),
      paramType: draft.paramType,
      defaultValue: draft.defaultValue.trim() || null,
      safeRange: draft.safeRange.trim() || null,
      orderEffect: draft.orderEffect.trim() || null,
      mutability: draft.mutability,
    };
    const res = draft.id
      ? await updateParameter({ id: draft.id, ...common })
      : await createParameter({ parameterGroupId: draft.groupId, ...common });
    setBusy(false);
    if (!res.ok) {
      setError(res.issues?.map((i) => i.message).join(" · ") || res.message || "Gagal menyimpan parameter.");
      return;
    }
    setDraft(null);
    await refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    const res = await deleteParameter({ id });
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? "Gagal menghapus parameter.");
      return;
    }
    await refresh();
  };

  const total = groups.reduce((n, g) => n + g.parameters.length, 0);

  return (
    <div className="param-mgr" aria-label="Kelola parameter EA Version">
      <div className="param-mgr-head">
        <div>
          <strong>Parameter EA Version</strong>
          <span className="param-mgr-sub">
            Definisi milik EA Version — dipakai bersama oleh setiap manual untuk versi ini.
          </span>
        </div>
        {onClose && (
          <button type="button" className="icon-button" aria-label="Tutup panel parameter" onClick={onClose}>
            <X aria-hidden="true" size={16} />
          </button>
        )}
      </div>

      {error && <p className="field-error" role="alert">{error}</p>}

      {total === 0 && !draft && (
        <p className="param-empty">Belum ada parameter untuk EA Version ini.</p>
      )}

      {groups.map((g) => (
        <section className="param-mgr-group" key={g.id}>
          {groups.length > 1 && <h4>{g.name}</h4>}
          {g.parameters.length > 0 && (
            <table className="param-mgr-table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Technical</th>
                  <th>Type</th>
                  <th>Default</th>
                  <th aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {g.parameters.map((p) => (
                  <tr key={p.id}>
                    <td>{p.display_name}</td>
                    <td className="mono">{p.technical_name}</td>
                    <td>{p.param_type}</td>
                    <td className="mono">{p.default_value ?? "—"}</td>
                    <td className="param-mgr-row-actions">
                      <button type="button" aria-label={`Edit ${p.display_name}`} disabled={busy} onClick={() => startEdit(g.id, p)}>
                        <Pencil aria-hidden="true" size={13} />
                      </button>
                      <button type="button" aria-label={`Hapus ${p.display_name}`} disabled={busy} onClick={() => void remove(p.id)}>
                        <Trash2 aria-hidden="true" size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}

      {draft ? (
        <div className="param-mgr-form">
          <div className="param-mgr-grid">
            <label className="form-field">
              <span>Nama yang tampil di MT5</span>
              <input
                value={draft.displayName}
                maxLength={160}
                placeholder="Contoh: Fixed Lot"
                onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              />
              <small>Nama yang dilihat pengguna pada input EA.</small>
            </label>
            <label className="form-field">
              <span>Nama parameter di kode / input EA</span>
              <input
                value={draft.technicalName}
                maxLength={160}
                placeholder="Contoh: FixedLot"
                onChange={(e) => setDraft({ ...draft, technicalName: e.target.value })}
              />
              <small>Nama teknis sesuai source-of-truth EA.</small>
            </label>
            <label className="form-field">
              <span>Tipe data</span>
              <select
                value={draft.paramType}
                onChange={(e) => setDraft({ ...draft, paramType: e.target.value as EaParamType })}
              >
                {EA_PARAM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t} — {TYPE_HELP[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Nilai default</span>
              <input
                value={draft.defaultValue}
                maxLength={200}
                placeholder="Contoh: 0.01"
                onChange={(e) => setDraft({ ...draft, defaultValue: e.target.value })}
              />
              <small>Nilai bawaan EA jika pengguna tidak mengubah parameter.</small>
            </label>
            <label className="form-field">
              <span>Kapan boleh diubah</span>
              <select
                value={draft.mutability}
                onChange={(e) => setDraft({ ...draft, mutability: e.target.value as EaParamMutability })}
              >
                {MUTABILITY.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Rentang aman (opsional)</span>
              <input
                value={draft.safeRange}
                maxLength={240}
                placeholder="Contoh: 0.01–1.00"
                onChange={(e) => setDraft({ ...draft, safeRange: e.target.value })}
              />
            </label>
            <label className="form-field param-mgr-wide">
              <span>Efek pada order (opsional)</span>
              <input
                value={draft.orderEffect}
                maxLength={2000}
                placeholder="Apa yang berubah pada order saat nilai ini diubah"
                onChange={(e) => setDraft({ ...draft, orderEffect: e.target.value })}
              />
            </label>
          </div>
          <div className="param-mgr-form-actions">
            <button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>
              {busy ? "Menyimpan…" : draft.id ? "Simpan perubahan" : "Tambah parameter"}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setDraft(null)}>
              Batal
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="secondary-button param-mgr-add" disabled={busy} onClick={() => void startAdd()}>
          <Plus aria-hidden="true" size={14} /> Tambah parameter
        </button>
      )}
      <p className="param-mgr-note">Perubahan langsung tersimpan ke EA Version; tabel &amp; validasi diperbarui otomatis.</p>
    </div>
  );
}
