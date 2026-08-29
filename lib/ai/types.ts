/**
 * Grounded AI assistant — shared domain types (Phase 4, PRD-AI-001..007).
 *
 * The AI is a WRITING ASSISTANT, not a source of EA facts. Every request is a
 * `GroundedRequest` = `{ selectedText, factBundle, locale, operation }` and nothing else
 * (PRD-AI-003 / PRD-SEC-006). A provider returns either a `RevisionProposal` (never applied
 * automatically) or `ADDITIONAL_INFORMATION_REQUIRED`. `detectClaims` is an ADVISORY,
 * deterministic compliance-language scan — it never edits content or changes workflow state.
 *
 * This module is import-safe on the client (no `server-only`, no vendor SDK, no env access).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export const AI_OPERATIONS = [
  "improveText",
  "simplifyText",
  "technicalRewrite",
  "generateSteps",
  "generateCaption",
  "detectClaims",
] as const;
export type AiOperation = (typeof AI_OPERATIONS)[number];

/** Operations that produce a before/after `RevisionProposal` for a single block field. */
export const REVISION_OPERATIONS = [
  "improveText",
  "simplifyText",
  "technicalRewrite",
  "generateSteps",
  "generateCaption",
] as const;
export type RevisionOperation = (typeof REVISION_OPERATIONS)[number];

/** Which structured field of a block an operation targets. */
export type TargetField = "content" | "answer" | "question" | "caption" | "steps";

// ---------------------------------------------------------------------------
// Fact bundle (allowlisted — see lib/ai/fact-bundle.ts)
// ---------------------------------------------------------------------------

export const FACT_KINDS = [
  "ea", // EA identity: name, platform, version, manual version
  "setup", // ONE explicit ea_version_setups row — symbol + timeframe kept paired (GI-10)
  "requirement", // ONE key of the linked EA Version's `requirements`
  "parameterGroup", // ONE parameter_groups row of the linked EA Version
  "parameter", // ONE ea_parameters row of the linked EA Version
  "chapter", // the current chapter (title + key)
  "block", // the current block (type)
  "blockContent", // the current allowlisted text of the target block
  "image", // image metadata (alt / caption) — never a URL or binary
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export type Fact = {
  /** Stable, verifiable reference id, e.g. "setup:<uuid>", "parameter:<uuid>", "ea:name". */
  id: string;
  kind: FactKind;
  /** Short human label for the UI ("fakta yang dipakai"). */
  label: string;
  /** The allowlisted value. Objects are shallow and contain only permitted sub-fields. */
  value: unknown;
  /** Where a developer edits this fact for real, e.g. "Supported Configuration". */
  source: string;
};

export type FactBundle = { facts: Fact[] };

export const factSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(FACT_KINDS),
  label: z.string().min(1).max(200),
  value: z.unknown(),
  source: z.string().min(1).max(120),
});
export const factBundleSchema = z.object({ facts: z.array(factSchema).max(400) });

// ---------------------------------------------------------------------------
// GroundedRequest — the ONLY thing a provider ever receives (PRD-AI-003)
// ---------------------------------------------------------------------------

export type GroundedRequest = {
  selectedText: string;
  factBundle: FactBundle;
  locale: string;
  operation: RevisionOperation;
};

/** Exactly these four top-level keys — asserted by `assertGroundedRequestShape`. */
export const GROUNDED_REQUEST_KEYS = ["selectedText", "factBundle", "locale", "operation"] as const;

export const groundedRequestSchema = z
  .object({
    selectedText: z.string().max(20000),
    factBundle: factBundleSchema,
    locale: z.string().min(2).max(10),
    operation: z.enum(REVISION_OPERATIONS),
  })
  .strict();

// ---------------------------------------------------------------------------
// Provider result — RevisionProposal | AdditionalInformationRequired
// ---------------------------------------------------------------------------

export type ProposalOutput =
  | { kind: "text"; text: string }
  | { kind: "steps"; steps: { title: string; instruction: string; menuPath?: string }[] }
  | { kind: "caption"; caption: string };

export type RevisionProposal = {
  status: "PROPOSAL";
  operation: RevisionOperation;
  output: ProposalOutput;
  /** Ids of facts the provider used — every one MUST exist in the supplied FactBundle. */
  factReferences: string[];
};

