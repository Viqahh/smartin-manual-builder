/**
 * Phase 7 slice 4B — deployed IMMUTABLE PDF ARTIFACT (AC-P7-4B).
 *
 * Generation (Chromium) happens ONCE per immutable snapshot via the internal trigger
 * `POST /api/internal/pdf-artifact` (HMAC-print-token auth) — the same path the post-publish step
 * uses. Public `GET /manual/<slug>/<version>/pdf` only reads the stored artifact: it must survive
 * 2 / 10 / 20 concurrent downloads with EVERY response 200 + the canonical bytes, and must never
 * launch Chromium.
 *
 * Env:
 *   PDF_E2E_BASE_URL                e.g. https://smartin-xxxx.vercel.app  (required — else skips)
 *   PDF_PRINT_SECRET               server-only HMAC secret (from .env.local) — used to sign the
 *                                  internal generation trigger
 *   VERCEL_AUTOMATION_BYPASS_SECRET sent as x-vercel-protection-bypass on a protected Preview
 */

import { createHash } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { pdfFilename } from "@/lib/pdf/filename";
import { signPrintToken, PRINT_TOKEN_HEADER } from "@/lib/pdf/print-token";

const BASE = process.env.PDF_E2E_BASE_URL?.replace(/\/+$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

const LARGE = { slug: "p7-pdf-large", version: "2.0.0", eaName: "Large Book EA" };
const NORMAL = { slug: "p7-pdf-normal", version: "1.0.0", eaName: "Normal Demo EA" };

// canonical output of the UNCHANGED generation pipeline (generateManualPdf + normalizePdf)
const LARGE_SHA = "7f48294abfbc6b04a021faade93a9a33ba0e1d6e6e4967a76cab9d85b6a09335";
const LARGE_BYTES = 2_536_304;
const VERCEL_CAP = 4_718_592;

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

let cookie = "";
async function primeBypass() {
  if (!BYPASS) return;
  const res = await fetch(`${BASE}/manual/${LARGE.slug}/${LARGE.version}`, {
    headers: { "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" },
    redirect: "manual",
  });
  cookie = (res.headers.get("set-cookie") || "")
    .split(",")
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.startsWith("_vercel_jwt="))
    .join("; ");
}
function hdrs(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { ...extra };
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  if (cookie) h["cookie"] = cookie;
  return h;
}

async function triggerGenerate(slug: string, version: string) {
  const res = await fetch(`${BASE}/api/internal/pdf-artifact`, {
    method: "POST",
    headers: hdrs({ "content-type": "application/json", [PRINT_TOKEN_HEADER]: signPrintToken(slug, version) }),
    body: JSON.stringify({ slug, version }),
  });
  const json = res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  return { status: res.status, json };
}

