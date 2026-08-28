import { PageHeader } from "@/components/page-header";

export default function SettingsPage() {
  return (
    <div className="page-container">
      <PageHeader eyebrow="Workspace" title="Pengaturan" description="Preferensi profil demo untuk Smartin Manual Builder." />
      <section className="card settings-card"><div><h2>Profil pengguna</h2><p>Informasi akun nyata akan dikelola oleh autentikasi Supabase pada Phase 2.</p></div><dl><div><dt>Nama</dt><dd>Andi Setiawan</dd></div><div><dt>Peran</dt><dd>Developer</dd></div><div><dt>Bahasa antarmuka</dt><dd>Bahasa Indonesia</dd></div><div><dt>Organisasi</dt><dd>PT Smartin Advisor Sistem</dd></div></dl></section>
    </div>
  );
}
