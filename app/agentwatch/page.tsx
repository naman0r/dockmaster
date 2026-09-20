"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useMachineApi, MachineNotice } from "@/components/machine-api";
import { usePoll } from "@/components/hooks";
import { Badge, EmptyState, ErrorNote, PageHeader, SearchInput, Toggle, useToast } from "@/components/ui";
import { ServerChips, TreeBadges, hasLeftovers, headline, useSessions } from "@/components/workspace-row";
import type { AgentWatchData, Session } from "@/lib/agentwatch";
import type { Workspace } from "@/lib/sessions";

type Snapshot = {
  enabled: boolean;
  cachedAt: string | null;
  data: AgentWatchData | null;
  scanMs?: number;
  error?: string;
};

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const usd = (n: number) => (n >= 10 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);

function since(iso: string): string {
  if (!iso) return "unknown";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function duration(a: string, b: string): string {
  const s = Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000);
  return s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const SECTION = "flex items-center justify-between px-0.5 mt-6 mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted";
const CARD = "card-surface grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl border border-line px-[18px] py-3.5 transition-colors hover:border-line-bright";
const META = "mt-1.5 flex flex-wrap gap-x-[15px] gap-y-1 font-mono text-[9px] font-medium uppercase tracking-[0.06em] text-quiet";
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

// w is set on the newest card of a folder only, so its servers are listed once.
function SessionCard({ s, machineId, w }: { s: Session; machineId: string; w?: Workspace }) {
  const live = s.pid !== null;
  const activeNow = live && Date.now() - new Date(s.lastActive).getTime() < 90_000;
  return (
    <article key={`${machineId}:${s.agent}:${s.id}`} className={CARD}>
      <div className="min-w-0">
        <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="m-0 min-w-0 max-w-full truncate text-base font-[650]" title={s.title}>
            {s.title || "(untitled session)"}
          </h3>
          {live ? <Badge variant="accent">{activeNow ? "working" : "waiting"}</Badge> : null}
          <Badge variant="scope">{s.agent}</Badge>
          {w ? <TreeBadges w={w} /> : null}
        </div>
        <div className="truncate font-mono text-[11px] text-muted" title={s.cwd}>
          {s.project}
          {s.branch ? <span className="text-quiet"> · {s.branch}</span> : null}
          {s.models.length ? <span className="text-quiet"> · {s.models.join(", ")}</span> : null}
        </div>
        <div className={META}>
          {live ? <span>pid {s.pid}</span> : null}
          <span>{activeNow ? "active now" : `last active ${since(s.lastActive)}`}</span>
          <span>{s.prompts} {s.prompts === 1 ? "prompt" : "prompts"}</span>
          <span>{s.toolCalls} tool calls</span>
          {s.startedAt && s.lastActive ? <span>{duration(s.startedAt, s.lastActive)} long</span> : null}
          {s.linesAdded || s.linesRemoved ? (
            <span>
              <span className="text-ok">+{s.linesAdded}</span> <span className="text-alarm">-{s.linesRemoved}</span> lines
            </span>
          ) : null}
        </div>
        {w ? <ServerChips w={w} /> : null}
      </div>
      <div className="shrink-0 text-right font-mono text-[11px] leading-relaxed text-muted">
        <div className="text-base font-[650] text-ink">{s.costUsd !== null ? usd(s.costUsd) : `${fmt(s.outputTokens)} out`}</div>
        <div>{fmt(s.contextTokens)} in context</div>
        <div>{fmt(s.inputTokens + s.cacheReadTokens)} in / {fmt(s.outputTokens)} out</div>
      </div>
    </article>
  );
}

export default function AgentWatchPage() {
  const { apiGet, apiPost, remote, machine, status } = useMachineApi();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [enabled, setEnabled] = useState(true);
  const toast = useToast();
  // The join with ports and worktrees reads this Mac only.
  const held = useSessions(!remote);

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<Snapshot>("/api/agentwatch");
      setSnap(data);
      setError(data.error || "");
    } catch (err) {
      setError(`Scanner unavailable: ${(err as Error).message}`);
    }
  }, [machine.id]);

  usePoll(refresh, 6000);

  const toggleModule = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      try {
        await apiPost("/api/settings", { modules: { agentwatch: next } });
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
        setEnabled(!next);
      }
    },
    [refresh, toast],
  );

  const sessions = useMemo(() => {
    const list = snap?.data?.sessions || [];
    const needle = query.trim().toLowerCase();
    return needle
      ? list.filter((s) => `${s.title} ${s.project} ${s.branch} ${s.agent} ${s.models.join(" ")}`.toLowerCase().includes(needle))
      : list;
  }, [snap, query]);
  const live = sessions.filter((s) => s.pid !== null);
  const recent = sessions.filter((s) => s.pid === null);
  const claimed = new Set(live.map((s) => s.pid));
  const orphans = (snap?.data?.running || []).filter((r) => !claimed.has(r.pid));
  const spend = sessions.reduce((n, s) => n + (s.costUsd || 0), 0);

  const workspaces = (!remote && held.snap?.data?.workspaces) || [];
  const byNewest = new Map(workspaces.filter((w) => w.sessions[0]).map((w) => [`${w.sessions[0].agent}:${w.sessions[0].id}`, w]));
  const byAgentPid = new Map(workspaces.filter((w) => !w.sessions.length).flatMap((w) => w.agents.map((a) => [a.pid, w] as const)));
  const leftBehind = workspaces.filter(hasLeftovers);

  return (
    <>
      <PageHeader
        eyebrow="Crew on deck"
        title="Agent Watch"
        description="Coding agents running on this Mac and the last seven days of sessions, read from Claude Code, Codex, and OpenCode history in your home directory. Each folder's newest session lists the servers running there, and anything a finished agent left behind is flagged at the top of the page. Cost is whatever the agent recorded itself; Codex and SDK-launched Claude Code report tokens only. Nothing leaves the machine."
        right={!remote && <Toggle checked={enabled} onChange={toggleModule} label="Module on" />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="grow basis-[260px] max-w-[420px]">
          <SearchInput value={query} onChange={setQuery} placeholder="title, project, branch, model…" />
        </div>
        <span className="font-mono text-[11px] leading-relaxed text-quiet">
          {snap?.cachedAt
            ? `updated ${new Date(snap.cachedAt).toLocaleTimeString()}${snap.scanMs !== undefined ? ` / ${snap.scanMs}ms` : ""}`
            : "scanning…"}
        </span>
      </div>
      <ErrorNote message={error} />
      <div data-machine={machine.id}>
        <MachineNotice status={status} />
      </div>
      {snap?.enabled === false ? (
        <EmptyState glyph="[x]" title="Module off" hint="Switch it back on above." />
      ) : (
        <>
          {leftBehind.length ? (
            <Link
              href="/cleanup"
              className="card-surface relative block overflow-hidden rounded-[14px] border border-line px-5 py-4 no-underline transition-colors hover:border-line-bright after:content-[''] after:absolute after:inset-x-0 after:top-0 after:h-px after:exposed-line after:opacity-50"
            >
              <span className="block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-alarm">left behind</span>
              <span className="mt-1.5 block text-[17px] font-[650] tracking-[-0.02em] text-ink">{headline(held.snap!.data!.leftovers)}</span>
              <span className="mt-1 block font-mono text-[11px] text-muted">
                {leftBehind.map((w) => w.project).join(", ")} · see why and clean up
              </span>
            </Link>
          ) : null}
          <div className={SECTION}>
            <span>Running now</span>
            <span className="text-quiet tracking-[0.08em]">{live.length + orphans.length} total</span>
          </div>
          {live.length + orphans.length === 0 ? (
            <EmptyState
              glyph="[ : ]"
              title={!snap?.data ? "Looking for agents…" : "No agents running"}
              hint="Start claude, codex, gemini, opencode or another supported CLI and it will appear here."
            />
          ) : (
            <div className="grid min-w-0 gap-2.5">
              {live.map((s) => (
                <SessionCard key={`${machine.id}:${s.agent}:${s.id}`} s={s} machineId={machine.id} w={byNewest.get(`${s.agent}:${s.id}`)} />
              ))}
              {orphans.map((a) => (
                <article key={`${machine.id}:${a.pid}`} className={CARD}>
                  <div className="min-w-0">
                    <div className="mb-1.5 flex min-w-0 items-center gap-2">
                      <h3 className="m-0 min-w-0 truncate text-base font-[650]">{a.kind}</h3>
                      {a.project ? <Badge variant="scope">{a.project}</Badge> : null}
                      <Badge variant="quiet">no session log</Badge>
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted" title={a.argv}>
                      {a.argv}
                    </div>
                    <div className={META}>
                      <span>pid {a.pid}</span>
                      <span>started {since(a.startedAt)}</span>
                      {a.cwd ? <span className="normal-case">{tilde(a.cwd)}</span> : null}
                    </div>
                    {byAgentPid.has(a.pid) ? <ServerChips w={byAgentPid.get(a.pid)!} /> : null}
                  </div>
                  <div />
                </article>
              ))}
            </div>
          )}

          <div className={SECTION}>
            <span>Last 7 days</span>
            <span className="text-quiet tracking-[0.08em]">
              {recent.length} sessions{spend ? ` / ${usd(spend)} claude spend` : ""}
            </span>
          </div>
          {recent.length === 0 ? (
            <EmptyState glyph="[ - ]" title={query ? "No matching sessions" : "No sessions this week"} hint="Claude Code, Codex, and OpenCode history is read from your home directory." />
          ) : (
            <div className="grid min-w-0 gap-2.5">
              {recent.map((s) => (
                <SessionCard key={`${machine.id}:${s.agent}:${s.id}`} s={s} machineId={machine.id} w={byNewest.get(`${s.agent}:${s.id}`)} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
