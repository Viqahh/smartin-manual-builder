import { EXPECTED_DEV_PROJECT_REF, EXPECTED_PROD_PROJECT_REF, supabaseProjectRef } from "@/lib/env";

/**
 * Phase 8A.5 — fail-closed environment guard for the LIVE integration suite.
 *
 * The integration suite WRITES (creates EA versions / manuals / blocks, forces checklist
 * results, submits + decides evidence, publishes manual versions, appends audit rows). It may
 * run ONLY against the DEV/Preview Supabase project.
 *
 * Contract:
 *   - No target configured (`SUPABASE_TEST_URL` unset) → return quietly. The suite then
 *     self-skips via its own `describe.skipIf(!HAS_API)`, so the credential-free unit run
 *     (`npm run test`, CI) stays green.
 *   - A target IS configured → it must PROVABLY be the known DEV project, or we throw. An
 *     unrecognised ref, the Production ref, or `APP_ENV=production` all fail closed.
 *
 * Call at module scope in every integration spec so a misconfigured target errors the whole
 * file loudly instead of silently running against the wrong database.
 */
export function assertIntegrationTargetIsDev(): void {
  const url = (process.env.SUPABASE_TEST_URL ?? "").trim();
  if (!url) return; // nothing configured — suite self-skips

  const ref = supabaseProjectRef(url);
  const appEnvRaw = (process.env.APP_ENV ?? "").toLowerCase();

  if (ref === EXPECTED_PROD_PROJECT_REF || appEnvRaw === "production") {
    throw new Error("ABORT — integration tests are not permitted against Production");
  }
  if (ref !== EXPECTED_DEV_PROJECT_REF) {
    throw new Error(
      `ABORT — SUPABASE_TEST_URL project ref '${ref || "(unrecognised)"}' is not the known DEV project ` +
        `(${EXPECTED_DEV_PROJECT_REF}); refusing to run the integration suite`,
    );
  }
}