async function getPdf(slug: string, version: string, extra: Record<string, string> = {}) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/manual/${slug}/${version}/pdf`, { headers: hdrs({ accept: "application/pdf", ...extra }) });
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf, ms: Date.now() - t0 };
}

describe.skipIf(!BASE || !process.env.PDF_PRINT_SECRET)("deployed PDF artifact", () => {
  beforeAll(primeBypass);

  // -----------------------------------------------------------------------
  // §16 — GENERATION CONCURRENCY GATE (run FIRST, on the otherwise-untouched NORMAL fixture)
  // -----------------------------------------------------------------------
  it("GEN GATE — two simultaneous generation triggers ⇒ exactly one Chromium generation", async () => {
    const [a, b] = await Promise.all([
      triggerGenerate(NORMAL.slug, NORMAL.version),
      triggerGenerate(NORMAL.slug, NORMAL.version),
    ]);
    console.log(`[e2e] gen A=${JSON.stringify(a.json)}  B=${JSON.stringify(b.json)}`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const outcomes = [a.json?.outcome, b.json?.outcome];
    // at most ONE actually generated; the other saw the in-progress lock or an already-READY row
    expect(outcomes.filter((o) => o === "generated").length).toBeLessThanOrEqual(1);
    expect(outcomes.every((o) => ["generated", "in_progress", "ready"].includes(o as string))).toBe(true);
    // settle, then confirm exactly one READY artifact that downloads cleanly
    for (let i = 0; i < 10; i++) {
      const g = await triggerGenerate(NORMAL.slug, NORMAL.version);
      if (g.json?.status === "READY") break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    const dl = await getPdf(NORMAL.slug, NORMAL.version);
    expect(dl.res.status).toBe(200);
    expect(dl.buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 240_000);

  // -----------------------------------------------------------------------
  // §14/§17 — seed the LARGE artifact once, verify storage bytes == DB record == canonical
  // -----------------------------------------------------------------------
  it("seeds the LARGE artifact: canonical SHA-256, storage bytes = DB record, under the response cap", async () => {
    let gen: Awaited<ReturnType<typeof triggerGenerate>> | null = null;
    for (let i = 0; i < 12; i++) {
      gen = await triggerGenerate(LARGE.slug, LARGE.version);
      if (gen.json?.status === "READY") break;
      await new Promise((r) => setTimeout(r, 4000));
    }
    console.log(`[e2e] LARGE generation: ${JSON.stringify(gen?.json)}`);
    expect(gen?.json?.status).toBe("READY");

    const dl = await getPdf(LARGE.slug, LARGE.version);
    expect(dl.res.status).toBe(200);
    expect(dl.res.headers.get("content-type")).toContain("application/pdf");
    expect(dl.buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(dl.buf.length).toBe(LARGE_BYTES);
    expect(sha(dl.buf)).toBe(LARGE_SHA);
    expect(dl.buf.length).toBeLessThan(VERCEL_CAP);

    // storage bytes SHA == the SHA the generator recorded in the DB (when this run generated it)
    if (gen?.json?.outcome === "generated") {
      expect(gen.json.sha256).toBe(LARGE_SHA);
      expect(gen.json.byteSize).toBe(LARGE_BYTES);
      expect(gen.json.pageCount).toBe(24);
    }

    // headers: attachment filename, strong ETag = the pdf sha, immutable cache, nosniff, no-referrer
    const cd = dl.res.headers.get("content-disposition") || "";
    expect(cd).toContain(`filename="${pdfFilename(LARGE.eaName, LARGE.version)}"`);
    expect(dl.res.headers.get("etag")).toBe(`"${LARGE_SHA}"`);
    expect(dl.res.headers.get("cache-control")).toContain("immutable");
    expect(dl.res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(dl.res.headers.get("referrer-policy")).toBe("no-referrer");
  }, 240_000);

  it("conditional GET: If-None-Match on the sha ETag ⇒ 304", async () => {
    const r = await getPdf(LARGE.slug, LARGE.version, { "if-none-match": `"${LARGE_SHA}"` });
    expect(r.res.status).toBe(304);
    expect(r.buf.length).toBe(0);
  }, 60_000);

  // -----------------------------------------------------------------------
  // §15 — HARD DOWNLOAD CONCURRENCY GATE (no retries)
  // -----------------------------------------------------------------------
  for (const n of [2, 10, 20]) {
    it(`DOWNLOAD GATE — ${n} concurrent READY downloads: all 200 + canonical bytes`, async () => {
      const results = await Promise.all(Array.from({ length: n }, () => getPdf(LARGE.slug, LARGE.version)));
      const statuses = results.map((r) => r.res.status);
      const hashes = new Set(results.filter((r) => r.res.status === 200).map((r) => sha(r.buf)));
      const maxMs = Math.max(...results.map((r) => r.ms));
      console.log(`[e2e] ${n}x download: statuses=${JSON.stringify(statuses)} hashes=${[...hashes]} maxMs=${maxMs}`);
      expect(statuses.every((s) => s === 200)).toBe(true);
      results.forEach((r) => {
        expect(r.res.headers.get("content-type")).toContain("application/pdf");
        expect(r.buf.length).toBe(LARGE_BYTES);
      });
      expect(hashes.size).toBe(1);
      expect([...hashes][0]).toBe(LARGE_SHA);
      // a stored-artifact read is fast; a Chromium generation would be many seconds
      expect(maxMs).toBeLessThan(20_000);
    }, 180_000);
  }

  it("does not leak private identifiers in the PDF or its response headers", async () => {
    const { res, buf } = await getPdf(LARGE.slug, LARGE.version);
    const headerBlob = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
    for (const needle of ["x-smartin-print-token", "x-vercel-protection-bypass", "PDF_PRINT_SECRET", "supabase", "storage_key", "lease_token"]) {
      expect(headerBlob.toLowerCase()).not.toContain(needle.toLowerCase());
    }
    const text = buf.toString("latin1");
    for (const needle of [
      "render_json",
      "content_hash",
      "storageKey",
      "storage_key",
      "supabase.co/storage",
      "PDF_PRINT_SECRET",
      "x-smartin-print-token",
      "lease_token",
      "service_role",
    ]) {
      expect(text.includes(needle), `PDF must not contain "${needle}"`).toBe(false);
    }
  }, 60_000);

  it("signed print page still denies without a valid token header; legacy ?t= does not authorize", async () => {
    const bare = await fetch(`${BASE}/manual/${LARGE.slug}/${LARGE.version}/print`, { headers: hdrs() });
    expect(bare.status).toBe(404);
    const garbage = await fetch(`${BASE}/manual/${LARGE.slug}/${LARGE.version}/print`, {
      headers: hdrs({ [PRINT_TOKEN_HEADER]: "1000.deadbeef" }),
    });
    expect(garbage.status).toBe(404);
    const legacyQuery = await fetch(`${BASE}/manual/${LARGE.slug}/${LARGE.version}/print?t=anything`, { headers: hdrs() });
    expect(legacyQuery.status).toBe(404);
  }, 60_000);

  it("unknown / never-published manual ⇒ 404", async () => {
    const r = await getPdf("does-not-exist", "9.9.9");
    expect(r.res.status).toBe(404);
  }, 60_000);
});
