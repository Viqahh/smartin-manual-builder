import { CheckCircle2 } from "lucide-react";
import { redirect } from "next/navigation";
import { getWorkspaceContext } from "@/lib/auth/context";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const configured = isSupabaseConfigured();
  if (configured) {
    const ctx = await getWorkspaceContext();
    if (ctx.user && ctx.activeOrg) redirect("/dashboard");
    if (ctx.user && !ctx.activeOrg) redirect("/no-membership");
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="brand-lockup">
          <span className="brand-mark">S</span>
          <span>
            <strong>SMARTIN</strong>
            <small>Manual Builder</small>
          </span>
        </div>
        <div>
          <p className="eyebrow">EA Developer Tools</p>
          <h1>Dokumentasi EA yang terstruktur dan siap ditinjau.</h1>
          <ul>
            <li>
              <CheckCircle2 aria-hidden="true" /> Mulai dari template, bukan halaman kosong
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" /> Selaraskan versi manual dan versi EA
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" /> Siapkan dokumentasi untuk review teknis
            </li>
          </ul>
        </div>
        <p>PT Smartin Advisor Sistem</p>
      </section>
      <LoginForm configured={configured} />
    </main>
  );
}
