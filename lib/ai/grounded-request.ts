/**
 * Assemble and validate the ONLY payload a provider is ever given (PRD-AI-003 / PRD-SEC-006 /
 * AC-P4-4): `{ selectedText, factBundle, locale, operation }` — no organisation records, no
 * other manuals, no auth/session/JWT, no Supabase keys, no signed URLs, no source code, no
 * audit logs, no arbitrary DB context.
 */

import {
  GROUNDED_REQUEST_KEYS,
  groundedRequestSchema,
  type FactBundle,
  type GroundedRequest,
  type RevisionOperation,
} from "./types";

export function buildGroundedRequest(args: {
  selectedText: string;
  factBundle: FactBundle;
  locale: string;
  operation: RevisionOperation;
}): GroundedRequest {
  // Construct with EXACTLY the four allowed keys, in a fixed order, then freeze.
  const req: GroundedRequest = {
    selectedText: args.selectedText,
    factBundle: { facts: args.factBundle.facts },
    locale: args.locale,
    operation: args.operation,
  };
  assertGroundedRequestShape(req);
  return Object.freeze(req);
}

/**
 * Throws if the request carries anything other than the four permitted top-level keys.
 * Used by the provider boundary AND asserted directly in tests (AC-P4-4).
 */
export function assertGroundedRequestShape(value: unknown): asserts value is GroundedRequest {
  if (value === null || typeof value !== "object") {
    throw new Error("GroundedRequest must be an object");
  }
  const keys = Object.keys(value as Record<string, unknown>);
  const allowed = new Set<string>(GROUNDED_REQUEST_KEYS);
  const extra = keys.filter((k) => !allowed.has(k));
  if (extra.length > 0) {
    throw new Error(`GroundedRequest carries forbidden extra context: ${extra.join(", ")}`);
  }
  const missing = GROUNDED_REQUEST_KEYS.filter((k) => !keys.includes(k));
  if (missing.length > 0) {
    throw new Error(`GroundedRequest is missing required keys: ${missing.join(", ")}`);
  }
  const parsed = groundedRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`GroundedRequest failed validation: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
}

/** The exact JSON string sent to a provider transport as the user message — nothing else. */
export function serializeGroundedRequest(req: GroundedRequest): string {
  assertGroundedRequestShape(req);
  return JSON.stringify(req);
}
