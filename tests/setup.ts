import "@testing-library/jest-dom/vitest";

// Deterministic, credential-free test environment. Integration suites that need a
// live Supabase project guard themselves with `describe.skipIf(!process.env.SUPABASE_SECRET_KEY)`.
process.env.TZ = "UTC";
