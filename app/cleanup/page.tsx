"use client";

import Link from "next/link";
import { Button, EmptyState, ErrorNote, PageHeader, Stat } from "@/components/ui";
import { WorkspaceRow, formatSize, hasLeftovers, since, useSessions } from "@/components/workspace-row";
import type { Workspace } from "@/lib/sessions";

const LABEL = "font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-quiet";
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

function Detail({ w }: { w: Workspace }) {
  const servers = w.servers.filter((s) => s.owner === "leftover");
  const session = w.sessions[0];
  return (
    <div className="-mt-1 mb-2 grid gap-3 rounded-b-xl border border-t-0 border-line bg-surface/55 px-[18px] py-3.5 font-mono text-[11px] leading-relaxed text-muted">
      {servers.map((s) => (
        <div key={`${s.pid}:${s.port}`}>
          <div className={LABEL}>
            server :{s.port} · pid {s.pid} · started {since(s.startedAt)}
          </div>
          <div className="mt-1 break-all text-ink">{s.argv}</div>
          <div className="mt-1">
            Flagged because it has no terminal, it started after {session ? `the ${session.agent} session "${session.title || "untitled"}"` : "an agent session"} began in this
            folder, no agent is running here now, and the folder has been quiet since {since(w.lastActive)}. Clean up sends SIGTERM to it and its child processes.
          </div>
        </div>
      ))}
      {w.worktreeLeftover && w.tree ? (
        <div>
          <div className={LABEL}>
            worktree · {w.tree.branch}
            {w.tree.sizeKb ? ` · ${formatSize(w.tree.sizeKb)}` : ""}
          </div>
          <div className="mt-1 break-all text-ink">
            {w.tree.isPrunable ? `git -C ${tilde(w.tree.repoPath)} worktree prune` : `git -C ${tilde(w.tree.repoPath)} worktree remove ${tilde(w.path)}`}
          </div>
          <div className="mt-1">
            Flagged because the {w.worktreeLeftover}, it has no uncommitted paths, no agent is running in it, and nothing has touched it for a day.
            The command runs without --force, so git refuses if untracked or modified files appear first. The branch itself is kept.
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function CleanupPage() {
  const { snap, error, busy, cleanup } = useSessions();
  const targets = (snap?.data?.workspaces || []).filter(hasLeftovers);
  const totals = snap?.data?.leftovers;

  return (
    <>
      <PageHeader
        eyebrow="Clear the decks"
        title="Left behind"
        description="Servers and worktrees that finished agent sessions left on this Mac, with the reason each one was flagged and exactly what Clean up will run. Every action re-checks against a fresh scan first."
        right={
          targets.length > 1 ? (
            <Button variant="stop" busy={busy.size > 0} onClick={() => cleanup(targets)}>
              Clean up all
            </Button>
          ) : null
        }
      />
      <p className="-mt-3 mb-5 font-mono text-[11px] text-quiet">
        <Link href="/agentwatch" className="text-accent no-underline hover:underline">
          Back to Agent Watch
        </Link>
      </p>
      <ErrorNote message={error} />
      {snap?.enabled === false ? (
        <EmptyState glyph="[x]" title="Agent Watch is off" hint="Leftovers are found from agent sessions. Switch Agent Watch on in Settings." />
      ) : (
        <>
          {totals ? (
            <div className="mb-5 flex flex-wrap gap-x-9 gap-y-3">
              <Stat value={totals.servers} label="servers left running" />
              <Stat value={totals.worktrees} label="finished worktrees" />
              <Stat value={formatSize(totals.kb)} label="held by them" />
            </div>
          ) : null}
          {targets.length === 0 ? (
            <EmptyState glyph="[ ok ]" title={!snap?.data ? "Scanning…" : "Nothing left behind"} hint="No orphaned servers and no finished worktrees." />
          ) : (
            <div className="grid min-w-0">
              {targets.map((w) => (
                <div key={w.path}>
                  <WorkspaceRow w={w} busy={busy.has(w.path)} onCleanup={(x) => cleanup([x])} />
                  <Detail w={w} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
