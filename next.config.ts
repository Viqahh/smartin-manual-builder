import type { NextConfig } from "next";

/**
 * Phase 7 slice 4B — Chromium runs ONLY during PDF-artifact generation (publish-time step +
 * ADMIN retry action, both hosted in the `/manuals/*` workspace route functions). The public
 * `GET /manual/<slug>/<version>/pdf` download route never touches Chromium.
 *
 * `serverExternalPackages` keeps `playwright-core` + `@sparticuz/chromium` out of the bundle so
 * the code `require`s the real files (and the brotli Chromium pack) at runtime.
 * `outputFileTracingIncludes` forces the `@sparticuz/chromium` binary pack AND the full
 * `playwright-core` package into the workspace route functions — Next's tracer misses
 * `playwright-core/browsers.json` (loaded via a computed path), so the whole package is pinned.
 *
 * `headers()` hardens the signed print page: `Referrer-Policy: no-referrer` so a subresource
 * request (the Slice-3 image proxy, fonts) never carries anything in `Referer`;
 * `X-Robots-Tag: noindex, nofollow` so the signed page is never indexed.
 */
const CHROMIUM_TRACE = [
  "./node_modules/@sparticuz/chromium/bin/**",
  "./node_modules/playwright-core/**",
];
const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  // Keys are picomatch'd (contains:true) against the NORMALISED app route. Generation is invoked
  // from server actions hosted by the `/manuals/[manualId]/*` routes; `/manual/**/pdf` stays as a
  // belt (harmless if unused).
  outputFileTracingIncludes: {
    "/manuals/**": CHROMIUM_TRACE,
    "/api/internal/pdf-artifact": CHROMIUM_TRACE,
    "/manual/**/pdf": CHROMIUM_TRACE,
  },
  async headers() {
    return [
      {
        source: "/manual/:eaSlug/:version/print",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
