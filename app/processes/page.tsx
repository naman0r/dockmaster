"use client";

import { useCallback, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/client/api";
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

type Sample = {
  pid: number;
  uid: number;
  user: string;
  command: string;
  cpuPct: number;
  rssKb: number;
};

type Snapshot = {
  enabled: boolean;
  cachedAt: string | null;
  data: { sample: Sample[]; sampledAt: string; intervalMs: number; currentUid: number } | null;
};

function formatMem(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} KB`;
}

function basename(command: string): string {
  const parts = command.split("/");
  return parts[parts.length - 1] || command;
}

export default function ProcessesPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [pendingForce, setPendingForce] = useState<Set<number>>(new Set());
  const [busyPid, setBusyPid] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [query, setQuery] = useState("");
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setSnap(await apiGet<Snapshot>("/api/processes"));
      setError("");
    } catch (err) {
      setError(`Sampler unavailable: ${(err as Error).message}`);
    }
  }, []);

  usePoll(refresh, 3000);

  const kill = useCallback(
    async (pid: number, mode: "term" | "kill") => {
      if (mode === "kill" && !window.confirm(`Force kill PID ${pid}? Unsaved state may be lost.`)) {
        return;
      }
      setBusyPid(pid);
      try {
        const result = await apiPost<{ stillAlive: boolean }>("/api/processes/kill", { pid, mode });
        if (result.stillAlive && mode === "term") {
          setPendingForce((prev) => new Set(prev).add(pid));
          toast(`PID ${pid} is still alive. Force kill is now available.`, true);
        } else if (result.stillAlive) {
          toast(`PID ${pid} is still alive.`, true);
        } else {
          setPendingForce((prev) => {
            const next = new Set(prev);
            next.delete(pid);
            return next;
          });
          toast(`PID ${pid} stopped.`);
        }
      } catch (err) {
        toast((err as Error).message, true);
      } finally {
        setBusyPid(null);
        await refresh();
      }
    },
    [refresh, toast],
  );

  const toggleModule = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      try {
        await apiPost("/api/settings", { modules: { processes: next } });
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
        setEnabled(!next);
      }
    },
    [refresh, toast],
  );

  const data = snap?.data;
  const filtered = useMemo(() => {
    const sample = data?.sample || [];
    const needle = query.trim().toLowerCase();
    if (!needle) return sample;
    return sample.filter((p) =>
      `${p.pid} ${p.user} ${basename(p.command)} ${p.command}`.toLowerCase().includes(needle),
    );
  }, [data, query]);

  // Shares the row grid so the labels sit exactly over their columns.
  const GRID = "grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-3.5 px-[18px]";

  return (
    <>
      <PageHeader
        eyebrow="Engine room"
        title="CPU & memory hogs"
        description="Instantaneous CPU sampled over one second (not the since-launch average) plus resident memory. Stop is guarded like Ports: own processes only, whole tree, never PID 1."
        right={<Toggle checked={enabled} onChange={toggleModule} label="Module on" />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="grow basis-[260px] max-w-[420px]">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="pid, user, command…"
          />
        </div>
        <span className="font-mono text-[11px] leading-relaxed text-quiet">
          {data
            ? `sampled ${new Date(data.sampledAt).toLocaleTimeString()} over ${data.intervalMs}ms`
            : "sampling…"}
        </span>
      </div>
      <ErrorNote message={error} />
      {snap?.enabled === false ? (
        <EmptyState glyph="[x]" title="Module off" hint="Switch it back on above." />
      ) : !data || data.sample.length === 0 ? (
        <EmptyState glyph="[…]" title="Sampling" hint="Two ps passes, one second apart." />
      ) : filtered.length === 0 ? (
        <EmptyState glyph="[ ? ]" title="No matching processes" hint="Try a pid, user, or command name." />
      ) : (
        <div className="flex flex-col gap-2">
          <div className={`${GRID} pb-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-quiet`}>
            <span>PID</span>
            <span>Command</span>
            <span className="min-w-16 text-right">CPU</span>
            <span className="min-w-[72px] text-right">Mem</span>
            <span />
          </div>
          {filtered.map((p) => {
            const mine = p.uid === data.currentUid;
            const force = pendingForce.has(p.pid);
            return (
              <div
                key={p.pid}
                className="card-surface grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-3.5 rounded-xl border border-line px-[18px] py-3.5 transition-colors hover:border-line-bright"
              >
                <span className="font-mono text-quiet">{p.pid}</span>
                <div className="truncate">
                  <strong className="font-mono">{basename(p.command)}</strong>
                  <span className="ml-2.5 truncate font-mono text-[11px] leading-relaxed text-quiet" title={p.command}>
                    {p.command}
                  </span>
                </div>
                <span className="min-w-16 text-right font-mono text-muted">
                  {p.cpuPct.toFixed(1)}%
                </span>
                <span className="min-w-[72px] text-right font-mono text-muted">
                  {formatMem(p.rssKb)}
                </span>
                {mine ? (
                  <Button
                    variant={force ? "force" : "stop"}
                    busy={busyPid === p.pid}
                    onClick={() => kill(p.pid, force ? "kill" : "term")}
                  >
                    {busyPid === p.pid ? "…" : force ? "Force kill" : "Stop"}
                  </Button>
                ) : (
                  <Badge variant="quiet">{p.user}</Badge>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
