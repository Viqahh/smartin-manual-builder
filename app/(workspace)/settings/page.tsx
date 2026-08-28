import { PageHeader } from "@/components/page-header";
import { getWorkspaceContext } from "@/lib/auth/context";

const ROLE_LABEL: Record<string, string> = {
  DEVELOPER: "Developer",
  TECHNICAL_REVIEWER: "Technical Reviewer",
  COMPLIANCE_REVIEWER: "Compliance Reviewer",
  ADMIN: "Admin",
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getWorkspaceContext();

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
            <dd>{ctx.user?.displayName}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd className="mono">{ctx.user?.email}</dd>
          </div>
          <div>
            <dt>Organisasi aktif</dt>
            <dd>{ctx.activeOrg?.name}</dd>
          </div>
          <div>
            <dt>Peran</dt>
            <dd>{ctx.activeOrg ? ROLE_LABEL[ctx.activeOrg.role] ?? ctx.activeOrg.role : "-"}</dd>
          </div>
        </dl>
      </section>

      {ctx.memberships.length > 1 && (
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>Keanggotaan</h2>
              <p>Anda tergabung dalam beberapa organisasi.</p>
            </div>
          </div>
          <ul className="membership-list">
            {ctx.memberships.map((m) => (
              <li key={m.organizationId}>
                <strong>{m.organizationName}</strong>
                <span>{ROLE_LABEL[m.role] ?? m.role}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
