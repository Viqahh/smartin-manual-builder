/**
 * Validate that every fact reference a provider returns actually exists in the supplied
 * FactBundle (§6). Provider-invented ids are rejected — the whole result is discarded.
 */

import type { Fact, RevisionProposal } from "./types";

export type FactRefResult =
  | { ok: true }
  | { ok: false; unknownRefs: string[] };

export function validateFactReferences(proposal: RevisionProposal, facts: Fact[]): FactRefResult {
  const known = new Set(facts.map((f) => f.id));
  const unknownRefs = proposal.factReferences.filter((r) => !known.has(r));
  return unknownRefs.length === 0 ? { ok: true } : { ok: false, unknownRefs };
}
