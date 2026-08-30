import { PageHeader } from "@/components/page-header";
import { getRequiredWorkspacePageContext } from "@/lib/auth/context";

const ROLE_LABEL: Record<string, string> = {
  DEVELOPER: "Developer",
  TECHNICAL_REVIEWER: "Technical Reviewer",
  COMPLIANCE_REVIEWER: "Compliance Reviewer",
  ADMIN: "Admin",
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, activeOrg, memberships } = await getRequiredWorkspacePageContext();

  return (
    <div className="page-container">
      <PageHeader eyebrow="Workspace" title="Pengaturan" description="Profil akun dan keanggotaan organisasi." />
      <section className="card settings-card">
        <div>
          <h2>Profil pengguna</h2>
          <p>Dikelola oleh Supabase Auth. Email tidak dapat diubah dari sini.</p>
        </div>
        <dl>
          <div>
            <dt>Nama</dt>
            <dd>{user.displayName}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd className="mono">{user.email}</dd>
          </div>
          <div>
            <dt>Organisasi aktif</dt>
            <dd>{activeOrg.name}</dd>
          </div>
          <div>
            <dt>Peran</dt>
            <dd>{activeOrg.roles.length ? activeOrg.roles.map((r) => ROLE_LABEL[r] ?? r).join(" · ") : "-"}</dd>
          </div>
        </dl>
      </section>

      {memberships.length > 1 && (
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>Keanggotaan</h2>
              <p>Anda tergabung dalam beberapa organisasi.</p>
            </div>
          </div>
          <ul className="membership-list">
            {memberships.map((m) => (
              <li key={m.organizationId}>
                <strong>{m.organizationName}</strong>
                <span>{m.roles.map((r) => ROLE_LABEL[r] ?? r).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
