import { ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-brand-panel"><div className="brand-lockup"><span className="brand-mark">S</span><span><strong>SMARTIN</strong><small>Manual Builder</small></span></div><div><p className="eyebrow">EA Developer Tools</p><h1>Dokumentasi EA yang terstruktur dan siap ditinjau.</h1><ul><li><CheckCircle2 aria-hidden="true" /> Mulai dari template, bukan halaman kosong</li><li><CheckCircle2 aria-hidden="true" /> Selaraskan versi manual dan versi EA</li><li><CheckCircle2 aria-hidden="true" /> Siapkan dokumentasi untuk review teknis</li></ul></div><p>PT Smartin Advisor Sistem</p></section>
      <section className="login-card"><div><p className="eyebrow">Demo Phase 1</p><h2>Masuk ke workspace</h2><p>Autentikasi masih dimock. Pilih peran untuk meninjau antarmuka.</p></div><label className="form-field"><span>Peran demo</span><select defaultValue="developer"><option value="developer">Developer</option><option value="technical">Technical Reviewer</option><option value="compliance">Compliance Reviewer</option><option value="admin">Admin</option></select></label><Link className="primary-button full-button" href="/dashboard">Lanjutkan ke dashboard <ArrowRight aria-hidden="true" size={17} /></Link><small>Data yang terlihat pada fase ini adalah data contoh dan tersimpan lokal.</small></section>
    </main>
  );
}