export type MissingFact = { label: string; hint?: string; surface?: string };

export type AdditionalInformationRequired = {
  status: "ADDITIONAL_INFORMATION_REQUIRED";
  missingFacts: MissingFact[];
};

export type AiResult = RevisionProposal | AdditionalInformationRequired;

const proposalOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(20000) }),
  z.object({
    kind: z.literal("steps"),
    steps: z
      .array(
        z.object({
          title: z.string().min(1).max(200),
          instruction: z.string().min(1).max(2000),
          menuPath: z.string().max(300).optional(),
        }),
      )
      .min(1)
      .max(60),
  }),
  z.object({ kind: z.literal("caption"), caption: z.string().min(1).max(500) }),
]);

export const revisionProposalSchema = z.object({
  status: z.literal("PROPOSAL"),
  operation: z.enum(REVISION_OPERATIONS),
  output: proposalOutputSchema,
  factReferences: z.array(z.string().min(1).max(200)).max(64),
});

export const additionalInformationRequiredSchema = z.object({
  status: z.literal("ADDITIONAL_INFORMATION_REQUIRED"),
  missingFacts: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        hint: z.string().max(300).optional(),
        surface: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(12),
});

export const aiResultSchema = z.discriminatedUnion("status", [
  revisionProposalSchema,
  additionalInformationRequiredSchema,
]);

// ---------------------------------------------------------------------------
// Grounding check
// ---------------------------------------------------------------------------

export type GroundingResult =
  | { ok: true }
  | { ok: false; violations: string[] };

// ---------------------------------------------------------------------------
// Claim scanner (advisory — docs/COMPLIANCE_REQUIREMENTS.md §4)
// ---------------------------------------------------------------------------

export const CLAIM_CATEGORIES = [
  "CLAIM-PROFIT-GUARANTEE",
  "CLAIM-CONSISTENCY",
  "CLAIM-RISK-FREE",
  "CLAIM-UNCONDITIONED-PERF",
  "CLAIM-PROFIT-SHARING",
  "CLAIM-ON-BEHALF",
  "CLAIM-MLM",
  "CLAIM-DEV-MARGIN",
  "CLAIM-REGULATOR-ENDORSE",
  "CLAIM-BROKER-PARTNER",
] as const;
export type ClaimCategory = (typeof CLAIM_CATEGORIES)[number];

export type ClaimFinding = {
  /** COMPLIANCE_REQUIREMENTS.md §4 check id. */
  category: ClaimCategory;
  /** Human category name for the card header. */
  categoryLabel: string;
  /** Advisory only — Phase 4 never blocks, approves, or edits. */
  severity: "advisory";
  /** The matched phrase (short excerpt — never a large content dump). */
  excerpt: string;
  /** Where in the manual it was found. */
  location: string;
  /** Why it is risky. */
  explanation: string;
  /** What a human should do. */
  recommendedAction: string;
};

// ---------------------------------------------------------------------------
// AIProvider — the interface the rest of the app depends on (PRD-AI-001)
// ---------------------------------------------------------------------------

export interface AIProvider {
  /** "mock" or "configured" — surfaced in the UI so mock is unmistakable (PRD-AI-002). */
  readonly mode: "mock" | "configured";
  /** A safe display label ("Mock AI" / "anthropic"). Never contains a credential. */
  readonly label: string;

  improveText(req: GroundedRequest): Promise<AiResult>;
  simplifyText(req: GroundedRequest): Promise<AiResult>;
  technicalRewrite(req: GroundedRequest): Promise<AiResult>;
  generateSteps(req: GroundedRequest): Promise<AiResult>;
  generateCaption(req: GroundedRequest): Promise<AiResult>;

  /** Deterministic, advisory compliance-language scan (see lib/ai/claim-scanner.ts). */
  detectClaims(input: { text: string; locale: string }): Promise<ClaimFinding[]>;
}

export class AiProviderError extends Error {
  readonly code: "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "MALFORMED_RESPONSE" | "CONFIG";
  constructor(code: AiProviderError["code"], message: string) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
  }
}
