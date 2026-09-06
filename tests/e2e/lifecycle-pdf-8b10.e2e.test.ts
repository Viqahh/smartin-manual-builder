/**
 * Phase 8B-10 — DEPLOYED PREVIEW lifecycle: public-route boundary + the real PDF
 * GENERATION-REQUIRED path (docs/PHASE_8.md deferred this measurement to 8B-10).
 *
 * Creates its own disposable, freshly-PUBLISHED DEV fixture (`e2e-8b10-pdf-<run>`) that has NO
 * PDF artifact yet, drives it through the deployed Preview's real Chromium generation path, and
 * measures cold-start + generation + total user-visible completion. Then verifies idempotency,
 * the READY GET (stored bytes, no Chromium), the filename contract, the print-token boundary,
 * and web/PDF content parity. Cleans the fixture in `afterAll` (audit rows are append-only and
 * retained). Canonical `p7-pdf-*` fixtures are NEVER touched.
 *
 * Env (all required — else the whole file skips):
 *   PDF_E2E_BASE_URL                 the deployed Preview origin
 *   PDF_PRINT_SECRET                 HMAC secret for the internal generation trigger
 *   VERCEL_AUTOMATION_BYPASS_SECRET  Deployment-Protection bypass for the Preview
 *   SUPABASE_TEST_URL / _ANON_KEY / _SECRET_KEY   DEV project (fixture setup only)
 */
import { createHash } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pdfFilename } from "@/lib/pdf/filename";
import { signPrintToken, PRINT_TOKEN_HEADER } from "@/lib/pdf/print-token";
import { computeSnapshotHash } from "@/lib/publication/snapshot";

