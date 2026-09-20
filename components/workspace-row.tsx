"use client";

import { useCallback, useState } from "react";
import { apiGet, apiPost } from "@/lib/client/api";
import { usePoll } from "@/components/hooks";
import { Badge, Button, useToast } from "@/components/ui";
import { targetHref } from "@/lib/command-palette";
import type { SessionsData, Workspace } from "@/lib/sessions";

export type SessionsSnapshot = {
  enabled: boolean;
  cachedAt: string | null;
  data: SessionsData | null;
  scanMs?: number;
};

export type CleanupResult = {
  stopped: number[];
  stillListening: number[];
  removed: boolean;
  freedKb: number;
  worktreeError: string;
};

export const usd = (n: number) => (n >= 10 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);
export const formatSize = (kb: number) =>
  kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`;
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function since(iso: string): string {
  if (!iso) return "unknown";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const hasLeftovers = (w: Workspace) =>
  Boolean(w.worktreeLeftover) || w.servers.some((s) => s.owner === "leftover");

export function headline(l: SessionsData["leftovers"]): string {
  const parts = [
    l.servers && `${plural(l.servers, "server")} still running`,
    l.worktrees && `${plural(l.worktrees, "finished worktree")}${l.kb ? ` holding ${formatSize(l.kb)}` : ""}`,
  ].filter(Boolean);
  if (!parts.length) return "";
  return `${l.agents ? plural(l.agents, "finished agent session") : "Finished agents"} left ${parts.join(" and ")}.`;
}

export function cleanupSummary(w: Workspace): string {
  const ports = [...new Set(w.servers.filter((s) => s.owner === "leftover").map((s) => `:${s.port}`))];
  return [
    ports.length && `stop ${ports.join(", ")}`,
    w.worktreeLeftover && `remove the ${w.branch} worktree (${w.worktreeLeftover})`,
  ]
    .filter(Boolean)
    .join(" and ");
}

export function describeResult(r: CleanupResult): { message: string; alarm: boolean } {
  const parts = [
    r.stopped.length && `stopped ${r.stopped.map((p) => `:${p}`).join(", ")}`,
    r.stillListening.length && `${r.stillListening.map((p) => `:${p}`).join(", ")} ignored SIGTERM, use Ports to force it`,
    r.removed && `removed the worktree${r.freedKb ? `, freed ${formatSize(r.freedKb)}` : ""}`,
    r.worktreeError && `kept the worktree: ${r.worktreeError}`,
  ].filter(Boolean);
  return { message: parts.join("; "), alarm: Boolean(r.stillListening.length || r.worktreeError) };
}

export function useSessions(enabled = true) {
  const [snap, setSnap] = useState<SessionsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const toast = useToast();

  const refresh = useCallback(async (force = false) => {
    try {
      setSnap(await apiGet<SessionsSnapshot>(`/api/sessions${force ? "?force=1" : ""}`));
      setError("");
    } catch (err) {
      setError(`Scanner unavailable: ${(err as Error).message}`);
    }
  }, []);

  usePoll(refresh, 6000, enabled);

  const cleanup = useCallback(
    async (targets: Workspace[]) => {
      const lines = targets.map((w) => `${w.project}: ${cleanupSummary(w)}`);
      if (!window.confirm(`Clean up?\n\n${lines.join("\n")}\n\nWorktrees with uncommitted changes are never removed.`)) return;
      for (const w of targets) {
        setBusy((prev) => new Set(prev).add(w.path));
        try {
          const result = describeResult(await apiPost<CleanupResult>("/api/sessions/cleanup", { path: w.path }));
          toast(`${w.project}: ${result.message}`, result.alarm);
        } catch (err) {
          toast(`${w.project}: ${(err as Error).message}`, true);
        }
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(w.path);
          return next;
        });
      }
      await refresh(true);
    },
    [refresh, toast],
  );

  return { snap, error, busy, cleanup };
}

const OWNER_TONE = {
  agent: "border-accent/25 bg-accent/10 text-accent",
  leftover: "border-alarm/30 bg-alarm/10 text-alarm",
  other: "border-line text-muted",
} as const;
const OWNER_TITLE = {
  agent: "Started by the agent running here",
  leftover: "No terminal, no agent here any more, started during an agent session",
  other: "Running in this folder, not attributed to an agent",
} as const;

export function TreeBadges({ w }: { w: Workspace }) {
  if (!w.tree) return null;
  return (
    <>
      <Badge variant="quiet">worktree</Badge>
      {w.worktreeLeftover ? <Badge variant="alarm">{w.worktreeLeftover}</Badge> : null}
      {w.tree.dirty > 0 ? <Badge variant="quiet">{plural(w.tree.dirty, "uncommitted path")}</Badge> : null}
    </>
  );
}

export function ServerChips({ w }: { w: Workspace }) {
  if (!w.servers.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {w.servers.map((s) => (
        <a
          key={`${s.pid}:${s.port}`}
          href={targetHref("/ports", "port", `${s.pid}:${s.port}`)}
          title={OWNER_TITLE[s.owner]}
          className={`rounded-[5px] border px-[7px] py-1 font-mono text-[10px] no-underline transition-colors hover:border-line-bright ${OWNER_TONE[s.owner]}`}
        >
          :{s.port} {s.kind}
          {s.owner === "leftover" ? " · left behind" : s.owner === "agent" ? " · agent's" : ""}
        </a>
      ))}
    </div>
  );
}

export function WorkspaceRow({
  w,
  busy,
  onCleanup,
}: {
  w: Workspace;
  busy: boolean;
  onCleanup: (w: Workspace) => void;
}) {
  const live = w.sessions.filter((s) => s.pid !== null);
  const claimed = new Set(live.map((s) => s.pid));
  const working = live.some((s) => Date.now() - new Date(s.lastActive).getTime() < 90_000);
  const kinds = [...new Set([...w.sessions.map((s) => s.agent), ...w.agents.map((a) => a.kind)])];
  const newest = w.sessions[0];
  const branch = w.branch && w.branch !== "HEAD" ? w.branch : "";
  return (
    <article className="card-surface grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl border border-line px-[18px] py-3.5 transition-colors hover:border-line-bright max-[560px]:grid-cols-1">
      <div className="min-w-0">
        <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="m-0 min-w-0 max-w-full truncate text-base font-[650]">{w.project}</h3>
          {w.agents.length ? <Badge variant="accent">{working ? "working" : live.length ? "waiting" : "running"}</Badge> : null}
          {kinds.map((k) => (
            <Badge key={k} variant="scope">{k}</Badge>
          ))}
          <TreeBadges w={w} />
        </div>
        <div className="truncate font-mono text-[11px] text-muted" title={w.path}>
          {tilde(w.path)}
          {branch ? <span className="text-quiet"> · {branch}</span> : null}
        </div>
        {newest?.title ? (
          <div className="mt-1.5 truncate text-[13px] text-muted" title={newest.title}>
            {newest.title}
            {w.sessions.length > 1 ? <span className="text-quiet"> · and {plural(w.sessions.length - 1, "more session")}</span> : null}
          </div>
        ) : null}
        <ServerChips w={w} />
        <div className="mt-1.5 flex flex-wrap gap-x-[15px] gap-y-1 font-mono text-[9px] font-medium uppercase tracking-[0.06em] text-quiet">
          {w.agents.filter((a) => !claimed.has(a.pid)).map((a) => (
            <span key={a.pid}>pid {a.pid} · no session log</span>
          ))}
          {live.map((s) => (
            <span key={s.id}>pid {s.pid}</span>
          ))}
          {w.lastActive ? <span>last active {since(w.lastActive)}</span> : null}
          {w.sessions.length ? <span>{plural(w.sessions.length, "session")} this week</span> : null}
          {w.tree?.sizeKb ? <span>{formatSize(w.tree.sizeKb)} on disk</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2 text-right font-mono text-[11px] text-muted max-[560px]:items-start">
        {w.costUsd ? <div className="text-base font-[650] text-ink">{usd(w.costUsd)}</div> : null}
        {hasLeftovers(w) ? (
          <Button variant="stop" busy={busy} onClick={() => onCleanup(w)} title={`Will ${cleanupSummary(w)}`}>
            Clean up
          </Button>
        ) : null}
      </div>
    </article>
  );
}
