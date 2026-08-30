import "server-only";

/**
 * Phase 7 slice 4 — environment-aware Chromium launch options for `playwright-core`.
 *
 *   Vercel / serverless  → `@sparticuz/chromium` (bundled headless binary + tuned args).
 *   Local dev            → `PDF_LOCAL_CHROMIUM_PATH` (a Playwright-installed Chromium); no
 *                          hard-coded Mac path in the source.
 */

export type ChromiumLaunch = { executablePath: string; args: string[]; headless: true };

const isServerless = () =>
  !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.AWS_EXECUTION_ENV;

// `@sparticuz/chromium` extracts the ~50 MB binary into /tmp on first `executablePath()`. Resolve
// once per instance so a re-extraction can't race a concurrent launch. Args are left as
// `chromium.args` (its build already sizes /dev/shm correctly — adding `--disable-dev-shm-usage`
// or toggling graphics mode both regressed launch stability on this project's Fluid instances).
let serverlessLaunch: Promise<ChromiumLaunch> | null = null;

export async function resolveChromiumLaunch(): Promise<ChromiumLaunch> {
  if (isServerless()) {
    serverlessLaunch ??= (async () => {
      const chromium = (await import("@sparticuz/chromium")).default;
      return {
        executablePath: await chromium.executablePath(),
        args: [...chromium.args, "--font-render-hinting=none"],
        headless: true as const,
      };
    })();
    return serverlessLaunch;
  }
  const local = process.env.PDF_LOCAL_CHROMIUM_PATH;
  if (!local) throw new Error("PDF_LOCAL_CHROMIUM_PATH is not set (local PDF generation)");
  return {
    executablePath: local,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    headless: true,
  };
}