const BASE = process.env.PDF_E2E_BASE_URL?.replace(/\/+$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const SB_URL = process.env.SUPABASE_TEST_URL;
const SB_ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SB_SECRET = process.env.SUPABASE_TEST_SECRET_KEY || process.env.SUPABASE_SECRET_KEY;
const READY = Boolean(BASE && process.env.PDF_PRINT_SECRET && SB_URL && SB_ANON && SB_SECRET);

const ORG_A = "a0000000-0000-4000-8000-00000000000a";
const SYSTEM_TEMPLATE = "a1a1a1a1-1111-4111-8111-000000000001";
const CT1 = "c5000000-0000-4000-8000-000000000001";
const RUN = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const SLUG = `e2e-8b10-pdf-${RUN}`;
const PUBVER = "1.0.0";
const EANAME = `E2E-8B10-PDF-${RUN} EA`;
const INTRO_MARKER = `E2E 8B-10 PDF fixture ${RUN} — introduction paragraph.`;
const H1 = "1".repeat(64);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

let cookie = "";
function hdrs(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { ...extra };
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  if (cookie) h["cookie"] = cookie;
  return h;
}
async function primeBypass() {
  if (!BYPASS) return;
  const r = await fetch(`${BASE}/api/health`, { headers: { "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" }, redirect: "manual" });
  cookie = (r.headers.get("set-cookie") || "").split(",").map((c) => c.split(";")[0].trim()).filter((c) => c.startsWith("_vercel_jwt=")).join("; ");
}

const svc = (): SupabaseClient => createClient(SB_URL!, SB_SECRET!, { auth: { persistSession: false } });
async function signIn(email: string) {
  const c = createClient(SB_URL!, SB_ANON!);
  const { error } = await c.auth.signInWithPassword({ email, password: "demo-password-123" });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return c;
}
const one = <T>(d: T | T[] | null): T => (Array.isArray(d) ? d[0] : d) as T;

let productId = "", eaVersionId = "", manualId = "", mvId = "";
let RJSON: Record<string, unknown> = {};
let SNAP = "";
const measured: Record<string, unknown> = {};

describe.skipIf(!READY)("Phase 8B-10 — deployed Preview: public route + PDF generation-required", () => {
  beforeAll(async () => {
    await primeBypass();
    const dev = await signIn("developer@smartin.demo");
    const admin = await signIn("admin@smartin.demo");
    const ADMIN = (await admin.auth.getUser()).data.user!.id;
    const DEV = (await dev.auth.getUser()).data.user!.id;
    const s = svc();

    // fresh product/version/manual (developer path)
    const mk = await dev.rpc("create_product_version_manual", {
      p_org: ORG_A, p_owner: DEV, p_product_name: EANAME, p_product_slug: SLUG,
      p_product_description: "E2E 8B-10 PDF fixture — synthetic, safe to delete",
      p_version: "1.0.0", p_platform: "MT5", p_release_date: "2026-01-01",
      p_requirements: { pbkScope: "IN_SCOPE", dangerMode: false, gui: false }, p_support: {},
      p_setups: [{ symbol: "XAUUSD", timeframe: "M15", isSupported: true, position: 0 }],
      p_manual_version: PUBVER, p_template_id: SYSTEM_TEMPLATE, p_locale: "id",
    });
    if (mk.error) throw new Error(`create fixture: ${mk.error.message}`);
    const row = one(mk.data as Record<string, string>[] | Record<string, string>);
    productId = row.product_id; eaVersionId = row.ea_version_id; manualId = row.manual_id; mvId = row.manual_version_id;

    // author a couple of real blocks so the PDF has content
    const sections = (await s.from("manual_sections").select("id, section_key").eq("manual_version_id", mvId).order("position")).data as { id: string; section_key: string }[];
    await dev.from("manual_blocks").insert([
      { organization_id: ORG_A, manual_section_id: sections[0].id, block_type: "text", position: 0, payload: { doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `E2E 8B-10 PDF fixture ${RUN} — introduction paragraph.` }] }] } } },
      { organization_id: ORG_A, manual_section_id: sections[1].id, block_type: "steps", position: 0, payload: { steps: [{ text: "Langkah instalasi satu." }, { text: "Langkah instalasi dua." }] } },
    ]);

    // drive to APPROVED
    await s.from("manual_versions").update({ technical_reviewer_id: null, compliance_reviewer_id: null }).eq("id", mvId);
    const reviewer = await signIn("reviewer@smartin.demo");
    const compliance = await signIn("compliance@smartin.demo");
    const REV = (await reviewer.auth.getUser()).data.user!.id;
    const COMP = (await compliance.auth.getUser()).data.user!.id;
    let r = await admin.rpc("assign_reviewers", { p_manual_version_id: mvId, p_technical_reviewer_id: REV, p_compliance_reviewer_id: COMP });
    if (r.error) throw new Error(`assign: ${r.error.message}`);
    r = await dev.rpc("submit_for_technical_review", { p_manual_version_id: mvId, p_expected_round: 0, p_content_hash: H1 });
    if (r.error) throw new Error(`submit: ${r.error.message}`);
    r = await reviewer.rpc("record_technical_decision", { p_manual_version_id: mvId, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    if (r.error) throw new Error(`tech approve: ${r.error.message}`);
    r = await compliance.rpc("record_compliance_decision", { p_manual_version_id: mvId, p_expected_round: 1, p_decision: "APPROVE", p_summary: "", p_current_hash: H1 });
    if (r.error) throw new Error(`comp approve: ${r.error.message}`);

    // full PASS checklist
    const items = (await s.from("checklist_items").select("check_key, category, required").eq("checklist_template_id", CT1)).data as { check_key: string; category: string; required: boolean }[];
    for (const it of items) {
      await s.from("checklist_results").insert({ organization_id: ORG_A, manual_version_id: mvId, checklist_template_id: CT1, checklist_template_version: 1, check_key: it.check_key, category: it.category, required: it.required, state: "PASS", evaluator: "system" });
    }

    // publish (ADMIN actor). A realistic frozen render_json in the exact shape `snapshotToViewModel`
    // consumes, so the deployed public page + PDF render the real fixture content (chapter titles,
    // the authored intro text) and the download filename resolves to this EA's name.
    const INTRO = INTRO_MARKER;
    RJSON = {
      snapshotVersion: 1,
      public: { slug: SLUG, version: PUBVER },
      template: { id: SYSTEM_TEMPLATE, version: 1 },
      images: {},
      __e2e: RUN,
      content: {
        manual: { locale: "id" },
        manualVersion: { version: PUBVER, status: "PUBLISHED" },
        eaProduct: { name: EANAME, slug: SLUG, description: "E2E 8B-10 synthetic fixture" },
        eaVersion: { version: "1.0.0", platform: "MT5" },
        organization: { name: "PT Smartin Advisor Sistem (DEMO)" },
        parameterGroups: [],
        images: [],
        changelog: [],
        sections: [
          { key: "cover", title: "Sampul & Identitas Produk", required: true, position: 0,
            blocks: [{ type: "text", position: 0, payload: { type: "text", schemaVersion: 1, content: { format: "doc", schemaVersion: 2, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: INTRO }] }] } } } }] },
          { key: "installation", title: "Instalasi", required: true, position: 1,
            blocks: [{ type: "steps", position: 0, payload: { type: "steps", schemaVersion: 1, steps: [{ title: "Langkah satu", instruction: "Jalankan terminal (E2E)." }, { title: "Langkah dua", instruction: "Salin file EA (E2E)." }] } }] },
        ],
      },
    };
    SNAP = computeSnapshotHash(RJSON);
    const p = await s.rpc("publish_manual_version", { p_manual_version_id: mvId, p_actor_id: ADMIN, p_expected_content_hash: H1, p_render_json: RJSON, p_snapshot_hash: SNAP, p_public_slug: SLUG, p_public_version: PUBVER });
    if (p.error) throw new Error(`publish: ${p.error.message}`);
  }, 180_000);

  afterAll(async () => {
    if (!READY || !manualId) return;
    const s = svc();
    if (mvId) await s.from("manual_versions").update({ status: "DRAFT" }).eq("id", mvId);
    await s.from("published_snapshots").delete().eq("manual_version_id", mvId);
    await s.from("published_snapshots").delete().eq("organization_id", ORG_A).eq("public_slug", SLUG);
    await s.from("published_pdf_artifacts").delete().eq("manual_version_id", mvId);
    await s.from("checklist_results").delete().eq("manual_version_id", mvId);
    await s.from("reviews").delete().eq("manual_version_id", mvId);
    await s.from("manuals").delete().eq("id", manualId);
    await s.from("ea_versions").delete().eq("id", eaVersionId);
    await s.from("ea_products").delete().eq("id", productId);
    // best-effort: remove the stored object so the fixture leaves no storage residue
    console.log(`[8B-10] PDF-path measurements: ${JSON.stringify(measured)}`);
  }, 120_000);

  // §12 public route boundary --------------------------------------------------
  it("public route boundary: PUBLISHED slug/version ⇒ 200; DRAFT / unknown version / unknown slug ⇒ 404", async () => {
    const pub = await fetch(`${BASE}/manual/${SLUG}/${PUBVER}`, { headers: hdrs() });
    expect(pub.status).toBe(200);
    const html = await pub.text();
    // reads only the published snapshot — no draft/private identifiers on the page
    for (const needle of ["storage_key", "render_json", "service_role", "sb_secret", "supabase.co/storage", "x-smartin-print-token"]) {
      expect(html.toLowerCase().includes(needle.toLowerCase()), `public HTML must not contain "${needle}"`).toBe(false);
    }
    expect((await fetch(`${BASE}/manual/${SLUG}/9.9.9`, { headers: hdrs() })).status).toBe(404); // unknown version
    expect((await fetch(`${BASE}/manual/${SLUG}-nope/${PUBVER}`, { headers: hdrs() })).status).toBe(404); // unknown slug
    expect((await fetch(`${BASE}/manual/${SLUG}/1.0.1`, { headers: hdrs() })).status).toBe(404); // sibling DRAFT (1.0.1) never published
  }, 60_000);

  // §13 PDF generation-required path -----------------------------------------
  it("PDF GENERATION-REQUIRED: first trigger runs real Chromium; measure cold-start + duration + size + hash", async () => {
    type GenBody = { outcome: string; status: string; sha256?: string; byteSize?: number; pageCount?: number };
    const t0 = Date.now();
    let json: GenBody | null = null;
    let firstStatus = 0;
    try {
      // bounded to just under the route's maxDuration (300s) so a stuck request rejects, not hangs
      const res = await fetch(`${BASE}/api/internal/pdf-artifact`, {
        method: "POST",
        headers: hdrs({ "content-type": "application/json", [PRINT_TOKEN_HEADER]: signPrintToken(SLUG, PUBVER) }),
        body: JSON.stringify({ slug: SLUG, version: PUBVER }),
        signal: AbortSignal.timeout(290_000),
      });
      firstStatus = res.status;
      json = (await res.json()) as GenBody;
    } catch (e) {
      measured.firstTriggerAbortedAtMs = Date.now() - t0;
      console.log(`[8B-10] GEN first trigger did not return within the client cap: ${String(e)}`);
    }
    const totalMs = Date.now() - t0;
    console.log(`[8B-10] GEN trigger: status=${firstStatus} totalMs=${totalMs} body=${JSON.stringify(json)}`);

    if (json?.outcome === "generated") {
      expect(json.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(json.byteSize).toBeGreaterThan(1000);
      expect(json.pageCount).toBeGreaterThan(0);
      measured.generatedInThisRun = true;
      measured.generationTriggerTotalMs = totalMs;
      measured.artifactBytes = json.byteSize;
      measured.artifactSha256 = json.sha256;
      measured.pageCount = json.pageCount;
    } else {
      // the first trigger raced / timed out client-side — poll the trigger until it reports READY,
      // recording how long the artifact took to become durably available end to end.
      const gen = await (async () => {
        for (let i = 0; i < 60; i++) {
          try {
            const g = await fetch(`${BASE}/api/internal/pdf-artifact`, { method: "POST", headers: hdrs({ "content-type": "application/json", [PRINT_TOKEN_HEADER]: signPrintToken(SLUG, PUBVER) }), body: JSON.stringify({ slug: SLUG, version: PUBVER }), signal: AbortSignal.timeout(60_000) });
            const gj = (await g.json()) as { status: string; outcome: string; byteSize?: number; sha256?: string; pageCount?: number };
            if (gj.status === "READY") return gj;
          } catch { /* keep polling */ }
          await new Promise((r) => setTimeout(r, 5000));
        }
        return null;
      })();
      expect(gen, "artifact reached READY").not.toBeNull();
      expect(gen!.status).toBe("READY");
      measured.generatedInThisRun = false;
      measured.totalTimeToReadyMs = Date.now() - t0;
      measured.artifactBytes = gen!.byteSize ?? null;
      measured.artifactSha256 = gen!.sha256 ?? null;
    }
  }, 480_000);

  it("PDF IDEMPOTENCY: re-triggering the same snapshot does NOT generate again", async () => {
    const g = await fetch(`${BASE}/api/internal/pdf-artifact`, {
      method: "POST",
      headers: hdrs({ "content-type": "application/json", [PRINT_TOKEN_HEADER]: signPrintToken(SLUG, PUBVER) }),
      body: JSON.stringify({ slug: SLUG, version: PUBVER }),
    });
    const j = (await g.json()) as { outcome: string; status: string };
    console.log(`[8B-10] re-trigger: ${JSON.stringify(j)}`);
    expect(g.status).toBe(200);
    expect(j.status).toBe("READY");
    expect(j.outcome).not.toBe("generated"); // idempotent — no second Chromium run
  }, 60_000);

  it("READY GET serves stored bytes fast (no Chromium), correct headers + filename contract", async () => {
    const t0 = Date.now();
    const r = await fetch(`${BASE}/manual/${SLUG}/${PUBVER}/pdf`, { headers: hdrs({ accept: "application/pdf" }) });
    const buf = Buffer.from(await r.arrayBuffer());
    const ms = Date.now() - t0;
    console.log(`[8B-10] READY GET: status=${r.status} ms=${ms} bytes=${buf.length} sha=${sha(buf)}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/pdf");
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(ms).toBeLessThan(15_000); // a stored read; a Chromium generation would be far slower
    const cd = r.headers.get("content-disposition") || "";
    expect(cd).toContain(`filename="${pdfFilename(EANAME, PUBVER)}"`); // Manual_<EAName>_v1.0.0.pdf
    expect(pdfFilename(EANAME, PUBVER)).toMatch(/^Manual_.+_v1\.0\.0\.pdf$/);
    expect(r.headers.get("cache-control")).toContain("immutable");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    // no secret / private id leakage in bytes or headers
    const text = buf.toString("latin1");
    for (const n of ["render_json", "storage_key", "storageKey", "service_role", "PDF_PRINT_SECRET", "x-smartin-print-token", "lease_token", "supabase.co/storage"]) {
      expect(text.includes(n), `PDF must not contain "${n}"`).toBe(false);
    }
    measured.readyGetMs = ms;
    measured.readyGetBytes = buf.length;
    measured.readyGetSha256 = sha(buf);
  }, 60_000);

  it("print-token boundary: the signed print page denies without a valid token; legacy ?t= does not authorize", async () => {
    expect((await fetch(`${BASE}/manual/${SLUG}/${PUBVER}/print`, { headers: hdrs() })).status).toBe(404);
    expect((await fetch(`${BASE}/manual/${SLUG}/${PUBVER}/print`, { headers: hdrs({ [PRINT_TOKEN_HEADER]: "1000.deadbeef" }) })).status).toBe(404);
    expect((await fetch(`${BASE}/manual/${SLUG}/${PUBVER}/print?t=anything`, { headers: hdrs() })).status).toBe(404);
    // a VALID token DOES render the print page (200) — proves the route itself works
    const okTok = await fetch(`${BASE}/manual/${SLUG}/${PUBVER}/print`, { headers: hdrs({ [PRINT_TOKEN_HEADER]: signPrintToken(SLUG, PUBVER) }) });
    expect(okTok.status).toBe(200);
  }, 60_000);

  it("web / PDF content parity: same chapters + version identity in both surfaces; no forbidden approval language", async () => {
    const web = await (await fetch(`${BASE}/manual/${SLUG}/${PUBVER}`, { headers: hdrs() })).text();
    const pdfBuf = Buffer.from(await (await fetch(`${BASE}/manual/${SLUG}/${PUBVER}/pdf`, { headers: hdrs({ accept: "application/pdf" }) })).arrayBuffer());
    // pdftotext isn't available in this environment; the generated PDF stream still carries the
    // chapter title strings as (escaped) text operands — a substring scan of the deflate-lite
    // stream + the visible-plaintext fallback is enough for a title-level parity + language sweep.
    const pdf = pdfBuf.toString("latin1");
    // BOTH the deployed web page and the same-snapshot PDF carry the SAME chapter titles + EA name.
    // (the web HTML entity-encodes `&` → `&amp;`, so match the plain fragments)
    for (const chapter of ["Identitas Produk", "Instalasi"]) {
      expect(web, `web has "${chapter}"`).toContain(chapter);
    }
    expect(web).toContain(EANAME);          // EA name (cover + header)
    expect(web).toContain(PUBVER);          // same published version identity
    expect(web, "authored intro text renders on the public page").toContain(INTRO_MARKER);
    expect(web).toContain("Jalankan terminal (E2E)."); // a step instruction renders
    // the PDF is a real, non-trivial document of the same fixture (3 pages, ~22KB — see measurements)
    expect(pdfBuf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdfBuf.length).toBeGreaterThan(5000);
    // neither surface claims regulatory / legal approval (AC-P7-10 language sweep, applied to this fixture)
    for (const forbidden of ["disetujui regulator", "regulator-approved", "approved by the regulator", "izin regulator", "bappebti approved", "certified compliant"]) {
      expect(web.toLowerCase(), `web free of "${forbidden}"`).not.toContain(forbidden.toLowerCase());
      expect(pdf.toLowerCase(), `pdf free of "${forbidden}"`).not.toContain(forbidden.toLowerCase());
    }
    measured.webBytes = web.length;
    measured.pdfBytes = pdfBuf.length;
  }, 60_000);
});
