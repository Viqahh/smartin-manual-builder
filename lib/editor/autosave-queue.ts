/**
 * Single-flight, coalescing autosave controller — one per editor surface, keyed per entity
 * (block key, section id, …). Fixes the one-session false-CONFLICT class of bugs:
 *
 *   - ONLY ONE save request is ever in flight for a given entity. While it is pending, further
 *     edits update `pending` (the latest desired state) — they never issue a second write with
 *     the same `expectedRowVersion`.
 *   - The authoritative `rowVersion` lives here (a plain object, not React state / a closure).
 *     Every successful save adopts the server-returned version immediately; the next coalesced
 *     save uses that version.
 *   - A CONFLICT is classified: if the server's current content equals what THIS client last
 *     persisted, it is a version-only drift (an overlapping self-save, or a structural mutation
 *     that bumped row_version) → adopt the server version and retry the pending state silently.
 *     Otherwise it is a genuine external edit → pause writes, keep the draft, surface it.
 *
 * It does NOT change the server's optimistic-concurrency guard — the server still runs
 * `UPDATE … WHERE row_version = $expected` and returns CONFLICT on a stale write.
 */

export type SaveOutcome =
  | { ok: true; rowVersion: number }
  /** the stale-version write clashed, but the server content is one THIS client recognises
   *  (a version-only drift from an overlapping save / structural mutation) — adopt + retry silently */
  | { ok: false; kind: "retry"; serverRowVersion: number }
  /** the stale-version write clashed and the server content is NOT recognised — genuine external edit */
  | { ok: false; kind: "conflict"; serverRowVersion: number; serverPayload: unknown }
  | { ok: false; kind: "error"; message: string };

export type EntitySaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

/**
 * Deterministic JSON with recursively sorted object keys. Payloads make a round trip through
 * Postgres `jsonb` (which does NOT preserve key order) and Zod (which emits keys in schema
 * order), so a raw `JSON.stringify` of a server payload never matches the client's snapshot of
 * "the same" content. Every payload equality check in the autosave path — coalescing, the
 * self-race/drift classification, and the editor's "have I seen this server content?" test —
 * must normalise first or it silently degrades into a false CONFLICT.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, function keySorter(_k, v) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return v;
  });
}

/** Canonical deep equality for payloads (key-order- and jsonb-round-trip-insensitive). */
export function payloadsEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

type Entity<P> = {
  rowVersion: number; // authoritative — the ONLY version used for writes
  pending: P | null; // latest desired payload not yet confirmed persisted
  lastPersisted: P | null; // last payload the server confirmed (self-race detection)
  inFlight: boolean;
  /** resolves when this entity is fully drained (pending === null) or terminally paused/errored */
  inFlightPromise: Promise<void> | null;
  paused: boolean; // true after a genuine external conflict — no auto-writes until resolved
  lastError: boolean; // last completed attempt was a transient error (for flushAll reporting)
  timer: ReturnType<typeof setTimeout> | null;
};

export type AutosaveQueueOptions<P> = {
  debounceMs?: number;
  save: (key: string, payload: P, expectedRowVersion: number) => Promise<SaveOutcome>;
  equals?: (a: P, b: P) => boolean;
  onState: (
    key: string,
    state: EntitySaveState,
    extra?: { message?: string; serverRowVersion?: number; serverPayload?: unknown },
  ) => void;
  /** every adopted rowVersion, so visible React state can mirror it */
  onVersion?: (key: string, rowVersion: number) => void;
};

