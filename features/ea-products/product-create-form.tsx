"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createEaProduct } from "./actions";

export function ProductCreateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const res = await createEaProduct({ name, description });
      if (res.ok) {
        setOpen(false);
        setName("");
        setDescription("");
        router.refresh();
        router.push(`/ea-products/${res.data.id}`);
      } else {
        setError(res.issues?.[0]?.message ?? res.message);
      }
    });
  }

  if (!open) {
    return (
      <button className="primary-button" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" size={18} /> Tambah produk
      </button>
    );
  }

  return (
    <div className="card inline-form">
      <h2>Produk EA baru</h2>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <label className="form-field">
        <span>Nama produk *</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Polaris EA" />
      </label>
      <label className="form-field">
        <span>Deskripsi</span>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="inline-form-actions">
        <button className="ghost-button" onClick={() => setOpen(false)}>
          Batal
        </button>
        <button className="primary-button" onClick={submit} disabled={pending}>
          {pending ? "Menyimpan…" : "Simpan produk"}
        </button>
      </div>
    </div>
  );
}
