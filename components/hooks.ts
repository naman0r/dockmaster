"use client";

import { useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/client/api";
import type { ModuleId } from "@/lib/config.client";

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
    let running = false;
    let disposed = false;
    const tick = () => {
      if (document.hidden || running || disposed) return;
      running = true;
      void Promise.resolve()
        .then(() => {
          if (!disposed) return ref.current();
        })
        .finally(() => {
          running = false;
        });
    };
    tick();
    timer = window.setInterval(tick, intervalMs);
    const onVisibility = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);
}

// Hash targets may arrive before async scan results have rendered.
export function usePaletteTarget(data: unknown, reveal?: () => void): void {
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  const pending = useRef("");

  useEffect(() => {
    const scroll = () => {
      if (!pending.current) return;
      const target = document.getElementById(pending.current);
      if (!target) return;
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
      pending.current = "";
    };
    const navigate = (event?: Event) => {
      const href =
        event instanceof CustomEvent
          ? String(event.detail)
          : window.location.href;
      const url = new URL(href, window.location.href);
      if (url.pathname !== window.location.pathname || !url.hash) return;
      try {
        pending.current = decodeURIComponent(url.hash.slice(1));
      } catch {
        return;
      }
      revealRef.current?.();
      // Wait for filters to clear and for modal focus restoration to finish.
      frame = requestAnimationFrame(scroll);
    };
    let frame = 0;
    navigate();
    window.addEventListener("hashchange", navigate);
    window.addEventListener("dockmaster:navigate", navigate);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", navigate);
      window.removeEventListener("dockmaster:navigate", navigate);
    };
  }, []);

  useEffect(() => {
    if (!pending.current) return;
    const target = document.getElementById(pending.current);
    if (target) {
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
      pending.current = "";
    }
  }, [data]);
}

// null until the first read lands, so callers can show everything meanwhile.
export function useModuleSettings(): Record<ModuleId, boolean> | null {
  const [modules, setModules] = useState<Record<ModuleId, boolean> | null>(null);
  useEffect(() => {
    const load = () => {
      void apiGet<{ modules: Record<ModuleId, boolean> }>("/api/settings").then((s) => setModules(s.modules)).catch(() => {});
    };
    load();
    window.addEventListener("dockmaster:settings", load);
    return () => window.removeEventListener("dockmaster:settings", load);
  }, []);
  return modules;
}
