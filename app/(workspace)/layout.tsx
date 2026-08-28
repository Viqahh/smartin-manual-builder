import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { getWorkspaceContext } from "@/lib/auth/context";
import { SupabaseNotConfiguredPanel } from "@/components/system-panel";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getWorkspaceContext();

  if (!ctx.configured) {
    // App still boots; the workspace shows a setup state instead of crashing (spec §31).
    return (
      <AppShell user={null} orgName={null}>
        <div className="page-container">
          <SupabaseNotConfiguredPanel />
        </div>
      </AppShell>
    );
  }

  if (!ctx.user) redirect("/login");
  if (!ctx.activeOrg) redirect("/no-membership");

  return (
    <AppShell
      user={{ displayName: ctx.user.displayName, role: ctx.activeOrg.role }}
      orgName={ctx.activeOrg.name}
    >
      {children}
    </AppShell>
  );
}
