/**
 * Phase 7 slice 4 — the ONLY origin the PDF generator's Chromium is allowed to navigate to.
 *
 * Server-only by convention (imported only by the PDF route); pure, so it is unit-testable.
 *
 * It is resolved from SERVER-CONTROLLED values only — the per-deployment `VERCEL_URL` /
 * `VERCEL_BRANCH_URL` system env, or a validated `APP_URL` locally. It NEVER reads a request
 * `Host` / `X-Forwarded-Host` / caller-supplied URL, so a hostile header cannot turn PDF
 * generation into an SSRF against an arbitrary host. `buildPrintUrl` percent-encodes the slug and
 * version and only ever appends the `/manual/<slug>/<version>/print` path — it carries NO token or
 * credential in the URL (the print token travels in the `x-smartin-print-token` header).
 */

function fromEnv(): string | null {
  // Vercel system env — the deployment's own hostname, not caller-controlled.
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL && process.env.VERCEL_ENV === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : process.env.VERCEL_URL || process.env.VERCEL_BRANCH_URL;
  if (vercel && /^[a-z0-9.-]+\.vercel\.app$/i.test(vercel)) return `https://${vercel}`;

  const appUrl = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(appUrl)) return appUrl;
  return null;
}

export function resolveTrustedPrintOrigin(): string {
  const origin = fromEnv();
  if (!origin) throw new Error("no trusted print origin (set APP_URL or deploy on Vercel)");
  return origin;
}

/** Trusted origin + fixed print path + percent-encoded params. No query string, no credential. */
export function buildPrintUrl(slug: string, version: string): string {
  return new URL(
    `/manual/${encodeURIComponent(slug)}/${encodeURIComponent(version)}/print`,
    resolveTrustedPrintOrigin(),
  ).toString();
}
