/**
 * Phase 8A.5 — autosave queue save-barrier semantics (data-layer, deterministic, no React).
 *
 * Guarantees under test:
 *   - only one network mutation per block is in flight at a time;
 *   - edits arriving during an in-flight save are coalesced (latest-write-wins);
 *   - a coalesced follow-up after a create resolves to UPDATE — the create→update transition
 *     never depends on React render timing (the id map is consulted synchronously);
 *   - `flushAll()` resolves only after every pending + in-flight save settles and reports
 *     `failedKeys` on conflict / transient error / still-pending;
 *   - `dispose()` fires a pending save best-effort instead of dropping it.
 */
import { describe, it, expect } from "vitest";
import { createAutosaveQueue, type SaveOutcome } from "@/lib/editor/autosave-queue";

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const noopState = () => {};

describe("createAutosaveQueue — single-flight + coalescing", () => {
  it("only one save is in flight at a time; edits during it are coalesced to the latest", async () => {
    const seen: number[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const q = createAutosaveQueue<{ v: number }>({
      debounceMs: 1,
      onState: noopState,
      save: async (_k, payload) => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent -= 1;
        seen.push(payload.v);
        return { ok: true, rowVersion: payload.v };
      },
    });

    q.queue("k", { v: 1 }, 1, true);
    q.queue("k", { v: 2 }, 1);
    q.queue("k", { v: 3 }, 1);
    q.queue("k", { v: 4 }, 1);
    await q.flushAll();

    expect(maxConcurrent).toBe(1);
    // v1 goes out; 2/3 are coalesced away; the final coalesced write is v4 (latest-write-wins)
    expect(seen).toEqual([1, 4]);
  });

  it("a coalesced save after a create resolves to UPDATE, never a second CREATE", async () => {
    // models section-editor `saveImpl`: create-vs-update decided from a SYNCHRONOUS id map
    const idByKey = new Map<string, string>();
    const calls: string[] = [];
    let seq = 0;
    const firstCreate = deferred<void>();

    const q = createAutosaveQueue<{ text: string }>({
      debounceMs: 1,
      onState: noopState,
      save: async (key, payload): Promise<SaveOutcome> => {
        const existing = idByKey.get(key);
        if (existing) {
          calls.push(`update:${payload.text}`);
          return { ok: true, rowVersion: ++seq };
        }
        calls.push(`create:${payload.text}`);
        await firstCreate.promise; // the create is slow; the user keeps typing
        idByKey.set(key, "db-1"); // saveImpl sets keyToId synchronously on success
        return { ok: true, rowVersion: ++seq };
      },
    });

    q.queue("k", { text: "a" }, 1, true);
    await new Promise((r) => setTimeout(r, 0)); // create in flight
    q.queue("k", { text: "ab" }, 1); // more typing during the create
    q.queue("k", { text: "abc" }, 1);
    firstCreate.resolve();
    await q.flushAll();

    expect(calls.filter((c) => c.startsWith("create:"))).toEqual(["create:a"]);
    expect(calls.at(-1)).toBe("update:abc"); // final persisted content == latest client payload
  });
});

describe("createAutosaveQueue — flushAll() barrier", () => {
  it("resolves only after the in-flight save (and its follow-up) complete", async () => {
    const gate = deferred<void>();
    let settled = false;
    const q = createAutosaveQueue<{ v: number }>({
      debounceMs: 5,
      onState: noopState,
      save: async (_k, payload) => {
        await gate.promise;
        settled = true;
        return { ok: true, rowVersion: payload.v };
      },
    });

    q.queue("k", { v: 1 }, 1);
    const done = q.flushAll();
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false); // still waiting on the gated save
    gate.resolve();
    const res = await done;
    expect(settled).toBe(true);
    expect(res).toMatchObject({ ok: true, failedKeys: [], timedOut: false });
  });

  it("times out (ok:false) instead of hanging when a save never resolves", async () => {
    const q = createAutosaveQueue<{ v: number }>({
      debounceMs: 1,
      onState: noopState,
      save: () => new Promise<never>(() => {}), // never resolves — a wedged request
    });
    q.queue("k", { v: 1 }, 1, true);
    const started = Date.now();
    const res = await q.flushAll(120); // short timeout for the test
    expect(Date.now() - started).toBeLessThan(1000);
    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(true);
    expect(res.failedKeys).toContain("k");
  });

  it("reports failedKeys for a transient error and for a genuine conflict", async () => {
    const q = createAutosaveQueue<{ v: number }>({
      debounceMs: 1,
      onState: noopState,
      save: async (key): Promise<SaveOutcome> => {
        if (key === "err") return { ok: false, kind: "error", message: "network" };
        if (key === "cfl") return { ok: false, kind: "conflict", serverRowVersion: 9, serverPayload: { v: 999 } };
        return { ok: true, rowVersion: 2 };
      },
    });

    q.queue("ok", { v: 1 }, 1, true);
    q.queue("err", { v: 1 }, 1, true);
    q.queue("cfl", { v: 1 }, 1, true);
    const res = await q.flushAll();

    expect(res.ok).toBe(false);
    expect(new Set(res.failedKeys)).toEqual(new Set(["err", "cfl"]));
  });

  it("a clean drain reports ok with no failed keys", async () => {
    const q = createAutosaveQueue<{ v: number }>({
      debounceMs: 1,
      onState: noopState,
      save: async (_k, p) => ({ ok: true, rowVersion: p.v }),
    });
    q.queue("a", { v: 1 }, 1);
    q.queue("b", { v: 1 }, 1);
    expect(await q.flushAll()).toMatchObject({ ok: true, failedKeys: [], timedOut: false });
  });
});

describe("createAutosaveQueue — dispose()", () => {
  it("fires a pending save best-effort rather than dropping it", async () => {
    let saved: string | null = null;
    const q = createAutosaveQueue<{ text: string }>({
      debounceMs: 10_000, // long debounce: the timer has NOT fired when we dispose
      onState: noopState,
      save: async (_k, p) => {
        saved = p.text;
        return { ok: true, rowVersion: 1 };
      },
    });

    q.queue("k", { text: "unsent edit" }, 1);
    q.dispose(); // simulates an unmount that was NOT preceded by an explicit flushAll()
    await new Promise((r) => setTimeout(r, 10));

    expect(saved).toBe("unsent edit");
  });
});
