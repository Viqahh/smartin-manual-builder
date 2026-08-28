"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { EA_PARAM_TYPES, EA_PARAM_MUTABILITY, type EaParamType, type EaParamMutability } from "@/lib/domain/parameters";
import {
  createParameter,
  createParameterGroup,
  deleteParameter,
  deleteParameterGroup,
  reorderParameters,
  updateParameter,
} from "./actions";
import type { ParameterGroupWithParams } from "./queries";

type Param = ParameterGroupWithParams["parameters"][number];

/**
 * Minimal functional parameter-management surface so Phase 2 parameter CRUD is testable from
 * the app (spec §7). Definitions belong to the EA VERSION — this never writes to a manual.
 * The rich Phase 3 editor replaces this.
 */
export function ParameterManager({
  eaVersionId,
  initialGroups,
  readOnly = false,
}: {
  eaVersionId: string;
  initialGroups: ParameterGroupWithParams[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");

  // Read-only presentation for reviewer roles — a clean facts view, never a disabled form.
  if (readOnly) {
    if (initialGroups.length === 0) {
      return <p className="param-empty">Belum ada grup parameter untuk versi EA ini.</p>;
    }
    return (
      <div className="param-manager">
        {initialGroups.map((group) => (
          <section className="param-group" key={group.id}>
            <header>
              <h4>{group.name}</h4>
              <span>{group.parameters.length} parameter</span>
            </header>
            {group.parameters.length === 0 ? (
              <p className="param-empty">Belum ada parameter.</p>
            ) : (
              <ul className="param-list">
                {group.parameters.map((p) => (
                  <li className="param-row param-row-readonly" key={p.id}>
                    <div className="param-main">
                      <strong>{p.display_name}</strong> <code>{p.technical_name}</code> <code>{p.param_type}</code>
                      <span className="param-default">default: {p.default_value ?? "—"}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    );
  }

  function run(fn: () => Promise<{ ok: boolean; message?: string; issues?: { message: string }[] }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.issues?.[0]?.message ?? res.message ?? "Gagal.");
    });
  }

  return (
    <div className="param-manager">
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <div className="param-add-group">
        <input
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="Nama grup parameter baru"
        />
        <button
          className="secondary-button"
          disabled={pending || newGroupName.trim().length < 1}
          onClick={() =>
            run(async () => {
              const r = await createParameterGroup({ eaVersionId, name: newGroupName.trim() });
              if (r.ok) setNewGroupName("");
              return r;
            })
          }
        >
          <Plus aria-hidden="true" size={15} /> Tambah grup
        </button>
      </div>

      {initialGroups.length === 0 ? (
        <p className="param-empty">Belum ada grup parameter untuk versi EA ini.</p>
      ) : (
        initialGroups.map((group) => (
          <GroupBlock
            key={group.id}
            group={group}
            pending={pending}
            onRun={run}
          />
        ))
      )}
    </div>
  );
}

function GroupBlock({
  group,
  pending,
  onRun,
}: {
  group: ParameterGroupWithParams;
  pending: boolean;
  onRun: (fn: () => Promise<{ ok: boolean; message?: string; issues?: { message: string }[] }>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [technicalName, setTechnicalName] = useState("");
  const [paramType, setParamType] = useState<EaParamType>("double");

  function moveParam(index: number, dir: -1 | 1) {
    const ids = group.parameters.map((p) => p.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onRun(() => reorderParameters({ parameterGroupId: group.id, orderedIds: ids }));
  }

  return (
    <section className="param-group">
      <header>
        <h4>{group.name}</h4>
        <span>{group.parameters.length} parameter</span>
        <button
          className="icon-button"
          aria-label={`Hapus grup ${group.name}`}
          disabled={pending}
          onClick={() => onRun(() => deleteParameterGroup({ id: group.id }))}
        >
          <Trash2 aria-hidden="true" size={15} />
        </button>
      </header>

      <ul className="param-list">
        {group.parameters.map((p, index) => (
          <ParamRow
            key={p.id}
            param={p}
            first={index === 0}
            last={index === group.parameters.length - 1}
            pending={pending}
            onMove={(dir) => moveParam(index, dir)}
            onRun={onRun}
          />
        ))}
      </ul>

      {adding ? (
        <div className="param-add">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Nama terminal (mis. Fixed Lot)" />
          <input
            className="mono"
            value={technicalName}
            onChange={(e) => setTechnicalName(e.target.value)}
            placeholder="Nama teknis (mis. FixedLot)"
          />
          <select value={paramType} onChange={(e) => setParamType(e.target.value as EaParamType)}>
            {EA_PARAM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            className="secondary-button"
            disabled={pending || displayName.trim().length < 1 || technicalName.trim().length < 1}
            onClick={() =>
              onRun(async () => {
                const r = await createParameter({
                  parameterGroupId: group.id,
                  displayName: displayName.trim(),
                  technicalName: technicalName.trim(),
                  paramType,
                });
                if (r.ok) {
                  setDisplayName("");
                  setTechnicalName("");
                  setAdding(false);
                }
                return r;
              })
            }
          >
            Simpan parameter
          </button>
          <button className="icon-button" aria-label="Batal" onClick={() => setAdding(false)}>
            <X aria-hidden="true" size={15} />
          </button>
        </div>
      ) : (
        <button className="text-link" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" size={14} /> Tambah parameter
        </button>
      )}
    </section>
  );
}

function ParamRow({
  param,
  first,
  last,
  pending,
  onMove,
  onRun,
}: {
  param: Param;
  first: boolean;
  last: boolean;
  pending: boolean;
  onMove: (dir: -1 | 1) => void;
  onRun: (fn: () => Promise<{ ok: boolean; message?: string; issues?: { message: string }[] }>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [defaultValue, setDefaultValue] = useState(param.default_value ?? "");
  const [mutability, setMutability] = useState<EaParamMutability>(param.mutability);

  return (
    <li className="param-row">
      <div className="param-move">
        <button className="icon-button" aria-label="Naikkan" disabled={pending || first} onClick={() => onMove(-1)}>
          <ArrowUp aria-hidden="true" size={13} />
        </button>
        <button className="icon-button" aria-label="Turunkan" disabled={pending || last} onClick={() => onMove(1)}>
          <ArrowDown aria-hidden="true" size={13} />
        </button>
      </div>
      <div className="param-main">
        <strong>{param.display_name}</strong> <code>{param.technical_name}</code> <code>{param.param_type}</code>
        {editing ? (
          <div className="param-edit">
            <input value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} placeholder="default" />
            <select value={mutability} onChange={(e) => setMutability(e.target.value as EaParamMutability)}>
              {EA_PARAM_MUTABILITY.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              disabled={pending}
              onClick={() =>
                onRun(async () => {
                  const r = await updateParameter({ id: param.id, defaultValue: defaultValue || null, mutability });
                  if (r.ok) setEditing(false);
                  return r;
                })
              }
            >
              Simpan
            </button>
          </div>
        ) : (
          <span className="param-default">default: {param.default_value ?? "—"}</span>
        )}
      </div>
      <div className="param-actions">
        <button className="icon-button" aria-label="Ubah parameter" onClick={() => setEditing((v) => !v)}>
          <Pencil aria-hidden="true" size={14} />
        </button>
        <button
          className="icon-button"
          aria-label="Hapus parameter"
          disabled={pending}
          onClick={() => onRun(() => deleteParameter({ id: param.id }))}
        >
          <Trash2 aria-hidden="true" size={14} />
        </button>
      </div>
    </li>
  );
}
