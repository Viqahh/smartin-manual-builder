/**
 * Canonical input hash for AI idempotency (AC-P4-10, PRD-OUT-006).
 *
 * Re-issuing the same logical request for the same target must map to the SAME hash so the
 * server can dedupe a PENDING `ai_revisions` row instead of calling the provider again or
 * creating a duplicate. We reuse the repository's deterministic serialiser
 * (`stableStringify`, recursively key-sorted — the same fix Phase 3 applied for jsonb
 * key-order issues), so the same fact bundle with different object-key order hashes equal.
 *
 * The hash covers ONLY normalised, non-secret inputs: operation, selectedText, locale, the
 * fact bundle, and the target identity. No API key, session token, or signed URL is ever
 * part of the digest.
 */

import { createHash } from "node:crypto";
import { stableStringify } from "@/lib/editor/autosave-queue";
import type { GroundedRequest } from "./types";

export type HashTarget = {
  manualVersionId: string;
  sectionId: string | null;
  blockId: string | null;
  targetField: string | null;
};

export function hashAiRequest(req: GroundedRequest, target: HashTarget): string {
  const canonical = stableStringify({
    v: 1,
    operation: req.operation,
    locale: req.locale.trim().toLowerCase(),
    selectedText: normaliseText(req.selectedText),
    factBundle: req.factBundle,
    target: {
      manualVersionId: target.manualVersionId,
      sectionId: target.sectionId ?? null,
      blockId: target.blockId ?? null,
      targetField: target.targetField ?? null,
    },
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** A hash of just a block's current payload — for stale-target detection on Accept (§18). */
export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload), "utf8").digest("hex");
}

function normaliseText(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/[ \t]*\n[ \t]*/g, "\n").trim();
}
