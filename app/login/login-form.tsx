"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { signInAction, type SignInState } from "./actions";

const initial: SignInState = { error: null, email: "" };

export function LoginForm({ configured }: { configured: boolean }) {
  const [state, formAction, pending] = useActionState(signInAction, initial);

  return (
    <form className="login-card" action={formAction}>
      <div>
        <p className="eyebrow">Masuk</p>
        <h2>Masuk ke workspace</h2>
        <p>Gunakan email dan kata sandi akun Smartin Anda.</p>
      </div>

      {!configured && (
        <p className="field-error" role="alert">
          Supabase belum dikonfigurasi — lihat <code>docs/PHASE_2.md</code>.
        </p>
      )}
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}

      <label className="form-field">
        <span>Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          defaultValue={state.email}
          required
        />
      </label>
      <label className="form-field">
        <span>Kata sandi</span>
        <input type="password" name="password" autoComplete="current-password" required />
      </label>

      <button className="primary-button full-button" type="submit" disabled={pending}>
        {pending ? "Memproses…" : "Masuk"} <ArrowRight aria-hidden="true" size={17} />
      </button>
      <small>Sesi disimpan sebagai cookie SSR yang aman.</small>
    </form>
  );
}
