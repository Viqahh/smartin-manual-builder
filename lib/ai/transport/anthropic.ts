import "server-only";

/**
 * Anthropic Messages API transport (the one concrete configured-provider adapter).
 *
 * Provider choice + rationale: the repository's environment contract names `AI_PROVIDER` /
 * `AI_API_KEY` but does not pin a vendor. Anthropic's Messages API is a clean JSON HTTP
 * endpoint (no SDK needed on Node 20), it supports a strict system prompt + JSON-only output,
 * and it matches this project's tooling. Everything Anthropic-specific is confined to this
 * file; the rest of the app only sees `AiTransport` / `AIProvider`. Swapping vendors is a new
 * `AiTransport` implementation, nothing else.
 *
 * The API key is read from `AI_API_KEY` at call time, sent only in the request header, and
 * never returned, logged, persisted, or included in an error message.
 */

import { AiTransportError, type AiTransport } from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export function createAnthropicTransport(apiKey: string, model = process.env.AI_MODEL || DEFAULT_MODEL): AiTransport {
  if (!apiKey) throw new AiTransportError("UNAVAILABLE", "Anthropic transport requires an API key");
  return {
    label: "anthropic",
    model,
    async complete({ system, user, maxTokens, timeoutMs }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(ANTHROPIC_URL, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: "user", content: user }],
          }),
        });
      } catch (e) {
        clearTimeout(timer);
        if ((e as Error).name === "AbortError") {
          throw new AiTransportError("TIMEOUT", "AI provider timed out");
        }
        throw new AiTransportError("UNAVAILABLE", "AI provider unreachable");
      }
      clearTimeout(timer);

      if (!res.ok) {
        // Never surface the response body — it can echo request material.
        throw new AiTransportError("BAD_STATUS", `AI provider returned HTTP ${res.status}`);
      }

      const json = (await res.json().catch(() => null)) as
        | { content?: { type?: string; text?: string }[] }
        | null;
      const text = (json?.content ?? [])
        .filter((c) => c?.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("")
        .trim();
      if (!text) throw new AiTransportError("EMPTY", "AI provider returned no text");
      return text;
    },
  };
}
