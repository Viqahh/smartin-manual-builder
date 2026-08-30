/**
 * Phase 7 slice 4 — HMAC-SHA256 authorization token for the signed internal print route.
 *
 * Server-only by convention (imported only by the PDF route + the print page); pure `node:crypto`,
 * so it is unit-testable without the `server-only` resolver.
 *
 * The token binds `eaSlug` + public `version` + an expiry (~120 s) and is signed with the
 * server-only `PDF_PRINT_SECRET`. It is generated per PDF job and never persisted. Verification is
 * constant-time and returns a plain boolean — the print page turns any failure into a generic 404,
 * so a caller cannot tell "expired" from "bad signature" from "wrong slug".
 *
 * Format: `<expMs>.<base64url(hmac)>` — `exp` is in the signed payload, so it cannot be moved.
 *
 * Transport: the token travels ONLY in the `x-smartin-print-token` request header on the single
 * server→server print-document navigation. It is NEVER put in the URL query string (URLs are
 * logged by the platform), never in HTML / the RSC payload / the PDF / a response header, and
 * never propagated to image or static subrequests.
 */

/** Request header carrying the signed print token. Kept distinct from `x-vercel-protection-bypass`. */
export const PRINT_TOKEN_HEADER = "x-smartin-print-token";

import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 120_000;

function secret(): string {
  const s = process.env.PDF_PRINT_SECRET;
  if (!s || s.length < 24) throw new Error("PDF_PRINT_SECRET is not configured");
  return s;
}

function hmac(payload: string): string {
  return createHmac("sha256", secret()).update(payload, "utf8").digest("base64url");
}

const canon = (s: string) => encodeURIComponent(String(s ?? ""));

/** `payload` binds slug + version + exp so none of the three can be swapped without re-signing. */
const payloadFor = (slug: string, version: string, exp: number) =>
  `pdf-print\nv1\n${canon(slug)}\n${canon(version)}\n${exp}`;

export function signPrintToken(slug: string, version: string, now: number = Date.now()): string {
  const exp = now + TTL_MS;
  return `${exp}.${hmac(payloadFor(slug, version, exp))}`;
}

export function verifyPrintToken(
  token: unknown,
  slug: string,
  version: string,
  now: number = Date.now(),
): boolean {
  if (typeof token !== "string" || token.length < 10 || token.length > 512) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;

  const exp = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isSafeInteger(exp) || exp <= 0 || exp < now) return false;

  let expected: string;
  try {
    expected = hmac(payloadFor(slug, version, exp));
  } catch {
    return false;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const PRINT_TOKEN_TTL_MS = TTL_MS;
