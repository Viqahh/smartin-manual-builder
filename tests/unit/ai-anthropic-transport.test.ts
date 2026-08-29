/**
 * Phase 4 — configured-provider transport construction (spec §32, AC-P4-3).
 *
 * No real API call. `fetch` is stubbed. We verify the outbound request shape, that the API key
 * travels ONLY in the header (never the body / model / error), timeout → TIMEOUT, non-2xx →
 * BAD_STATUS with no response body leaked, and empty content → EMPTY.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { createAnthropicTransport } from "@/lib/ai/transport/anthropic";
import { AiTransportError } from "@/lib/ai/transport/types";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const fn = vi.fn(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const KEY = "sk-ant-secret-value-DO-NOT-LEAK";

describe("anthropic transport", () => {
  it("requires an API key", () => {
    expect(() => createAnthropicTransport("")).toThrow(AiTransportError);
  });

  it("POSTs to the Messages API with the key in the x-api-key header only", async () => {
    const fn = stubFetch(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "  {\"ok\":true}  " }] }), { status: 200 }),
    );
    const t = createAnthropicTransport(KEY, "claude-test-model");
    const out = await t.complete({ system: "SYS", user: "USER-PAYLOAD", maxTokens: 100, timeoutMs: 5000 });

    expect(out).toBe('{"ok":true}');
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "claude-test-model",
      max_tokens: 100,
      system: "SYS",
      messages: [{ role: "user", content: "USER-PAYLOAD" }],
    });
    // the key is never in the serialised body
    expect(String(init.body)).not.toContain(KEY);
  });

  it("exposes a safe label + model as metadata (no credential)", () => {
    const t = createAnthropicTransport(KEY, "claude-test-model");
    expect(t.label).toBe("anthropic");
    expect(t.model).toBe("claude-test-model");
    expect(JSON.stringify({ label: t.label, model: t.model })).not.toContain(KEY);
  });

  it("maps an aborted request to TIMEOUT", async () => {
    stubFetch((_url, init) => {
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    });
    const t = createAnthropicTransport(KEY);
    await expect(t.complete({ system: "s", user: "u", maxTokens: 10, timeoutMs: 10 })).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("maps a non-2xx response to BAD_STATUS and never leaks the response body", async () => {
    stubFetch(async () => new Response("secret upstream detail: key sk-ant-xxx", { status: 429 }));
    const t = createAnthropicTransport(KEY);
    const err = await t.complete({ system: "s", user: "u", maxTokens: 10, timeoutMs: 1000 }).catch((e) => e);
    expect(err).toBeInstanceOf(AiTransportError);
    expect(err.code).toBe("BAD_STATUS");
    expect(err.message).not.toContain("secret upstream detail");
    expect(err.message).toContain("429");
  });

  it("maps an empty text response to EMPTY", async () => {
    stubFetch(async () => new Response(JSON.stringify({ content: [] }), { status: 200 }));
    const t = createAnthropicTransport(KEY);
    await expect(t.complete({ system: "s", user: "u", maxTokens: 10, timeoutMs: 1000 })).rejects.toMatchObject({
      code: "EMPTY",
    });
  });
});
