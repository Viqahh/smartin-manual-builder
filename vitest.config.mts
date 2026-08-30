import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    // Default to node; DOM specs opt in with `// @vitest-environment jsdom` at the top of the file.
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    // The live integration suite makes many sequential round-trips to the remote DEV project
    // (workflow RPCs). A generous ceiling never slows a passing test.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
