/**
 * Phase 8A.5 — Preview-open transition: exactly-once semantics + no silent failure.
 *
 * Repro of the reported UX bug: clicking Preview was sometimes slow and needed multiple clicks.
 * These lock in: a synchronous re-entrancy guard (repeated clicks do nothing), a single flush,
 * a single navigation, an explicit message on failure, and a loading state that stays up
 * through the transition.
 */
import { describe, it, expect, vi } from "vitest";
import { openPreviewTransition, type FlushResult } from "@/features/manuals/preview-nav";

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

function harness(flush: () => Promise<FlushResult | undefined>) {
  const guard = { current: false };
  const opening: boolean[] = [];
  const messages: (string | null)[] = [];
  const revalidate = vi.fn();
  const navigate = vi.fn();
  const run = () =>
    openPreviewTransition({
      guard,
      flushPending: flush,
      revalidate,
      navigate,
      setOpening: (v) => opening.push(v),
      setMessage: (m) => messages.push(m),
    });
  return { guard, opening, messages, revalidate, navigate, run };
}

describe("openPreviewTransition", () => {
  it("happy path: one flush, one revalidate, one navigate; loading state stays up", async () => {
    const flush = vi.fn(async () => ({ ok: true, failedKeys: [] }));
    const h = harness(flush);

    const outcome = await h.run();

    expect(outcome).toBe("navigated");
    expect(flush).toHaveBeenCalledTimes(1);
    expect(h.revalidate).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(h.opening).toEqual([true]); // never set back to false — the builder unmounts on nav
    expect(h.guard.current).toBe(true); // stays locked through the navigation
  });

  it("double-click → exactly one flush + one navigation (second call is a no-op re-entry)", async () => {
    const gate = deferred<FlushResult>();
    const flush = vi.fn(() => gate.promise);
    const h = harness(() => flush());

    const first = h.run();
    const second = await h.run(); // fires while the first is still awaiting the flush
    expect(second).toBe("reentry");

    gate.resolve({ ok: true, failedKeys: [] });
    expect(await first).toBe("navigated");

    expect(flush).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(h.revalidate).toHaveBeenCalledTimes(1);
  });

  it("many rapid clicks → still exactly one flush + one navigate", async () => {
    const gate = deferred<FlushResult>();
    const flush = vi.fn(() => gate.promise);
    const h = harness(() => flush());

    const runs = [h.run(), h.run(), h.run(), h.run(), h.run()];
    gate.resolve({ ok: true, failedKeys: [] });
    const outcomes = await Promise.all(runs);

    expect(outcomes.filter((o) => o === "navigated")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "reentry")).toHaveLength(4);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledTimes(1);
  });

  it("slow flush resolves → navigation still happens exactly once", async () => {
    const flush = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 60));
      return { ok: true, failedKeys: [] };
    });
    const h = harness(flush);

    expect(await h.run()).toBe("navigated");
    expect(h.navigate).toHaveBeenCalledTimes(1);
  });

  it("failed flush → NO navigation, explicit message, guard released for a retry", async () => {
    const flush = vi.fn(async () => ({ ok: false, failedKeys: ["blk-1"] }));
    const h = harness(flush);

    const outcome = await h.run();

    expect(outcome).toBe("blocked-unsaved");
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.revalidate).not.toHaveBeenCalled();
    expect(h.messages.at(-1)).toMatch(/belum tersimpan/i);
    expect(h.opening).toEqual([true, false]); // loading cleared
    expect(h.guard.current).toBe(false); // a later click can retry

    // retry after fixing the block
    flush.mockResolvedValueOnce({ ok: true, failedKeys: [] });
    expect(await h.run()).toBe("navigated");
    expect(h.navigate).toHaveBeenCalledTimes(1);
  });

  it("flush throws → NO navigation, error message, guard released", async () => {
    const flush = vi.fn(async () => {
      throw new Error("network down");
    });
    const h = harness(flush);

    expect(await h.run()).toBe("error");
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.messages.at(-1)).toMatch(/Gagal membuka Preview/i);
    expect(h.guard.current).toBe(false);
  });

  it("repeated Preview attempts after failures stay responsive (no wedged guard, no duplicate work)", async () => {
    const flush = vi
      .fn<() => Promise<FlushResult | undefined>>()
      .mockResolvedValueOnce({ ok: false, failedKeys: ["x"] })
      .mockRejectedValueOnce(new Error("net"))
      .mockResolvedValueOnce({ ok: true, failedKeys: [] });
    const h = harness(() => flush());

    expect(await h.run()).toBe("blocked-unsaved");
    expect(await h.run()).toBe("error");
    expect(await h.run()).toBe("navigated");

    expect(flush).toHaveBeenCalledTimes(3);
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(h.revalidate).toHaveBeenCalledTimes(1);
  });
});
