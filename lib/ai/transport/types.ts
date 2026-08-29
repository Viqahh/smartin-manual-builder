/**
 * Vendor-neutral transport boundary. `ConfiguredAIProvider` depends ONLY on this interface;
 * the concrete implementation (`anthropic.ts`) is the single place any vendor detail lives.
 * Tests inject a deterministic fake transport (no network, no key) — see §32.
 */

export interface AiTransport {
  /** Safe display label, e.g. "anthropic". Never contains a credential. */
  readonly label: string;
  /** Model identifier, safe to persist as metadata. */
  readonly model: string;
  /**
   * Send a single completion. `system` is the trusted instruction; `user` is the serialised
   * GroundedRequest and is treated as untrusted document content. Returns the raw text the
   * caller must parse + validate (never trusted as-is).
   */
  complete(args: { system: string; user: string; maxTokens: number; timeoutMs: number }): Promise<string>;
}

export class AiTransportError extends Error {
  readonly code: "UNAVAILABLE" | "TIMEOUT" | "BAD_STATUS" | "EMPTY";
  constructor(code: AiTransportError["code"], message: string) {
    super(message);
    this.name = "AiTransportError";
    this.code = code;
  }
}
