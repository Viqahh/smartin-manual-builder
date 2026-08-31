/**
 * Phase 7 slice 5 — AC-P7-4 VISUAL regression for the shared manual-document render root.
 *
 * We do NOT pixel-compare the whole public page against the PDF — the TOC / search / version
 * controls intentionally do not appear in print, and the public reading surface uses a larger
 * reading type scale than the A4 PDF. Instead we drive a real Chromium against the deployed
 * Preview and, for the shared `.a4-document`:
 *
 *   1. DETERMINISM — render the same fixture twice, byte-identical screenshots
 *      (fixed viewport, `document.fonts.ready`, all images decoded, animations disabled,
 *      no timestamps / random content). Tolerance: 0 differing bytes.
 *   2. STRUCTURAL invariants on the representative content (cover, first chapter, rich text,
 *      callout, parameter table incl. a long one, standalone image + caption, step image, FAQ,
 *      final chapter): every `.manual-page` renders at natural height (no clipped text), no
 *      document-level horizontal scroll, callout backgrounds painted, images decoded, captions
 *      present, long tables scroll only inside their own wrapper.
 *
 * Screenshots are written to `PDF_E2E_ARTIFACT_DIR` (default: a scratch dir) and their paths are
 * logged — they are test artifacts / baselines, NOT committed.
 *
 * Env: PDF_E2E_BASE_URL, PDF_PRINT_SECRET, PDF_LOCAL_CHROMIUM_PATH  (+ VERCEL_AUTOMATION_BYPASS_SECRET).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { signPrintToken, PRINT_TOKEN_HEADER } from "@/lib/pdf/print-token";

const BASE = process.env.PDF_E2E_BASE_URL?.replace(/\/+$/, "");
const CHROMIUM = process.env.PDF_LOCAL_CHROMIUM_PATH;
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const RUN = Boolean(BASE && process.env.PDF_PRINT_SECRET && CHROMIUM);

const SLUG = process.env.PDF_E2E_VISUAL_SLUG || "p7-pdf-large";
const VERSION = process.env.PDF_E2E_VISUAL_VERSION || "2.0.0";
const ART = process.env.PDF_E2E_ARTIFACT_DIR || join(tmpdir(), "p7-slice5-visual");

const STABILISE = `
  *,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
  html{scroll-behavior:auto!important}
`;

let browser: Browser;

async function prep(page: Page) {
  await page.addStyleTag({ content: STABILISE });
  await page.evaluate(async () => {
    await document.fonts.ready;
    const imgs = Array.from(document.images);
    await Promise.all(
      imgs.map((im) =>
        im.complete && im.naturalWidth > 0
          ? Promise.resolve()
          : new Promise((res) => {
              im.addEventListener("load", res, { once: true });
              im.addEventListener("error", res, { once: true });
            }),
      ),
    );
  });
  await page.waitForTimeout(150);
}

async function openPrint(): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 2400 },
    deviceScaleFactor: 1,
    extraHTTPHeaders: {
      [PRINT_TOKEN_HEADER]: signPrintToken(SLUG, VERSION),
      ...(BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {}),
    },
  });
  const page = await ctx.newPage();
  const resp = await page.goto(`${BASE}/manual/${SLUG}/${VERSION}/print`, { waitUntil: "networkidle", timeout: 60_000 });
  expect(resp?.status(), "print page 200").toBe(200);
  // the print page is consumed by `page.pdf()` which applies `@media print` (the `.pdf-shell`
  // rules un-clip + paginate). Emulate that so the screenshot / structural checks match the PDF.
  await page.emulateMedia({ media: "print" });
  await prep(page);
  return page;
}

async function openWeb(): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 2400 },
    deviceScaleFactor: 1,
    extraHTTPHeaders: BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {},
  });
  const page = await ctx.newPage();
  const resp = await page.goto(`${BASE}/manual/${SLUG}/${VERSION}`, { waitUntil: "networkidle", timeout: 60_000 });
  expect(resp?.status(), "public page 200").toBe(200);
  await prep(page);
  return page;
}

describe.skipIf(!RUN)("AC-P7-4 visual — shared manual document", () => {
  beforeAll(async () => {
    mkdirSync(ART, { recursive: true });
    browser = await chromium.launch({
      executablePath: CHROMIUM!,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none", "--force-color-profile=srgb"],
    });
    console.log(`[visual] artifacts → ${ART}`);
  }, 120_000);
  afterAll(async () => browser?.close());

  it("DETERMINISM — the print .a4-document screenshots byte-identically across two renders", async () => {
    const shot = async () => {
      const page = await openPrint();
      const png = await page.locator("article.a4-document").screenshot();
      await page.context().close();
      return png;
    };
    const a = await shot();
    const b = await shot();
    writeFileSync(join(ART, "print-a4.png"), a);
    console.log(`[visual] print .a4-document: ${a.length} bytes → ${join(ART, "print-a4.png")}`);
    expect(a.equals(b), "two renders of the same fixture must be byte-identical (tolerance: 0)").toBe(true);
  }, 180_000);

  it("STRUCTURAL — representative content renders with no clipped text and no document h-scroll", async () => {
    const page = await openPrint();

    const report = await page.evaluate(() => {
      const q = <T extends Element>(s: string) => document.querySelector(s) as T | null;
      const all = <T extends Element>(s: string) => [...document.querySelectorAll(s)] as T[];
      const doc = document.documentElement;
      const pages = all<HTMLElement>(".a4-document .manual-page");
      const clipped = pages
        .map((p, i) => ({ i, over: p.scrollHeight - p.clientHeight }))
        .filter((x) => x.over > 2);
      const wraps = all<HTMLElement>(".a4-document .manual-table-wrap");
      const bigTable = all<HTMLElement>(".a4-document table.parameter-table").some((t) => t.querySelectorAll("tbody tr").length >= 20);
      const calloutBg = all<HTMLElement>(".a4-document .manual-callout").map((c) => getComputedStyle(c).backgroundColor);
      const figs = all<HTMLElement>(".a4-document figure.manual-image-block, .a4-document figure.manual-step-image");
      return {
        chapters: pages.length,
        cover: !!q(".a4-document .manual-cover .manual-cover-copy h1"),
        firstChapterTitle: (q(".a4-document .manual-page .manual-page-body > h2") as HTMLElement | null)?.textContent?.trim() ?? "",
        finalChapterTitle: (pages.at(-1)?.querySelector(".manual-page-body > h2") as HTMLElement | null)?.textContent?.trim() ?? "",
        richTextParas: all(".a4-document .manual-content p").length,
        callouts: calloutBg.length,
        calloutHasBg: calloutBg.every((c) => c !== "rgba(0, 0, 0, 0)" && c !== "transparent"),
        paramTables: all(".a4-document table.parameter-table").length,
        longParamTable: bigTable,
        faqHeadings: all(".a4-document .manual-content > h3").length,
        figures: figs.length,
        figuresWithCaption: figs.filter((f) => f.querySelector("figcaption")).length,
        imagesDecoded: [...document.images].every((im) => im.complete && im.naturalWidth > 0),
        clippedChapters: clipped,
        docHScroll: doc.scrollWidth - doc.clientWidth,
        // under @media print the wrappers are `overflow: visible` so long tables PAGINATE (they
        // must not become a scroll region in a PDF); `docHScroll` proves nothing overflows the doc.
        tableWrapsPrintVisible: wraps.every((w) => getComputedStyle(w).overflowX === "visible"),
      };
    });
    console.log("[visual] print structural report:", JSON.stringify(report, null, 2));

    expect(report.chapters).toBeGreaterThanOrEqual(10);
    expect(report.cover).toBe(true);
    expect(report.firstChapterTitle.length).toBeGreaterThan(0);
    expect(report.finalChapterTitle.length).toBeGreaterThan(0);
    expect(report.richTextParas).toBeGreaterThan(3);
    expect(report.callouts).toBeGreaterThan(0);
    expect(report.calloutHasBg, "callout backgrounds are painted").toBe(true);
    expect(report.paramTables).toBeGreaterThan(0);
    expect(report.longParamTable, "a >=20-row parameter table is present").toBe(true);
    expect(report.faqHeadings).toBeGreaterThan(0);
    expect(report.figures).toBeGreaterThan(0);
    expect(report.figuresWithCaption).toBe(report.figures);
    expect(report.imagesDecoded, "every image decoded").toBe(true);
    expect(report.clippedChapters, "no chapter clips its own content").toEqual([]);
    expect(report.docHScroll, "no document-level horizontal scroll").toBeLessThanOrEqual(1);
    expect(report.tableWrapsPrintVisible, "long tables paginate (not scroll) in print").toBe(true);

    await page.locator("article.a4-document .manual-cover").screenshot({ path: join(ART, "cover.png") });
    await page.locator("article.a4-document .manual-page").first().screenshot({ path: join(ART, "chapter-1.png") });
    await page.locator("article.a4-document .manual-callout").first().screenshot({ path: join(ART, "callout.png") });
    await page.locator("article.a4-document table.parameter-table").first().screenshot({ path: join(ART, "param-table.png") });
    await page.locator("article.a4-document figure.manual-image-block").first().screenshot({ path: join(ART, "figure.png") });
    await page.locator("article.a4-document figure.manual-step-image").first().screenshot({ path: join(ART, "step-image.png") });
    await page.locator("article.a4-document .manual-page").last().screenshot({ path: join(ART, "chapter-final.png") });
    await page.context().close();
  }, 180_000);

  it("STRUCTURAL — the public WEB reading surface: no clipped chapter, no document h-scroll", async () => {
    const page = await openWeb();
    const report = await page.evaluate(() => {
      const all = <T extends Element>(s: string) => [...document.querySelectorAll(s)] as T[];
      const doc = document.documentElement;
      const pages = all<HTMLElement>(".public-manual .a4-document .manual-page");
      const wraps = all<HTMLElement>(".public-manual .a4-document .manual-table-wrap");
      return {
        chapters: pages.length,
        clipped: pages.map((p, i) => ({ i, over: p.scrollHeight - p.clientHeight })).filter((x) => x.over > 2),
        docHScroll: doc.scrollWidth - doc.clientWidth,
        bodyParaFontPx: parseFloat(getComputedStyle(all(".public-manual .manual-content p")[0] ?? document.body).fontSize),
        paramTableFontPx: parseFloat(getComputedStyle(all(".public-manual .parameter-table")[0] ?? document.body).fontSize),
        // a wide table's horizontal scroll is CONTAINED in its own wrapper on the web reader
        tableWrapsContained: wraps.length > 0 && wraps.every((w) => ["auto", "scroll"].includes(getComputedStyle(w).overflowX)),
        hasChrome: !!document.querySelector(".pm-header .pm-search") && !!document.querySelector(".pm-toc-desktop, .pm-toc-mobile"),
      };
    });
    console.log("[visual] web structural report:", JSON.stringify(report, null, 2));
    await page.locator(".public-manual .a4-document").screenshot({ path: join(ART, "web-a4.png") });
    await page.context().close();

    expect(report.chapters).toBeGreaterThanOrEqual(10);
    expect(report.clipped, "no chapter clips content on the web reader").toEqual([]);
    expect(report.docHScroll, "no document-level horizontal scroll on the web reader").toBeLessThanOrEqual(1);
    expect(report.bodyParaFontPx, "readable reading-surface body text (>= 13px)").toBeGreaterThanOrEqual(13);
    expect(report.paramTableFontPx, "scannable parameter tables (>= 11px)").toBeGreaterThanOrEqual(11);
    expect(report.tableWrapsContained, "wide tables scroll only inside their own wrapper").toBe(true);
    expect(report.hasChrome, "web chrome (search + TOC) present and separate from the document").toBe(true);
  }, 180_000);
});
