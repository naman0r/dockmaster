"use client";

import { useEffect, useRef } from "react";

// Poll on an interval, skip ticks while the tab is hidden, and refresh once
// when the tab becomes visible again. This is what keeps every module
// demand-driven: close the tab and nothing scans.
export function usePoll(
  fn: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
): void {
  const ref = useRef(fn);
  ref.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const tick = () => {
      if (!document.hidden) void ref.current();
    };
    tick();
    timer = window.setInterval(tick, intervalMs);
    const onVisibility = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);
}
