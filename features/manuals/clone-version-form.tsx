"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, GitBranch } from "lucide-react";
import { cloneManualVersion } from "./version-actions";

export type CloneVersionFormProps = {
  sourceManualVersionId: string;
  sourceVersion: string;
  sourceEaVersionLabel: string;
  linkedEaVersionId: string;
  /** EA versions in the same product lineage (from `listSourceEaVersions`) */
  targetOptions: { id: string; label: string }[];
};

export function CloneVersionForm(props: CloneVersionFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState(props.targetOptions[0]?.id ?? "");
  const [newVersion, setNewVersion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshNote, setRefreshNote] = useState(false);

  const submit = () => {
    setError(null);
    setRefreshNote(false);
    if (!/^\d+\.\d+\.\d+$/.test(newVersion.trim())) {
      setError("Gunakan format X.Y.Z, mis. 2.0.0.");
      return;
    }
    if (!target) {
      setError("Pilih EA Version tujuan.");
      return;
    }
    start(async () => {
      const res = await cloneManualVersion({
        sourceManualVersionId: props.sourceManualVersionId,
        targetEaVersionId: target,
        newVersion: newVersion.trim(),
      });
      if (res.ok) {
        if (!res.data.validationRefreshed) setRefreshNote(true);
        // open the NEW DRAFT — the edit route renders the latest version of the manual
        router.push(`/manuals/${res.data.manualId}/edit`);
        router.refresh();
      } else {
        const detail = res.issues?.map((i) => i.message).join(" · ");
        setError(detail ? `${res.message} ${detail}` : res.message ?? "Gagal.");
        // target + newVersion are intentionally preserved
      }
    });
  };

  return (
    <form
      className="clone-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h3>
        <GitBranch aria-hidden="true" size={15} /> Buat manual untuk versi baru
      </h3>
      <p className="clone-hint">
        Menyalin struktur bab, blok, dan catatan perubahan ke DRAFT baru. Definisi parameter dan
        Supported Configuration mengikuti EA Version tujuan — bukan disalin dari versi ini.
      </p>

      <label className="clone-field">
        <span>Manual sumber</span>
        <input readOnly value={`v${props.sourceVersion} — ${props.sourceEaVersionLabel}`} />
      </label>

      <label className="clone-field">
        <span>EA Version tujuan</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {props.targetOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
              {o.id === props.linkedEaVersionId ? " (versi EA saat ini)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="clone-field">
        <span>Versi manual baru</span>
        <input
          value={newVersion}
          onChange={(e) => setNewVersion(e.target.value)}
          placeholder="mis. 2.0.0"
          inputMode="numeric"
        />
      </label>

      <button className="primary-button" type="submit" disabled={pending || props.targetOptions.length === 0}>
        {pending ? "Menyalin…" : "Buat versi baru"}
      </button>

      {refreshNote && (
        <p className="clone-note" role="status">
          <Check aria-hidden="true" size={13} /> DRAFT baru dibuat. Evaluasi checklist gagal
          diperbarui otomatis — buka lalu segarkan validasinya.
        </p>
      )}
      {error && (
        <p className="clone-error" role="alert">
          <AlertTriangle aria-hidden="true" size={13} /> {error}
        </p>
      )}
    </form>
  );
}
