"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check } from "lucide-react";
import { assignReviewers } from "./actions";
import type { AssignableReviewer } from "./queries";

/** Admin-only reviewer assignment (AC-P6-3). Options are limited to valid role members. */
export function AssignReviewersForm({
  manualId,
  status,
  technicalReviewerId,
  complianceReviewerId,
  technicalOptions,
  complianceOptions,
}: {
  manualId: string;
  status: string;
  technicalReviewerId: string | null;
  complianceReviewerId: string | null;
  technicalOptions: AssignableReviewer[];
  complianceOptions: AssignableReviewer[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tech, setTech] = useState(technicalReviewerId ?? "");
  const [comp, setComp] = useState(complianceReviewerId ?? "");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const locked = status === "PUBLISHED" || status === "ARCHIVED";

  const save = () => {
    setMsg(null);
    start(async () => {
      const res = await assignReviewers({
        manualId,
        technicalReviewerId: tech,
        complianceReviewerId: comp,
      });
      if (res.ok) {
        setMsg({ kind: "ok", text: "Reviewer ditetapkan." });
        router.refresh();
      } else {
        const detail = res.issues?.map((i) => i.message).join(" · ");
        setMsg({ kind: "err", text: detail ? `${res.message} ${detail}` : res.message ?? "Gagal." });
      }
    });
  };

  return (
    <section className="assign-reviewers" aria-label="Penetapan reviewer">
      <h3>Penetapan reviewer</h3>
      <label className="form-field">
        <span>Reviewer teknis</span>
        <select value={tech} disabled={locked || pending} onChange={(e) => setTech(e.target.value)}>
          <option value="">— pilih —</option>
          {technicalOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>Reviewer kepatuhan</span>
        <select value={comp} disabled={locked || pending} onChange={(e) => setComp(e.target.value)}>
          <option value="">— pilih —</option>
          {complianceOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="secondary-button"
        disabled={locked || pending || !tech || !comp}
        onClick={save}
      >
        Simpan penetapan
      </button>
      {msg && (
        <p className={msg.kind === "ok" ? "assign-reviewers-ok" : "assign-reviewers-err"} role="status">
          {msg.kind === "ok" ? <Check aria-hidden="true" size={13} /> : <AlertTriangle aria-hidden="true" size={13} />}{" "}
          {msg.text}
        </p>
      )}
    </section>
  );
}
