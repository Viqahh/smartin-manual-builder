/**
 * Post-deploy hotfix — workspace PAGE auth boundary.
 *
 * A workspace page renders CONCURRENTLY with `app/(workspace)/layout.tsx`, so the layout's
 * `redirect()` does not stop a child page's body from evaluating. Before the fix, pages
 * dereferenced `ctx.activeOrg!.id` and threw `TypeError: Cannot read properties of null` for an
 * unauthenticated / no-membership request (production log: `GET /dashboard`). Every workspace page
 * now calls `getRequiredWorkspacePageContext()`, which performs the same redirects the layout does
 * and returns `user` + `activeOrg` narrowed to non-null.
 *
 * Part 1 — unit test of the helper's branching for all five auth states.
 * Part 2 — static guard: no workspace page still contains an unsafe `activeOrg!` / `user!`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
// `cache()` from React needs a request scope that a plain node test lacks — make it identity.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T>(fn: T) => fn }));

const redirectCalls: string[] = [];
class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`REDIRECT ${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectCalls.push(url);
    throw new RedirectSignal(url); // real redirect() also aborts execution by throwing
  },
}));

const isConfigured = vi.fn<() => boolean>();
vi.mock("@/lib/env", () => ({ isSupabaseConfigured: () => isConfigured() }));

// minimal chainable Supabase stub: .from(t).select(...).eq(...).eq(...).maybeSingle()/.order(...)
function fakeClient(opts: { user: unknown; memberships: unknown[] }) {
  const table = (name: string) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.order = () => Promise.resolve({ data: name === "memberships" ? opts.memberships : [] });
    q.maybeSingle = () =>
      Promise.resolve({ data: name === "profiles" ? { id: "u1", email: "u@x.io", display_name: "U" } : null });
    return q;
  };
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: opts.user } }) },
    from: (t: string) => table(t),
  };
}
const serverClient = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClientOrNull: () => serverClient() }));

// import AFTER the mocks
const { getRequiredWorkspacePageContext } = await import("@/lib/auth/context");

const MEMBERSHIP = [
  { organization_id: "org-1", role: "ADMIN", created_at: "2026-01-01", organizations: { name: "Org One" } },
];

beforeEach(() => {
  redirectCalls.length = 0;
  isConfigured.mockReset();
  serverClient.mockReset();
});

describe("getRequiredWorkspacePageContext", () => {
  it("Supabase not configured → redirect(/login), never returns", async () => {
    isConfigured.mockReturnValue(false);
    await expect(getRequiredWorkspacePageContext()).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirectCalls).toEqual(["/login"]);
  });

  it("configured but no session → redirect(/login)", async () => {
    isConfigured.mockReturnValue(true);
    serverClient.mockResolvedValue(fakeClient({ user: null, memberships: [] }));
    await expect(getRequiredWorkspacePageContext()).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirectCalls).toEqual(["/login"]);
  });

  it("authenticated but no active membership → redirect(/no-membership)", async () => {
    isConfigured.mockReturnValue(true);
    serverClient.mockResolvedValue(fakeClient({ user: { id: "u1", email: "u@x.io" }, memberships: [] }));
    await expect(getRequiredWorkspacePageContext()).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirectCalls).toEqual(["/no-membership"]);
  });

  it("valid workspace → returns non-null user + activeOrg, no redirect", async () => {
    isConfigured.mockReturnValue(true);
    serverClient.mockResolvedValue(fakeClient({ user: { id: "u1", email: "u@x.io" }, memberships: MEMBERSHIP }));
    const ctx = await getRequiredWorkspacePageContext();
    expect(redirectCalls).toEqual([]);
    expect(ctx.user.id).toBe("u1");
    expect(ctx.activeOrg.id).toBe("org-1");
    expect(ctx.activeOrg.roles).toEqual(["ADMIN"]);
    // the whole point: no `!` needed — these are non-null in the type AND at runtime
    expect(ctx.activeOrg).not.toBeNull();
    expect(ctx.user).not.toBeNull();
  });
});

describe("no workspace page dereferences a possibly-null auth context", () => {
  const WS = join(process.cwd(), "app", "(workspace)");

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
    });

  it("app/(workspace)/**/page.tsx contains no `activeOrg!` / `user!` / raw getWorkspaceContext", () => {
    const offenders: string[] = [];
    for (const file of walk(WS)) {
      if (file.endsWith(`${join("(workspace)", "layout.tsx")}`)) continue; // the layout guards itself
      const src = readFileSync(file, "utf8");
      const rel = file.slice(file.indexOf("app/"));
      if (/\bactiveOrg!\s*\./.test(src) || /\bctx\.activeOrg!\b/.test(src)) offenders.push(`${rel}: activeOrg!`);
      if (/\.user!\s*\./.test(src) || /\bctx\.user!\b/.test(src)) offenders.push(`${rel}: user!`);
      // pages must go through the page-context helper, not the raw context
      if (src.includes("getWorkspaceContext(")) offenders.push(`${rel}: raw getWorkspaceContext()`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
