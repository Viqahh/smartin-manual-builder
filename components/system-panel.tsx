import Link from "next/link";
import { AlertTriangle, DatabaseZap, Info } from "lucide-react";

/** Shared "state" panel for not-configured / empty / error surfaces (UI_SPEC §16). */
export function SystemPanel({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "warning" | "database";
  title: string;
  children?: React.ReactNode;
  action?: { href: string; label: string };
}) {
  const Icon = tone === "warning" ? AlertTriangle : tone === "database" ? DatabaseZap : Info;
  return (
    <section className="system-panel" data-tone={tone} aria-live="polite">
      <Icon aria-hidden="true" size={22} />
      <div>
        <h2>{title}</h2>
        {children && <div className="system-panel-body">{children}</div>}
        {action && (
          <Link className="secondary-button" href={action.href}>
            {action.label}
          </Link>
        )}
      </div>
    </section>
  );
}

export function SupabaseNotConfiguredPanel() {
  return (
    <SystemPanel tone="database" title="Supabase belum dikonfigurasi">
      <p>
        Data persisten (organisasi, produk EA, manual) memerlukan koneksi Supabase. Salin{" "}
        <code>.env.example</code> ke <code>.env.local</code>, isi{" "}
        <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>, dan{" "}
        <code>SUPABASE_SECRET_KEY</code>, lalu jalankan migrasi di <code>supabase/migrations</code>.
        Lihat <code>docs/PHASE_2.md</code>.
      </p>
    </SystemPanel>
  );
}
