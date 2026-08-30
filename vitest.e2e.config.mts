import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Phase 7 slice 4 — the dedicated PDF / E2E job. Kept OUT of `npm run test` so CI unit runs never
 * need server-side Chromium or a live deployment. Runs a real `/manual/.../pdf` endpoint given
 * `PDF_E2E_BASE_URL`; skips every spec when that env var is absent.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/e2e/**/*.e2e.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
