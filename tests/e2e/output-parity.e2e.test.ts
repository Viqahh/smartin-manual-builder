/**
 * Phase 7 slice 5 — deployed AC-P7-4 content parity + AC-P7-10 regulatory sweep.
 *
 *  - `manifestFromA4Html(web .a4-document)` deep-equals `manifestFromA4Html(print .a4-document)`
 *    ⇒ the web route and the signed print route render the SAME chapters / block order / visible
 *    text / parameter values / image metadata from one immutable snapshot. Content-model diff MUST
 *    be EMPTY.
 *  - case-insensitive scan of the public WEB HTML, the PRINT HTML, and the extracted PDF text for
 *    "Approved" / "Bappebti Approved" / "Certified" / "Compliant" ⇒ 0 in every surface.
 *  - repeated on an ARCHIVED published version.
 *
 * Env: PDF_E2E_BASE_URL, PDF_PRINT_SECRET  (+ VERCEL_AUTOMATION_BYPASS_SECRET on a protected preview).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeAll } from "vitest";
import { diffOutputParity } from "@/lib/publication/output-parity";
import { extractA4Document, manifestFromA4Html } from "@/tests/support/parity-html";
import { signPrintToken, PRINT_TOKEN_HEADER } from "@/lib/pdf/print-token";

const BASE = process.env.PDF_E2E_BASE_URL?.replace(/\/+$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const RUN = Boolean(BASE && process.env.PDF_PRINT_SECRET);

const PUBLISHED = { slug: process.env.PDF_E2E_SLUG || "p7-pdf-large", version: process.env.PDF_E2E_VERSION || "2.0.0" };
const ARCHIVED = { slug: process.env.PDF_E2E_ARCHIVED_SLUG || "p7-pdf-normal", version: process.env.PDF_E2E_ARCHIVED_VERSION || "1.0.0" };

const FORBIDDEN = ["approved", "bappebti approved", "certified", "compliant"];

let cookie = "";
async function prime() {
  if (!BYPASS) return;
  const r = await fetch(`${BASE}/manual/${PUBLISHED.slug}/${PUBLISHED.version}`, {
    headers: { "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" },
    redirect: "manual",
  });
  cookie = (r.headers.get("set-cookie") || "").split(",").map((c) => c.split(";")[0].trim()).filter((c) => c.startsWith("_vercel_jwt=")).join("; ");
}
const hdrs = (extra: Record<string, string> = {}) => ({
  ...(BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {}),
  ...(cookie ? { cookie } : {}),
  ...extra,
});

async function webHtml(slug: string, version: string) {
  const r = await fetch(`${BASE}/manual/${slug}/${version}`, { headers: hdrs() });
  expect(r.status, `web ${slug}/${version}`).toBe(200);
  return r.text();
}
async function printHtml(slug: string, version: string) {
  const r = await fetch(`${BASE}/manual/${slug}/${version}/print`, {
    headers: hdrs({ [PRINT_TOKEN_HEADER]: signPrintToken(slug, version) }),
  });
  expect(r.status, `print ${slug}/${version}`).toBe(200);
  return r.text();
}
async function pdfText(slug: string, version: string): Promise<string> {
  const r = await fetch(`${BASE}/manual/${slug}/${version}/pdf`, { headers: hdrs({ accept: "application/pdf" }) });
  expect(r.status, `pdf ${slug}/${version}`).toBe(200);
  const dir = mkdtempSync(join(tmpdir(), "p7s5-"));
  const p = join(dir, "m.pdf");
  writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  return execFileSync("python3", ["-c", "import sys,pymupdf;d=pymupdf.open(sys.argv[1]);print('\\n'.join(pg.get_text() for pg in d))", p], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

const countForbidden = (text: string) =>
  Object.fromEntries(FORBIDDEN.map((f) => [f, (text.toLowerCase().match(new RegExp(f.replace(/ /g, "\\s+"), "g")) || []).length]));

describe.skipIf(!RUN)("deployed AC-P7-4 parity + AC-P7-10 regulatory sweep", () => {
  beforeAll(prime);

  it("PUBLISHED: web .a4-document == print .a4-document — content-model diff is EMPTY", async () => {
    const web = manifestFromA4Html(extractA4Document(await webHtml(PUBLISHED.slug, PUBLISHED.version)));
    const print = manifestFromA4Html(extractA4Document(await printHtml(PUBLISHED.slug, PUBLISHED.version)));
    const diff = diffOutputParity(web, print);
    console.log(`[parity] ${PUBLISHED.slug}/${PUBLISHED.version}: ${web.chapters.length} chapters, diff entries = ${diff.length}`);
    expect(diff, JSON.stringify(diff.slice(0, 20), null, 2)).toEqual([]);
    expect(web.chapters.length).toBeGreaterThanOrEqual(10);
  }, 120_000);

  it("PUBLISHED: zero forbidden regulatory labels in WEB / PRINT / PDF", async () => {
    const [w, p, pdf] = await Promise.all([
      webHtml(PUBLISHED.slug, PUBLISHED.version),
      printHtml(PUBLISHED.slug, PUBLISHED.version),
      pdfText(PUBLISHED.slug, PUBLISHED.version),
    ]);
    const web = countForbidden(w);
    const print = countForbidden(p);
    const pdfc = countForbidden(pdf);
    console.log("[regulatory] web:", web, "print:", print, "pdf:", pdfc);
    for (const f of FORBIDDEN) {
      expect(web[f], `WEB contains "${f}"`).toBe(0);
      expect(print[f], `PRINT contains "${f}"`).toBe(0);
      expect(pdfc[f], `PDF contains "${f}"`).toBe(0);
    }
  }, 180_000);

  it("ARCHIVED: parity diff EMPTY + zero forbidden labels + PDF byte-stable", async () => {
    const web = manifestFromA4Html(extractA4Document(await webHtml(ARCHIVED.slug, ARCHIVED.version)));
    const print = manifestFromA4Html(extractA4Document(await printHtml(ARCHIVED.slug, ARCHIVED.version)));
    expect(diffOutputParity(web, print)).toEqual([]);

    const [w, p, pdf] = await Promise.all([
      webHtml(ARCHIVED.slug, ARCHIVED.version),
      printHtml(ARCHIVED.slug, ARCHIVED.version),
      pdfText(ARCHIVED.slug, ARCHIVED.version),
    ]);
    for (const f of FORBIDDEN) {
      expect(countForbidden(w)[f]).toBe(0);
      expect(countForbidden(p)[f]).toBe(0);
      expect(countForbidden(pdf)[f]).toBe(0);
    }
    // the ARCHIVED web page shows a neutral banner (web-only chrome — must not be in the document)
    expect(w).toContain("public-manual-banner");
    expect(extractA4Document(w)).not.toContain("public-manual-banner");
  }, 180_000);
});
