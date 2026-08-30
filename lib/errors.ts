/**
 * Typed results for server mutations (docs/ARCHITECTURE.md "Observability and failure handling":
 * "Mutations return typed field or workflow errors"). No raw DB errors or secrets reach the client.
 */

export type FieldIssue = { path: string; message: string };

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false;
      code:
        | "VALIDATION"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "CONFLICT"
        | "NOT_CONFIGURED"
        | "UNAUTHENTICATED"
        | "NO_MEMBERSHIP"
        | "UPLOAD"
        // Phase 6 review workflow
        | "WORKFLOW" // wrong current state / precondition not met (typed workflow error)
        | "STALE" // stale review round or content-hash mismatch (a conflict the loser must retry)
        | "SELF_APPROVAL" // a reviewer who authored/edited the version tried to APPROVE it
        | "NOT_READY" // Phase 5 submission gate: a required in-scope item is still MISSING
        | "INTERNAL";
      message: string;
      issues?: FieldIssue[];
    };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(
  code: Exclude<Extract<ActionResult, { ok: false }>["code"], never>,
  message: string,
  issues?: FieldIssue[],
): ActionResult<never> {
  return { ok: false, code, message, issues };
}

export function validationFail(issues: FieldIssue[]): ActionResult<never> {
  return { ok: false, code: "VALIDATION", message: "Periksa data berikut.", issues };
}

/** Map a Postgres unique-violation to a friendly field issue without leaking internals. */
export function uniqueViolation(path: string, message: string): ActionResult<never> {
  return { ok: false, code: "CONFLICT", message, issues: [{ path, message }] };
}
