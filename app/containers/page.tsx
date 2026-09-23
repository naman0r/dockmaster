"use client";

import { useCallback, useMemo, useState } from "react";
import { useMachineApi, MachineNotice } from "@/components/machine-api";
import { usePoll } from "@/components/hooks";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  SearchInput,
  Toggle,
  useToast,
} from "@/components/ui";
import type { Container, ContainersData } from "@/lib/containers";

type Snapshot = {
  enabled: boolean;
  cachedAt: string | null;
  data: ContainersData | null;
  scanMs?: number;
  state?: string;
  error?: string;
};

export default function ContainersPage() {
  const { apiGet, apiPost, remote, machine, status } = useMachineApi();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  const [enabled, setEnabled] = useState(true);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<Snapshot>("/api/containers");
      setSnap(data);
      setError(data.error || "");
    } catch (err) {
      setError(`Scanner unavailable: ${(err as Error).message}`);
    }
  }, [machine.id]);

  usePoll(refresh, 4000);

  const visible = useMemo(() => {
    const list = snap?.data?.containers || [];
    const needle = query.trim().toLowerCase();
    return needle
      ? list.filter((c) =>
          `${c.name} ${c.image} ${c.project} ${c.ports} ${c.status}`.toLowerCase().includes(needle),
        )
      : list;
  }, [snap, query]);

  const stop = useCallback(
    async (c: Container) => {
      setStopping((prev) => new Set(prev).add(c.id));
      try {
        const r = await apiPost<{ stillRunning: boolean }>("/api/containers/stop", {
          id: c.id,
          createdAt: c.createdAt,
        });
        toast(r.stillRunning ? `${c.name} is still running.` : `${c.name} stopped.`, r.stillRunning);
      } catch (err) {
        toast((err as Error).message, true);
      } finally {
        setStopping((prev) => {
          const next = new Set(prev);
          next.delete(c.id);
          return next;
        });
        await refresh();
      }
    },
    [refresh, toast],
  );

  const toggleModule = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      try {
        await apiPost("/api/settings", { modules: { containers: next } });
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
        setEnabled(!next);
      }
    },
    [refresh, toast],
  );

  const data = snap?.data;
  const running = visible.filter((c) => c.state === "running").length;

  return (
    <>
      <PageHeader
        eyebrow="Container yard"
        title="Docker containers"
        description="Every container the local Docker daemon knows about. Stop asks the daemon for a graceful shutdown with a 10 second grace period; nothing is removed."
        right={
          !remote && <Toggle checked={enabled} onChange={toggleModule} label="Module on" />
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="grow basis-[260px] max-w-[420px]">
          <SearchInput value={query} onChange={setQuery} placeholder="name, image, project, port…" />
        </div>
        <span className="font-mono text-[11px] leading-relaxed text-quiet">
          {snap?.cachedAt
            ? `updated ${new Date(snap.cachedAt).toLocaleTimeString()}${
                snap.scanMs !== undefined ? ` / ${snap.scanMs}ms` : ""
              }`
            : "scanning…"}
        </span>
      </div>
      <ErrorNote message={error} />
      <div data-machine={machine.id}>
        <MachineNotice status={status} />
      </div>
      <div className="section-label px-0.5 mt-6 mb-3">
        <span>Containers</span>
        <span className="text-quiet tracking-[0.08em]">
          {running} running / {visible.length} total
        </span>
      </div>
      {snap?.enabled === false ? (
        <EmptyState glyph="[x]" title="Module off" hint="Switch it back on above." />
      ) : data?.unavailable ? (
        <EmptyState
          glyph="[ - ]"
          title={data.unavailable}
          hint="Start Docker Desktop or OrbStack and this page will pick it up."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          glyph={query ? "[ ? ]" : "[ : ]"}
          title={!data ? "Loading containers…" : query ? "No matching containers" : "No containers"}
          hint={query ? "Try a name, image, or compose project." : "docker run something and it will appear here."}
        />
      ) : (
        <div className="grid gap-2.5">
          {visible.map((c) => {
            const isRunning = c.state === "running";
            const busy = stopping.has(c.id);
            return (
              <article
                key={`${machine.id}:${c.id}`}
                className="card-surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl border border-line px-[18px] py-3.5 transition-colors hover:border-line-bright"
              >
                <div className="min-w-0">
                  <div className="mb-1.5 flex min-w-0 items-center gap-2">
                    <h3 className="m-0 min-w-0 truncate text-base font-medium" title={c.name}>
                      {c.name}
                    </h3>
                    <Badge variant={isRunning ? "accent" : "quiet"}>{c.state || "unknown"}</Badge>
                    {c.project ? <Badge variant="scope">{c.project}</Badge> : null}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted" title={c.image}>
                    {c.image}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-[15px] gap-y-1 font-mono text-[9px] font-medium uppercase tracking-[0.06em] text-quiet">
                    <span>{c.status}</span>
                    <span>{c.id.slice(0, 12)}</span>
                    {c.ports ? <span className="normal-case">{c.ports}</span> : null}
                  </div>
                </div>
                {isRunning && (!remote || status.state === "ready") ? (
                  <Button variant="stop" busy={busy} onClick={() => stop(c)}>
                    {busy ? "Stopping…" : "Stop"}
                  </Button>
                ) : (
                  <Button disabled title={isRunning ? "Refresh this machine first" : "Not running"}>
                    {isRunning ? "Stop" : "Stopped"}
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
