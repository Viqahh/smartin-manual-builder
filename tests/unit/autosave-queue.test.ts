import { describe, it, expect, vi } from "vitest";
import {
  createAutosaveQueue,
  payloadsEqual,
  stableStringify,
  type SaveOutcome,
} from "@/lib/editor/autosave-queue";

/**
 * Single-flight autosave controller (Phase 3 conflict-UX fix). Reproduces the one-session
 * false-CONFLICT bug and proves it no longer happens.
 */

type P = { text: string };

/**
 * A fake server: one manual_blocks row with an optimistic `row_version`. `save` behaves exactly
 * like `updateBlock` — it only applies the write when `expected === row_version`, then bumps.
 */
function fakeServer(startVersion = 5) {
  const state = {
    rowVersion: startVersion,
    payload: { text: "seed" } as P,
    calls: [] as { expected: number; payload: P }[],
    holdNext: false as boolean,
  };
  const pendingResolvers: Array<() => void> = [];
  const save = vi.fn(async (_key: string, payload: P, expected: number): Promise<SaveOutcome> => {
    state.calls.push({ expected, payload });
    // allow the test to hold the response open
    if (state.holdNext) {
      await new Promise<void>((r) => pendingResolvers.push(r));
    }
    if (expected !== state.rowVersion) {
      return { ok: false, kind: "conflict", serverRowVersion: state.rowVersion, serverPayload: state.payload };
    }
    state.payload = payload;
    state.rowVersion += 1;
    return { ok: true, rowVersion: state.rowVersion };
  }) as unknown as (key: string, payload: P, expected: number) => Promise<SaveOutcome> & { mock: unknown };
  return {
    save,
    state: state as typeof state & { holdNext?: boolean },
    releaseAll: () => {
      const rs = pendingResolvers.splice(0);
      rs.forEach((r) => r());
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("autosave queue — single-flight per entity", () => {
  it("A. rapid same-session saves: only the first request uses v5; pending edit B is saved with v6; NO conflict", async () => {
    const srv = fakeServer(5);
    const states: string[] = [];
    const q = createAutosaveQueue<P>({
      debounceMs: 0,
      save: srv.save,
      onState: (_k, s) => states.push(s),
    });

    srv.state.holdNext = true;
    q.queue("b", { text: "A" }, 5, true); // edit A -> flush -> in flight, holding
    await flush();
    q.queue("b", { text: "B" }, 5, true); // edit B while A is pending -> MUST NOT send another v5 request
    await flush();
    expect(srv.state.calls).toHaveLength(1);
    expect(srv.state.calls[0].expected).toBe(5);

    srv.state.holdNext = false;
    srv.releaseAll(); // A resolves -> server v6
    await flush();
    await flush();

    expect(srv.state.calls).toHaveLength(2);
    expect(srv.state.calls[1]).toMatchObject({ expected: 6, payload: { text: "B" } }); // B sent with adopted v6
    expect(srv.state.rowVersion).toBe(7);
    expect(srv.state.payload).toEqual({ text: "B" });
    expect(states).not.toContain("conflict");
    expect(states.at(-1)).toBe("saved");
  });

  it("B. three rapid edits coalesce to the latest — not three stale requests", async () => {
    const srv = fakeServer(5);
    const q = createAutosaveQueue<P>({ debounceMs: 0, save: srv.save, onState: () => {} });

    srv.state.holdNext = true;
    q.queue("b", { text: "one" }, 5, true);
    await flush();
    q.queue("b", { text: "two" }, 5, true);
    q.queue("b", { text: "three" }, 5, true);
    await flush();
    expect(srv.state.calls).toHaveLength(1); // still just the first

    srv.state.holdNext = false;
    srv.releaseAll();
    await flush();
    await flush();

    expect(srv.state.calls).toHaveLength(2);
    expect(srv.state.calls[1].payload).toEqual({ text: "three" }); // coalesced to the latest
    expect(srv.state.rowVersion).toBe(7);
  });

  it("C. every success adopts the server-returned version for the next write", async () => {
    const srv = fakeServer(5);
    const seen: number[] = [];
    const q = createAutosaveQueue<P>({
      debounceMs: 0,
      save: srv.save,
      onState: () => {},
      onVersion: (_k, v) => seen.push(v),
    });

    q.queue("b", { text: "1" }, 5, true);
    await flush();
    expect(q.currentVersion("b")).toBe(6);

    q.queue("b", { text: "2" }, undefined, true);
    await flush();
    expect(srv.state.calls.at(-1)?.expected).toBe(6);
    expect(q.currentVersion("b")).toBe(7);

    q.queue("b", { text: "3" }, undefined, true);
    await flush();
    expect(srv.state.calls.at(-1)?.expected).toBe(7);
    expect(seen).toEqual([6, 7, 8]);
  });

  it("D. an immediate queue while a save is in flight is serialized, not double-sent", async () => {
    const srv = fakeServer(5);
    const q = createAutosaveQueue<P>({ debounceMs: 0, save: srv.save, onState: () => {} });

    srv.state.holdNext = true;
    q.queue("b", { text: "edit" }, 5, true);
    await flush();
    // simulate an "undo" landing while the save is in flight
    q.queue("b", { text: "undo-state" }, q.currentVersion("b"), true);
    await flush();
    expect(srv.state.calls).toHaveLength(1); // serialized — nothing else sent yet

    srv.state.holdNext = false;
    srv.releaseAll();
    await flush();
    await flush();
    expect(srv.state.calls).toHaveLength(2);
    expect(srv.state.calls[1].expected).toBe(6); // adopted version, no self-conflict
    expect(srv.state.payload).toEqual({ text: "undo-state" });
  });

  it("G. a transient error keeps the pending draft; retry re-sends it", async () => {
    const srv = fakeServer(5);
    let failOnce = true;
    const save = vi.fn(async (k: string, p: P, e: number): Promise<SaveOutcome> => {
      if (failOnce) {
        failOnce = false;
        return { ok: false, kind: "error", message: "network" };
      }
      return srv.save(k, p, e);
    });
    const states: string[] = [];
    const q = createAutosaveQueue<P>({ debounceMs: 0, save, onState: (_k, s) => states.push(s) });

    q.queue("b", { text: "keep me" }, 5, true);
    await flush();
    expect(states).toContain("error");
    expect(srv.state.payload).toEqual({ text: "seed" }); // nothing persisted, draft not lost

    q.retry("b");
    await flush();
    await flush();
    expect(srv.state.payload).toEqual({ text: "keep me" }); // retry saved the retained draft
    expect(states.at(-1)).toBe("saved");
  });
});

describe("payload canonicalisation (jsonb round-trip safety)", () => {
  it("stableStringify sorts object keys recursively", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(stableStringify([{ y: 1, x: 2 }])).toBe('[{"x":2,"y":1}]');
  });

  it("payloadsEqual ignores key order but respects values and array order", () => {
    expect(payloadsEqual({ type: "faq", question: "Q", answer: "A" }, { answer: "A", question: "Q", type: "faq" })).toBe(true);
    expect(payloadsEqual({ steps: [{ a: 1, b: 2 }] }, { steps: [{ b: 2, a: 1 }] })).toBe(true);
    expect(payloadsEqual({ steps: [1, 2] }, { steps: [2, 1] })).toBe(false);
    expect(payloadsEqual({ q: "Q" }, { q: "Q2" })).toBe(false);
  });

  it("drift is recognised even when the server returns the SAME content with reordered keys", async () => {
    type Q = { type: string; question: string; answer: string };
    const state = { rowVersion: 3, payload: { type: "faq", question: "Q1", answer: "A1" } as Q };
    const save = vi.fn(async (_k: string, payload: Q, expected: number): Promise<SaveOutcome> => {
      if (expected !== state.rowVersion) {
        // mimic Postgres jsonb: keys come back sorted, not in the order the client sent them
        const sorted = Object.keys(state.payload).sort().reduce((o, k) => ({ ...o, [k]: (state.payload as Record<string, unknown>)[k] }), {});
        return { ok: false, kind: "conflict", serverRowVersion: state.rowVersion, serverPayload: sorted };
      }
      state.payload = payload;
      state.rowVersion += 1;
      return { ok: true, rowVersion: state.rowVersion };
    });
    const states: string[] = [];
    const q = createAutosaveQueue<Q>({ debounceMs: 0, save, onState: (_k, s) => states.push(s) });

    q.queue("f", { type: "faq", question: "Q1", answer: "A1" }, 3, true); // saves, lastPersisted set, server -> 4
    await flush();
    state.rowVersion = 9; // a structural op bumped the row_version, content unchanged

    q.queue("f", { type: "faq", question: "Q2", answer: "A1" }, undefined, true); // stale -> conflict w/ key-reordered payload
    await flush();
    await flush();

    expect(states).not.toContain("conflict"); // canonical compare => drift => silent adopt + retry
    expect(state.payload).toEqual({ type: "faq", question: "Q2", answer: "A1" });
    expect(state.rowVersion).toBe(10);
  });
});

describe("autosave queue — conflict classification", () => {
  it("a version-only drift (server content == my last persisted) adopts + retries silently, no conflict UI", async () => {
    const srv = fakeServer(5);
    const states: string[] = [];
    const q = createAutosaveQueue<P>({ debounceMs: 0, save: srv.save, onState: (_k, s) => states.push(s) });

    // first successful save establishes lastPersisted = { text: "v1" }, server -> v6
    q.queue("b", { text: "v1" }, 5, true);
    await flush();
    expect(q.currentVersion("b")).toBe(6);

    // an external actor bumps row_version WITHOUT changing content (e.g. a reorder RPC)
    srv.state.rowVersion = 9; // server payload is still { text: "v1" } — my last persisted

    q.queue("b", { text: "v2" }, undefined, true); // sends expected 6 -> server has 9 -> CONFLICT
    await flush();
    await flush();

    expect(states).not.toContain("conflict"); // classified as drift -> silent
    expect(srv.state.rowVersion).toBe(10);
    expect(srv.state.payload).toEqual({ text: "v2" }); // my edit went through after adopting v9
  });

  it("a genuine external edit pauses writes, keeps the draft, and surfaces a conflict — no auto overwrite", async () => {
    const srv = fakeServer(5);
    const states: { s: string; extra?: unknown }[] = [];
    const q = createAutosaveQueue<P>({
      debounceMs: 0,
      save: srv.save,
      onState: (_k, s, extra) => states.push({ s, extra }),
    });

    q.queue("b", { text: "mine-1" }, 5, true); // server -> v6, lastPersisted { text: "mine-1" }
    await flush();

    // a DIFFERENT writer changes the content
    srv.state.payload = { text: "THEIRS" };
    srv.state.rowVersion = 20;

    q.queue("b", { text: "mine-2" }, undefined, true); // expected 6 vs server 20 -> real conflict
    await flush();
    await flush();

    const last = states.at(-1)!;
    expect(last.s).toBe("conflict");
    expect(last.extra).toMatchObject({ serverRowVersion: 20, serverPayload: { text: "THEIRS" } });
    expect(srv.state.payload).toEqual({ text: "THEIRS" }); // NOT overwritten
    expect(q.isPaused("b")).toBe(true);

    // further edits do NOT auto-write while paused
    q.queue("b", { text: "mine-3" }, undefined, true);
    await flush();
    expect(srv.state.payload).toEqual({ text: "THEIRS" });

    // "Gunakan perubahan saya" -> explicit save against the current server version
    q.resolveUseMine("b", 20);
    await flush();
    await flush();
    expect(srv.state.payload).toEqual({ text: "mine-3" }); // the retained latest draft
    expect(srv.state.rowVersion).toBe(21);
    expect(q.isPaused("b")).toBe(false);
  });

  it("'Muat versi terbaru' adopts the server version + content without a write", async () => {
    const srv = fakeServer(5);
    const q = createAutosaveQueue<P>({ debounceMs: 0, save: srv.save, onState: () => {} });
    q.queue("b", { text: "mine" }, 5, true);
    await flush();

    srv.state.payload = { text: "server" };
    srv.state.rowVersion = 30;
    q.queue("b", { text: "mine2" }, undefined, true);
    await flush();
    await flush();
    expect(q.isPaused("b")).toBe(true);
    const callsBefore = srv.state.calls.length;

    q.resolveUseTheirs("b", 30, { text: "server" });
    await flush();
    expect(srv.state.calls.length).toBe(callsBefore); // no write issued
    expect(q.currentVersion("b")).toBe(30);
    expect(q.isPaused("b")).toBe(false);
  });
});
