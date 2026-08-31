import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClientOrNull } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import type { MembershipRole } from "@/lib/supabase/database.types";
import type { OrgRole } from "@/lib/permissions/actions";

export type WorkspaceContext = {
  configured: boolean;
  user: { id: string; email: string; displayName: string } | null;
  /** memberships grouped by org — a user may hold MULTIPLE roles per org (PRD §6). */
  memberships: { organizationId: string; organizationName: string; roles: MembershipRole[] }[];
  /** the org the workspace currently operates in (Phase 2: first membership by created_at). */
  activeOrg: { id: string; name: string; roles: OrgRole[] } | null;
};

/**
 * Single source of truth for "who is this and what may they do", resolved once per request.
 * - unconfigured Supabase -> configured:false
 * - no session            -> user:null  (workspace layout -> /login)
 * - session, no membership -> activeOrg:null  (workspace layout -> /no-membership)
 */
export const getWorkspaceContext = cache(async (): Promise<WorkspaceContext> => {
  if (!isSupabaseConfigured()) {
    return { configured: false, user: null, memberships: [], activeOrg: null };
  }

  const supabase = await createSupabaseServerClientOrNull();
  if (!supabase) return { configured: false, user: null, memberships: [], activeOrg: null };

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return { configured: true, user: null, memberships: [], activeOrg: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .eq("id", auth.user.id)
    .maybeSingle();

  const user = {
    id: auth.user.id,
    email: profile?.email ?? auth.user.email ?? "",
    displayName: profile?.display_name || (auth.user.email ?? "").split("@")[0] || "Pengguna",
  };

  const { data: rows } = await supabase
    .from("memberships")
    .select("organization_id, role, created_at, organizations(name)")
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  // Group rows -> one entry per org, roles[] preserving first-seen org order.
  const order: string[] = [];
  const byOrg = new Map<string, { organizationId: string; organizationName: string; roles: MembershipRole[] }>();
  for (const r of rows ?? []) {
    const orgId = r.organization_id as string;
    const orgRel = r.organizations as unknown as { name?: string } | { name?: string }[] | null;
    const name = (Array.isArray(orgRel) ? orgRel[0]?.name : orgRel?.name) ?? "Organisasi";
    if (!byOrg.has(orgId)) {
      byOrg.set(orgId, { organizationId: orgId, organizationName: name, roles: [] });
      order.push(orgId);
    }
    byOrg.get(orgId)!.roles.push(r.role as MembershipRole);
  }
  const memberships = order.map((id) => byOrg.get(id)!);

  const first = memberships[0];
  const activeOrg = first
    ? { id: first.organizationId, name: first.organizationName, roles: first.roles as OrgRole[] }
    : null;

  return { configured: true, user, memberships, activeOrg };
});

export class AuthError extends Error {
  readonly code: "UNAUTHENTICATED" | "NO_MEMBERSHIP" | "NOT_CONFIGURED";
  constructor(code: AuthError["code"], message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

/** For server actions: resolve the acting context or throw a typed AuthError. */
export async function requireActiveOrg(): Promise<{
  userId: string;
  orgId: string;
  roles: OrgRole[];
}> {
  const ctx = await getWorkspaceContext();
  if (!ctx.configured) throw new AuthError("NOT_CONFIGURED", "Supabase belum dikonfigurasi.");
  if (!ctx.user) throw new AuthError("UNAUTHENTICATED", "Sesi tidak ditemukan.");
  if (!ctx.activeOrg) throw new AuthError("NO_MEMBERSHIP", "Anda belum tergabung dalam organisasi.");
  return { userId: ctx.user.id, orgId: ctx.activeOrg.id, roles: ctx.activeOrg.roles };
}

/** The workspace context with `user` + `activeOrg` guaranteed non-null. */
export type RequiredWorkspacePageContext = {
  user: NonNullable<WorkspaceContext["user"]>;
  activeOrg: NonNullable<WorkspaceContext["activeOrg"]>;
  memberships: WorkspaceContext["memberships"];
};

/**
 * Auth boundary for workspace PAGE server components (`app/(workspace)/**\/page.tsx`).
 *
 * A page renders CONCURRENTLY with its layout, so `app/(workspace)/layout.tsx`'s `redirect()` does
 * NOT stop a child page's body from evaluating first — a page that dereferences `ctx.activeOrg!`
 * throws `TypeError: Cannot read properties of null` for an unauthenticated / no-membership request
 * even though the response ultimately redirects. Every workspace page must call this FIRST, then
 * `if (!ctx) return null;` before touching `user` / `activeOrg` or issuing an org-dependent query.
 *
 * - Supabase not configured → returns **null**. The page must render nothing; the workspace layout
 *   stays responsible for the `SupabaseNotConfiguredPanel` setup state (redirecting here would race
 *   the layout and pre-empt that panel).
 * - configured, no session   → `redirect("/login")`.
 * - session, no active org    → `redirect("/no-membership")`.
 * - valid workspace           → typed non-null `user` + `activeOrg`.
 */
export async function getRequiredWorkspacePageContext(): Promise<RequiredWorkspacePageContext | null> {
  const ctx = await getWorkspaceContext();
  if (!ctx.configured) return null;
  if (!ctx.user) redirect("/login");
  if (!ctx.activeOrg) redirect("/no-membership");
  return { user: ctx.user, activeOrg: ctx.activeOrg, memberships: ctx.memberships };
}
