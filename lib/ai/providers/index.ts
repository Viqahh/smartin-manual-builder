import "server-only";

/**
 * Server-only provider selection (PRD-AI-002, AC-P4-3).
 *
 *   - `AI_PROVIDER` and `AI_API_KEY` BOTH absent  -> MockAIProvider (the default).
 *   - BOTH present                                -> the configured provider.
 *   - EXACTLY ONE present                         -> throw a config error (no silent fallback).
 *
 * The API key never leaves this module tree: it is read here, handed to the transport for the
 * request header only, and is never returned, logged, persisted, or put in an error message.
 */

import { MockAIProvider } from "./mock";
import { ConfiguredAIProvider } from "./configured";
import { createAnthropicTransport } from "../transport/anthropic";
import { AiProviderError, type AIProvider } from "../types";

export type ProviderMode = "mock" | "configured";

export function resolveProviderMode(env: {
  AI_PROVIDER?: string;
  AI_API_KEY?: string;
}): { mode: ProviderMode } | { error: string } {
  const provider = (env.AI_PROVIDER ?? "").trim();
  const key = (env.AI_API_KEY ?? "").trim();
  const hasProvider = provider.length > 0 && provider.toLowerCase() !== "mock";
  const hasKey = key.length > 0;

  if (!hasProvider && !hasKey) return { mode: "mock" };
  if (hasProvider && hasKey) return { mode: "configured" };
  return {
    error: hasProvider
      ? "AI_PROVIDER is set but AI_API_KEY is missing — configure both or neither."
      : "AI_API_KEY is set but AI_PROVIDER is missing — configure both or neither.",
  };
}

let cached: AIProvider | null = null;

/** The process-wide provider. Throws `AiProviderError("CONFIG")` on a half-configured env. */
export function getAIProvider(): AIProvider {
  if (cached) return cached;
  const decision = resolveProviderMode({
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_API_KEY: process.env.AI_API_KEY,
  });
  if ("error" in decision) throw new AiProviderError("CONFIG", decision.error);

  if (decision.mode === "mock") {
    cached = new MockAIProvider();
    return cached;
  }

  const provider = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  const key = (process.env.AI_API_KEY ?? "").trim();
  // The only concrete adapter shipped in Phase 4. Any other value is a config error rather
  // than a silent fallback.
  if (provider === "anthropic") {
    cached = new ConfiguredAIProvider(createAnthropicTransport(key));
    return cached;
  }
  throw new AiProviderError(
    "CONFIG",
    `Unsupported AI_PROVIDER "${provider}". Phase 4 ships the "anthropic" adapter; set AI_PROVIDER=anthropic or leave AI_PROVIDER/AI_API_KEY empty for mock.`,
  );
}

/** For tests / status reporting — does NOT touch credentials. */
export function currentProviderMode(): ProviderMode | "config-error" {
  const decision = resolveProviderMode({
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_API_KEY: process.env.AI_API_KEY,
  });
  return "error" in decision ? "config-error" : decision.mode;
}

/** Reset the memoised provider (tests only). */
export function __resetAIProviderForTests(): void {
  cached = null;
}
