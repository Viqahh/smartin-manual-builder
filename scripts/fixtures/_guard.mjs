import { readFileSync } from "node:fs";

/**
 * Phase 8A.5 — fail-closed guard for every fixture / UAT / destructive maintenance script.
 *
 * DEV/Preview and Production use SEPARATE Supabase projects. Any script that creates throwaway
 * users, inserts manuals, mutates workflow state, force-sets checklist results, or deletes
 * fixtures MUST call `assertDevFixtureTarget(url)` before its first write and pass only when:
 *   1. the target project ref is the known DEV ref, AND
 *   2. APP_ENV is not "production", AND
 *   3. the operator has opted in with ALLOW_DESTRUCTIVE_FIXTURES=yes-dev.
 *
 * Anything else — the Production ref, an unrecognised ref, a missing opt-in — throws.
 *
 * The DEV/Prod refs are the public subdomain of each Supabase project URL (NOT secrets);
 * they mirror `EXPECTED_DEV_PROJECT_REF` / `EXPECTED_PROD_PROJECT_REF` in lib/env.ts.
 */
export const DEV_PROJECT_REF = "tmrwhkhydkjaubpuegqa";
export const PROD_PROJECT_REF = "wotidyhpbltoxmzvdqkj";

/** Supabase project ref parsed from a project URL, or "" when unrecognised. */
export function supabaseProjectRef(url) {
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co(?:\/|$)/i.exec((url ?? "").trim());
  return m ? m[1].toLowerCase() : "";
}

/** Parse a dotenv file into a plain object. Never overrides real process.env. Missing file → {}. */
export function loadEnvFile(path = ".env.local") {
  const out = {};
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * @param {string} url  the Supabase project URL the script is about to write to
 * @returns {{ ref: string, appEnv: string }} on success
 * @throws  {Error} with an `ABORT — …` message otherwise
 */
export function assertDevFixtureTarget(url) {
  const ref = supabaseProjectRef(url);
  const appEnv = (process.env.APP_ENV ?? "").toLowerCase();
  const optIn = process.env.ALLOW_DESTRUCTIVE_FIXTURES ?? "";

  if (ref === PROD_PROJECT_REF || appEnv === "production") {
    throw new Error("ABORT — fixture/UAT scripts are not permitted against Production");
  }
  if (ref !== DEV_PROJECT_REF) {
    throw new Error(
      `ABORT — target project ref '${ref || "(unrecognised)"}' is not the known DEV project (${DEV_PROJECT_REF})`,
    );
  }
  if (optIn !== "yes-dev") {
    throw new Error(
      "ABORT — set ALLOW_DESTRUCTIVE_FIXTURES=yes-dev to run destructive fixture scripts against DEV",
    );
  }
  return { ref, appEnv: appEnv || "development" };
}
