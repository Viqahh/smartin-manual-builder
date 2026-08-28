/**
 * Semantic version handling for EA versions and manual versions.
 * Phase 2: `MAJOR.MINOR.PATCH` only (matches the Phase 1 wizard regex and PRD-EA-003).
 */

export const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export type Semver = { major: number; minor: number; patch: number };

export function isSemver(value: string): boolean {
  return SEMVER_PATTERN.test(value.trim());
}

export function parseSemver(value: string): Semver | null {
  const trimmed = value.trim();
  if (!isSemver(trimmed)) return null;
  const [major, minor, patch] = trimmed.split(".").map((n) => Number.parseInt(n, 10));
  return { major, minor, patch };
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

export const SEMVER_MESSAGE_ID = "Gunakan format semver, contoh 1.0.0.";
