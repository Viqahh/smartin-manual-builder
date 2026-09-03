// Type declarations for _guard.mjs (plain JS so it runs under `node` with no build step).
export const DEV_PROJECT_REF: string;
export const PROD_PROJECT_REF: string;
export function supabaseProjectRef(url: string | undefined | null): string;
export function loadEnvFile(path?: string): Record<string, string>;
export function assertDevFixtureTarget(url: string | undefined | null): { ref: string; appEnv: string };
