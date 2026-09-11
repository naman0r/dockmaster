"use client";
import { useMemo, useRef, useState } from "react";
import { apiRequest } from "@/lib/client/api";
import { useMachine } from "./machines";
import type { MachineSnapshot } from "@/lib/machines/protocol";
export function useMachineApi() {
  const { machine } = useMachine();
  const lease = useRef("");
  const received = useRef(0);
  const data = useRef<unknown>(null);
  const [status, setStatus] = useState<{
    state: string;
    error?: string;
    cachedAt?: string | null;
  }>({ state: "loading" });
  const api = useMemo(() => {
    const urlFor = (raw: string) => {
      const url = new URL(raw, "http://dockmaster.local");
      if (
        machine.id !== "local" &&
        !["/api/settings", "/api/notes"].includes(url.pathname)
      )
        url.searchParams.set("machine", machine.id);
      return url.pathname + url.search;
    };
    async function request<T>(
      raw: string,
      method = "GET",
      body?: unknown,
    ): Promise<T> {
      const remote =
        machine.id !== "local" &&
        !["/api/settings", "/api/notes"].includes(raw.split("?")[0]);
      const mutation =
        remote && method !== "GET" && raw !== "/api/repos/refresh";
      let payload = body;
      if (mutation) {
        if (!lease.current || Date.now() - received.current > 90000)
          throw new Error("Refresh this machine before performing an action.");
        const b = { ...((body as Record<string, unknown>) || {}) };
        if (raw.startsWith("/api/worktrees/") && Array.isArray(data.current))
          b.revision = data.current.find(
            (r) => r.path === b.repoPath,
          )?.revision;
        if (raw === "/api/hosts/apply")
          b.revision = (data.current as { revision?: string })?.revision;
        if (raw === "/api/processes/kill" && !b.startedAt)
          b.startedAt = (
            data.current as { sample?: { pid: number; startedAt?: string }[] }
          )?.sample?.find((p) => p.pid === b.pid)?.startedAt;
        payload = b;
        if (!window.confirm(`Perform this action on ${machine.name}?`))
          throw new Error("Action canceled.");
      }
      const grant = lease.current;
      if (mutation) lease.current = "";
      try {
        const result = await apiRequest<T>(urlFor(raw), {
          method,
          ...(method !== "GET" && method !== "DELETE"
            ? { body: JSON.stringify(payload || {}) }
            : {}),
          headers: mutation ? { "X-Dockmaster-Lease": grant } : {},
        });
        if (remote && !mutation) {
          const snap = result as MachineSnapshot<unknown>;
          if (snap.machineId !== machine.id)
            throw new Error("Machine response mismatch.");
          lease.current = snap.state === "ready" ? snap.lease || "" : "";
          received.current = Date.now();
          data.current = snap.data;
          setStatus({
            state: snap.state,
            error: snap.error,
            cachedAt: snap.cachedAt,
          });
        }
        return result;
      } catch (e) {
        if (remote) {
          lease.current = "";
          setStatus((p) => ({
            ...p,
            state: p.cachedAt ? "stale" : "unreachable",
            error: (e as Error).message,
          }));
        }
        throw e;
      }
    }
    return {
      apiGet: <T,>(url: string) => request<T>(url),
      apiPost: <T,>(url: string, body: unknown) =>
        request<T>(url, "POST", body),
      apiDelete: <T,>(url: string) => request<T>(url, "DELETE"),
      lease: () => lease.current,
    };
  }, [machine.id, machine.name]);
  return { ...api, machine, remote: machine.id !== "local", status };
}
export function MachineNotice({
  status,
}: {
  status: { state: string; error?: string; cachedAt?: string | null };
}) {
  const { machine } = useMachine();
  if (machine.id === "local") return null;
  return (
    <p
      role="status"
      className={`mb-4 text-xs ${status.error ? "text-alarm" : "text-muted"}`}
    >
      {status.state}
      {status.cachedAt
        ? ` · collected ${new Date(status.cachedAt).toLocaleTimeString()}`
        : ""}
      {status.error ? ` · ${status.error}` : ""}
    </p>
  );
}
