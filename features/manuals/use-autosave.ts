"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_AUTOSAVE_DEBOUNCE_MS, type SaveState } from "@/lib/domain/autosave";
import type { AutosaveResult } from "./autosave-actions";

/**
 * Debounced autosave with real conflict handling (AC-P2-20).
 * "Tersimpan" is set ONLY after the server confirms success; a stale write surfaces
 * "Konflik perubahan" and never silently overwrites a newer version.
 */
export function useAutosave<T>(opts: {
  save: (value: T, expectedRowVersion: number) => Promise<AutosaveResult>;
  initialRowVersion: number;
  debounceMs?: number;
}) {
  const [state, setState] = useState<SaveState>("idle");
  const optsRef = useRef(opts);

  const rowVersion = useRef(opts.initialRowVersion);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ value: T } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    optsRef.current = opts;
  });

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function flush() {
    if (inFlight.current || pending.current === null) return;
    const { value } = pending.current;
    pending.current = null;
    inFlight.current = true;
    setState("saving");
    try {
      const result = await optsRef.current.save(value, rowVersion.current);
      if (result.ok) {
        rowVersion.current = result.data.rowVersion;
        setState(pending.current !== null ? "dirty" : "saved");
      } else if (result.code === "CONFLICT") {
        setState("conflict");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    } finally {
      inFlight.current = false;
      if (pending.current !== null) void flush();
    }
  }

  function queue(value: T) {
    pending.current = { value };
    setState((s) => (s === "conflict" ? s : "dirty"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush();
    }, optsRef.current.debounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS);
  }

  return {
    state,
    queue,
    flush,
    currentRowVersion: () => rowVersion.current,
  };
}
