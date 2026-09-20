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
import type { Agent, AgentsData } from "@/lib/agents";

type Snapshot = {
  enabled: boolean;
  cachedAt: string | null;
  data: AgentsData | null;
  scanMs?: number;
  error?: string;
};

const OWN_LABEL = "com.dockmaster.app";

export default function AgentsPage() {
  const { apiGet, apiPost, remote, machine, status } = useMachineApi();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busyLabels, setBusyLabels] = useState<Set<string>>(new Set());
  const [enabled, setEnabled] = useState(true);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<Snapshot>("/api/agents");
      setSnap(data);
      setError(data.error || "");
    } catch (err) {
      setError(`Scanner unavailable: ${(err as Error).message}`);
    }
  }, [machine.id]);

  usePoll(refresh, 4000);

  const visible = useMemo(() => {
    const list = snap?.data?.agents || [];
    const needle = query.trim().toLowerCase();
    return needle
      ? list.filter((a) => `${a.label} ${a.program}`.toLowerCase().includes(needle))
      : list;
  }, [snap, query]);

  const toggle = useCallback(
    async (a: Agent) => {
      setBusyLabels((prev) => new Set(prev).add(a.label));
      try {
        const r = await apiPost<{ loaded: boolean }>("/api/agents/toggle", {
          label: a.label,
          loaded: a.loaded,
        });
        const wanted = !a.loaded;
        toast(
          r.loaded === wanted
            ? `${a.label} ${wanted ? "loaded" : "unloaded"}.`
            : `${a.label} is still ${a.loaded ? "loaded" : "unloaded"}.`,
          r.loaded !== wanted,
        );
      } catch (err) {
        toast((err as Error).message, true);
      } finally {
        setBusyLabels((prev) => {
          const next = new Set(prev);
          next.delete(a.label);
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
        await apiPost("/api/settings", { modules: { agents: next } });
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
        setEnabled(!next);
      }
    },
    [refresh, toast],
  );

  const running = visible.filter((a) => a.pid !== null).length;

  return (
    <>
      <PageHeader
        eyebrow="Standing orders"
        title="LaunchAgents"
        description="Every plist in ~/Library/LaunchAgents and whether launchd has it loaded. Unload stops the job (and its process, if KeepAlive); load bootstraps the plist again. Files are never edited."
        right={
          !remote && <Toggle checked={enabled} onChange={toggleModule} label="Module on" />
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="grow basis-[260px] max-w-[420px]">
          <SearchInput value={query} onChange={setQuery} placeholder="label or program…" />
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
        <span>Agents</span>
        <span className="text-quiet tracking-[0.08em]">
          {running} running / {visible.length} total
        </span>
      </div>
      {snap?.enabled === false ? (
        <EmptyState glyph="[x]" title="Module off" hint="Switch it back on above." />
      ) : visible.length === 0 ? (
        <EmptyState
          glyph={query ? "[ ? ]" : "[ : ]"}
          title={!snap?.data ? "Loading agents…" : query ? "No matching agents" : "No agents"}
          hint={query ? "Try a label or program path." : "Nothing in ~/Library/LaunchAgents."}
        />
      ) : (
        <div className="grid gap-2.5">
          {visible.map((a) => {
            const busy = busyLabels.has(a.label);
            const own = a.label === OWN_LABEL;
            return (
              <article
                key={`${machine.id}:${a.label}`}
                className="card-surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl border border-line px-[18px] py-3.5 transition-colors hover:border-line-bright"
              >
                <div className="min-w-0">
                  <div className="mb-1.5 flex min-w-0 items-center gap-2">
                    <h3 className="m-0 min-w-0 truncate text-base font-medium" title={a.label}>
                      {a.label}
                    </h3>
                    <Badge variant={a.pid !== null ? "accent" : a.loaded ? "scope" : "quiet"}>
                      {a.pid !== null ? "running" : a.loaded ? "loaded" : "unloaded"}
                    </Badge>
                    {a.keepAlive ? <Badge variant="scope">keepalive</Badge> : null}
                    {a.runAtLoad ? <Badge variant="scope">run at load</Badge> : null}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted" title={a.program}>
                    {a.program || "no program"}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-[15px] gap-y-1 font-mono text-[9px] font-medium uppercase tracking-[0.06em] text-quiet">
                    {a.pid !== null ? <span>pid {a.pid}</span> : null}
                    {a.lastExit !== null && a.lastExit !== 0 ? (
                      <span className="text-alarm">last exit {a.lastExit}</span>
                    ) : null}
                    <span className="normal-case">{a.file.replace(/^\/Users\/[^/]+/, "~")}</span>
                  </div>
                </div>
                {own ? (
                  <Button disabled title="Dockmaster's own agent">Protected</Button>
                ) : (
                  <Button
                    variant={a.loaded ? "stop" : "default"}
                    busy={busy}
                    disabled={remote && status.state !== "ready"}
                    onClick={() => toggle(a)}
                  >
                    {busy ? "Working…" : a.loaded ? "Unload" : "Load"}
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
