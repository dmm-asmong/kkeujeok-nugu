"use client";
import { useEffect, useReducer, useRef } from "react";

/** Calls fn every `ms` (paused while the tab is hidden, immediate refresh on return). */
export function usePoll(fn: () => Promise<void> | void, ms: number, enabled = true) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (stop || busy) return;
      clearTimeout(timer);
      busy = true;
      try {
        if (document.visibilityState === "visible") await ref.current();
      } catch {
        /* caller shows errors */
      } finally {
        busy = false;
        if (!stop) timer = setTimeout(run, ms);
      }
    };
    void run();
    const onVis = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onVis);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onVis);
    };
  }, [ms, enabled]);
}

/** Re-render on an interval (for countdowns). */
export function useTicker(ms = 250) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const t = setInterval(force, ms);
    return () => clearInterval(t);
  }, [ms]);
}
