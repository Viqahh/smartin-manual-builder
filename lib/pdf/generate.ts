import "server-only";

/**
 * Phase 7 slice 4 — server-side A4 PDF generation for one published manual.
 *
 * Launches `playwright-core` Chromium (`@sparticuz/chromium` on Vercel), navigates ONLY to the
 * trusted print URL (which carries NO credential), attaches the signed print token as the
 * `x-smartin-print-token` request header on that one navigation, waits for real readiness
 * (`document.fonts.ready` + every `<img>` decoded, bounded), prints A4 with backgrounds, then
 * byte-normalises the volatile PDF metadata so repeat runs of the same immutable snapshot are
 * SHA-256-identical. The browser is always closed in `finally`.
 */

import { chromium } from "playwright-core";
import { resolveChromiumLaunch } from "@/lib/pdf/chromium";
import { normalizePdf } from "@/lib/pdf/normalize";
import { PRINT_TOKEN_HEADER } from "@/lib/pdf/print-token";
import { openPublicImageSource } from "@/lib/publication/public-image-bytes";

const NAV_TIMEOUT_MS = 60_000;
const READY_TIMEOUT_MS = 45_000;

export type PdfResult = {
  bytes: Buffer;
  ms: number;
  pageCountHint: number | null;
  determinismWarning: string | null;
};

// ponytail: one Chromium per process. A serverless instance has ~1 GB; two concurrent
// `page.pdf()` runs there reliably OOM / crash ("Printing failed", "browser has been closed").
// Requests that land on the same warm instance run one-at-a-time; Vercel scales real
// concurrency by spawning more instances (each with its own module scope). Swap for a bounded
// pool if a single instance ever needs parallel renders.
let queue: Promise<unknown> = Promise.resolve();

type GenerateOpts = {
  /** clean print-document URL — NO token / query string / credential. */
  printUrl: string;
  /** signed HMAC print token — injected as the `x-smartin-print-token` header on the print nav ONLY. */
  printToken: string;
  /** public slug + version — used to fulfil the print page's image requests in-process. */
  slug: string;
  version: string;
  publishedAt: string;
  /** VERCEL_AUTOMATION_BYPASS_SECRET value — sent as an HTTP HEADER only, never a query param. */
  bypassSecret?: string;
};

export function generateManualPdf(opts: GenerateOpts): Promise<PdfResult> {
  const run = queue.then(
    () => generateNow(opts),
    () => generateNow(opts),
  );
  queue = run.catch(() => {});
  return run;
}

async function generateNow(opts: GenerateOpts): Promise<PdfResult> {
  const started = Date.now();
  const launch = await resolveChromiumLaunch();
  const browser = await chromium.launch(launch);
  try {
    const context = await browser.newContext(
      opts.bypassSecret
        ? {
            extraHTTPHeaders: {
              "x-vercel-protection-bypass": opts.bypassSecret,
              "x-vercel-set-bypass-cookie": "true",
            },
          }
        : {},
    );
    // Fulfil the print page's `/manual/<slug>/<version>/image/<idx>` requests IN-PROCESS, straight
    // from private Storage — no second serverless-function invocation. That HTTP fan-out (1 per
    // image, another cold function each) is what made generation time out under concurrency. The
    // snapshot is verified ONCE here, not per image.
    // The print token travels ONLY here — as a request header on the exact print-document
    // navigation, never in the URL, never on any subrequest.
    await context.route(
      (u) => u.href === opts.printUrl,
      async (route) => {
        const headers = { ...(await route.request().allHeaders()), [PRINT_TOKEN_HEADER]: opts.printToken };
        await route.continue({ headers });
      },
    );

    const imageSource = await openPublicImageSource(opts.slug, opts.version);
    await context.route(/\/manual\/[^/]+\/[^/]+\/image\/[^/]+(\?|$)/, async (route) => {
      try {
        const path = new URL(route.request().url()).pathname;
        const m = path.match(/\/image\/([^/]+)$/);
        const img = m && imageSource ? await imageSource.get(m[1]) : null;
        if (!img) return route.fulfill({ status: 404, body: "" });
        return route.fulfill({
          status: 200,
          contentType: img.mime,
          headers: { "X-Content-Type-Options": "nosniff" },
          body: Buffer.from(img.bytes),
        });
      } catch {
        return route.fulfill({ status: 502, body: "" });
      }
    });

    const page = await context.newPage();

    const resp = await page.goto(opts.printUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    if (!resp || resp.status() !== 200) throw new Error(`print page HTTP ${resp?.status() ?? "no-response"}`);

    // Real readiness — NOT a fixed sleep. Force every image eager (a lazy image below the fold
    // never loads during page.pdf()), then await `fonts.ready` + every `<img>` decoded. Each image
    // gets 2 reload retries (the same-origin image proxy can transiently drop a request under a
    // burst of parallel PDF jobs); only an image that fails EVERY attempt rejects, so a broken PDF
    // is never exported but a transient blip does not fail the job.
    await Promise.race([
      page.evaluate(async () => {
        const decode = (im: HTMLImageElement, attempt: number): Promise<void> => {
          if (im.complete && im.naturalWidth > 0) return Promise.resolve();
          return new Promise<void>((res, rej) => {
            im.addEventListener("load", () => res(), { once: true });
            im.addEventListener(
              "error",
              () => {
                if (attempt >= 2) {
                  rej(new Error(`image failed: ${im.getAttribute("src") ?? "?"}`));
                  return;
                }
                const base = (im.getAttribute("src") ?? "").split("?")[0].split("#")[0];
                setTimeout(
                  () => {
                    im.src = `${base}?retry=${attempt + 1}`; // query is ignored by the image route; forces a fresh fetch
                    decode(im, attempt + 1).then(res, rej);
                  },
                  250 * (attempt + 1),
                );
              },
              { once: true },
            );
          });
        };
        for (const im of Array.from(document.images)) {
          im.loading = "eager";
          if (!im.complete && !im.getAttribute("src")?.startsWith("data:")) im.src = im.src;
        }
        await document.fonts.ready;
        await Promise.all(Array.from(document.images).map((im) => decode(im, 0)));
      }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("document readiness timed out")), READY_TIMEOUT_MS),
      ),
    ]);

    const raw = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="width:100%;padding:0 14mm 0 0;font-size:8px;color:#94a3b8;' +
        'font-family:Arial,sans-serif;text-align:right;">' +
        '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });

    const { bytes, changed } = normalizePdf(raw, opts.publishedAt);
    const missed = (Object.keys(changed) as (keyof typeof changed)[]).filter((k) => !changed[k]);

    // cheap page-count hint from the PDF (count `/Type /Page` objects, not /Pages)
    const pageCountHint = (bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length || null;

    return {
      bytes,
      ms: Date.now() - started,
      pageCountHint,
      determinismWarning: missed.length ? `volatile PDF field(s) not normalised: ${missed.join(", ")}` : null,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