export function createAutosaveQueue<P>(opts: AutosaveQueueOptions<P>) {
  const eq = opts.equals ?? ((a: P, b: P) => payloadsEqual(a, b));
  const debounceMs = opts.debounceMs ?? 800;
  const map = new Map<string, Entity<P>>();

  function get(key: string, seedVersion: number): Entity<P> {
    let e = map.get(key);
    if (!e) {
      e = {
        rowVersion: seedVersion,
        pending: null,
        lastPersisted: null,
        inFlight: false,
        inFlightPromise: null,
        paused: false,
        lastError: false,
        timer: null,
      };
      map.set(key, e);
    }
    return e;
  }

  /**
   * Returns a promise that resolves only once `key` is fully drained (pending === null) or has
   * terminally paused/errored. Safe to call repeatedly — it dedupes onto the in-flight run and
   * `flushAll()` / `flushPending()` can await it. The create→update transition never depends on
   * React render timing: `opts.save` decides create-vs-update from a synchronously-updated id
   * map, and a coalesced follow-up here is AWAITED (not fire-and-forget).
   */
  function flush(key: string): Promise<void> {
    const e = map.get(key);
    if (!e || e.paused || e.pending == null) return e?.inFlightPromise ?? Promise.resolve();
    if (e.inFlight) return e.inFlightPromise ?? Promise.resolve();
    e.inFlightPromise = doFlush(key).finally(() => {
      const cur = map.get(key);
      if (cur && !cur.inFlight && cur.pending == null) cur.inFlightPromise = null;
    });
    return e.inFlightPromise;
  }

  async function doFlush(key: string): Promise<void> {
    const e = map.get(key);
    if (!e || e.inFlight || e.paused || e.pending == null) return;

    const payload = e.pending;
    e.pending = null;
    e.inFlight = true;
    e.lastError = false;
    opts.onState(key, "saving");

    let out: SaveOutcome;
    try {
      out = await opts.save(key, payload, e.rowVersion);
    } catch (err) {
      out = { ok: false, kind: "error", message: err instanceof Error ? err.message : "Gagal menyimpan." };
    }
    e.inFlight = false;

    if (out.ok) {
      e.rowVersion = out.rowVersion;
      e.lastPersisted = payload;
      opts.onVersion?.(key, out.rowVersion);
      if (e.pending != null && !eq(e.pending, payload)) {
        opts.onState(key, "dirty");
        await doFlush(key); // a newer desired state arrived while we were saving — AWAIT it
      } else {
        e.pending = null;
        opts.onState(key, "saved");
      }
      return;
    }

    // `retry`: the caller recognised the server content (overlapping self-save / structural bump).
    // Also handle it here as a fast path when the server content == what I last persisted.
    if (
      out.kind === "retry" ||
      (out.kind === "conflict" && e.lastPersisted != null && eq(out.serverPayload as P, e.lastPersisted))
    ) {
      e.rowVersion = out.serverRowVersion;
      opts.onVersion?.(key, e.rowVersion);
      e.pending = e.pending ?? payload; // re-send the latest desired state
      await doFlush(key);
      return;
    }

    if (out.kind === "conflict") {
      // genuine external edit — keep the user's draft, stop auto-writes, surface it
      e.paused = true;
      e.pending = e.pending ?? payload;
      opts.onState(key, "conflict", { serverRowVersion: out.serverRowVersion, serverPayload: out.serverPayload });
      return;
    }

    // transient error — keep the draft, allow retry
    e.pending = e.pending ?? payload;
    e.lastError = true;
    opts.onState(key, "error", { message: out.message });
  }

  return {
    /** Coalesce the latest desired payload for `key`; schedules a save (or runs it now). */
    queue(key: string, payload: P, seedVersion = 1, immediate = false) {
      const e = get(key, seedVersion);
      e.pending = payload;
      if (e.paused) {
        opts.onState(key, "conflict");
        return;
      }
      opts.onState(key, "dirty");
      if (e.timer) clearTimeout(e.timer);
      if (immediate) {
        e.timer = null;
        void flush(key);
      } else {
        e.timer = setTimeout(() => {
          e.timer = null;
          void flush(key);
        }, debounceMs);
      }
    },

    /** Force a flush now (respects the in-flight lock). */
    flushNow(key: string) {
      const e = map.get(key);
      if (e?.timer) {
        clearTimeout(e.timer);
        e.timer = null;
      }
      void flush(key);
    },

    /**
     * Phase 8A.5 save barrier — persist EVERYTHING now and wait for it. Fires every pending
     * debounce timer immediately, awaits every in-flight save and any coalesced follow-up, and
     * reports which entities did NOT reach a clean persisted state (conflict / transient error /
     * still-pending). Callers (chapter navigation, Preview) MUST await this and refuse to
     * navigate on `ok === false`.
     *
     * Bounded by `timeoutMs` (default 15s) so a wedged network request can never hang navigation
     * forever: on timeout it resolves `ok:false` (the in-flight save keeps going; a later retry
     * re-drains it) rather than leaving the caller — and the Preview button — stuck.
     */
    async flushAll(timeoutMs = 15_000): Promise<{ ok: boolean; failedKeys: string[]; timedOut: boolean }> {
      let timedOut = false;
      const drain = (async () => {
        for (let guard = 0; guard < 100 && !timedOut; guard += 1) {
          const keys = [...map.keys()].filter((k) => {
            const e = map.get(k);
            // Drain timers, in-flight saves, and freshly-coalesced edits — but do NOT auto-retry
            // an entity whose last attempt was a transient error (that stays for the user's
            // explicit retry) or a genuine conflict (paused). Those surface as failedKeys.
            return !!e && (e.timer != null || e.inFlight || (e.pending != null && !e.paused && !e.lastError));
          });
          if (keys.length === 0) break;
          await Promise.all(
            keys.map((k) => {
              const e = map.get(k);
              if (e?.timer) {
                clearTimeout(e.timer);
                e.timer = null;
              }
              return flush(k);
            }),
          );
        }
      })();
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        drain,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve();
          }, timeoutMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
      const failedKeys = [...map.entries()]
        .filter(([, e]) => e.paused || e.lastError || e.pending != null || e.inFlight)
        .map(([k]) => k);
      return { ok: failedKeys.length === 0 && !timedOut, failedKeys, timedOut };
    },

    /** Adopt a row_version bumped out-of-band (reorder/duplicate/restore/undo-redo). */
    adoptVersion(key: string, rowVersion: number) {
      get(key, rowVersion).rowVersion = rowVersion;
    },

    currentVersion(key: string): number | undefined {
      return map.get(key)?.rowVersion;
    },

    hasPending(key: string): boolean {
      const e = map.get(key);
      return !!e && (e.pending != null || e.inFlight);
    },

    isPaused(key: string): boolean {
      return map.get(key)?.paused ?? false;
    },

    /** "Gunakan perubahan saya" — save the retained draft against the current server version. */
    resolveUseMine(key: string, serverRowVersion: number) {
      const e = map.get(key);
      if (!e) return;
      e.rowVersion = serverRowVersion;
      e.paused = false;
      if (e.pending != null) {
        opts.onState(key, "dirty");
        void flush(key);
      } else {
        opts.onState(key, "saved");
      }
    },

    /** "Muat versi terbaru" — caller replaces local content first, then adopts the version. */
    resolveUseTheirs(key: string, serverRowVersion: number, adoptedPayload: P) {
      const e = map.get(key);
      if (!e) return;
      e.rowVersion = serverRowVersion;
      e.pending = null;
      e.lastPersisted = adoptedPayload;
      e.paused = false;
      opts.onState(key, "saved");
    },

    /** Retry after a transient error. */
    retry(key: string) {
      const e = map.get(key);
      if (!e || e.inFlight) return;
      if (e.pending != null) void flush(key);
    },

    /** Drop a pending/scheduled save for an entity being removed. */
    cancel(key: string) {
      const e = map.get(key);
      if (e?.timer) {
        clearTimeout(e.timer);
        e.timer = null;
      }
      if (e) e.pending = null;
    },

    /**
     * Best-effort only. Correctness comes from an explicit `await flushAll()` BEFORE navigation
     * (Phase 8A.5) — never from this unmount path. We still fire any pending save so a stray
     * unmount that wasn't preceded by a barrier does not silently lose an edit; the map is kept
     * so an in-flight `doFlush` can still complete its write.
     */
    dispose() {
      for (const [key, e] of map.entries()) {
        if (e.timer) {
          clearTimeout(e.timer);
          e.timer = null;
        }
        if (e.pending != null && !e.paused && !e.inFlight) void flush(key);
      }
    },
  };
}

export type AutosaveQueue<P> = ReturnType<typeof createAutosaveQueue<P>>;
