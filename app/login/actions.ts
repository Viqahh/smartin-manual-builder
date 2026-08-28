"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

export type SignInState = { error: string | null; email: string };

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!isSupabaseConfigured()) {
    return { error: "Supabase belum dikonfigurasi. Lihat docs/PHASE_2.md.", email };
  }
  if (!email || !password) {
    return { error: "Masukkan email dan kata sandi.", email };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Generic message — never echo the provider error verbatim.
    return { error: "Email atau kata sandi salah.", email };
  }
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
