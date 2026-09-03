"use client";

import { useCallback, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/client/api";
import { usePoll } from "@/components/hooks";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  SearchInput,
  Toggle,
  useToast,
} from "@/components/ui";

type WorktreeEntry = {
  path: string;
  head: string;
  branch: string;
  isMain: boolean;
  isPrunable: boolean;
  reason: string;
};

type StaleBranch = {
  name: string;
  lastCommitIso: string;
  merged: boolean;
};

type RepoWorktrees = {
  name: string;
  path: string;
  worktrees: WorktreeEntry[];
  staleBranches: StaleBranch[];
};

type Snapshot = {
  enabled: boolean;
  cachedAt: string | null;
  data: RepoWorktrees[] | null;
};

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const days = Math.floor((Date.now() - then) / 86400000);
  return days <= 0 ? "today" : `${days}d ago`;
}

export default function WorktreesPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setSnap(await apiGet<Snapshot>("/api/worktrees"));
      setError("");
    } catch (err) {
      setError(`Scanner unavailable: ${(err as Error).message}`);
    }
  }, []);

  usePoll(refresh, 30_000);

  const act = useCallback(
    async (key: string, url: string, body: Record<string, unknown>, done: string) => {
      setBusy(key);
      try {
        await apiPost(url, body);
        toast(done);
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
      } finally {
        setBusy(null);
      }
    },
    [refresh, toast],
  );

  const toggleModule = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      try {
        await apiPost("/api/settings", { modules: { worktrees: next } });
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
        setEnabled(!next);
      }
    },
    [refresh, toast],
  );

  const repos = useMemo(() => {
    const list = snap?.data || [];
    const needle = query.trim().toLowerCase();
    return needle ? list.filter((r) => `${r.name} ${r.path}`.toLowerCase().includes(needle)) : list;
  }, [snap, query]);

  return (
    <>
      <PageHeader
        eyebrow="Dry dock"
        title="Worktrees & stale branches"
        description="Linked worktrees across every repo, prunable leftovers, and branches older than 30 days. Removing is guarded: the main worktree and default branches are off limits."
        right={<Toggle checked={enabled} onChange={toggleModule} label="Module on" />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="basis-[260px] grow max-w-[420px]">
          <SearchInput value={query} onChange={setQuery} placeholder="repo name or path…" />
        </div>
        <span className="font-mono text-[11px] leading-relaxed text-quiet">
          {snap?.cachedAt ? `updated ${new Date(snap.cachedAt).toLocaleTimeString()}` : "scanning…"}
        </span>
      </div>
      <ErrorNote message={error} />
      {snap?.enabled === false ? (
        <EmptyState glyph="[x]" title="Module off" hint="Switch it back on above." />
      ) : repos.length === 0 ? (
        <EmptyState
          glyph="[ : ]"
          title={query ? "No matching repos" : "Nothing to manage"}
          hint="No repos with extra worktrees or stale branches right now."
        />
      ) : (
        repos.map((repo) => (
          <Card key={repo.path} className="p-[22px_24px]">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <div>
                <h3>{repo.name}</h3>
                <p className="mt-1 font-mono text-[11px] leading-relaxed text-quiet truncate">{repo.path}</p>
              </div>
              <Button
                variant="ghost"
                busy={busy === `${repo.path}:prune`}
                onClick={() =>
                  act(
                    `${repo.path}:prune`,
                    "/api/worktrees/prune",
                    { repoPath: repo.path },
                    "Pruned stale worktree metadata.",
                  )
                }
              >
                Prune
              </Button>
            </div>
            <div className={repo.staleBranches.length ? "mb-3.5 flex flex-col gap-2" : "flex flex-col gap-2"}>
              {repo.worktrees.map((wt) => (
                <div
                  key={wt.path}
                  className="grid card-surface grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3.5 rounded-xl border border-line px-3.5 py-2.5 transition-colors hover:border-line-bright"
                >
                  <div className="min-w-0 truncate">
                    <span className="font-mono text-muted">{wt.branch}</span>
                    <div className="font-mono text-[11px] leading-relaxed text-quiet truncate" title={wt.path}>
                      {wt.path}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {wt.isMain ? <Badge variant="scope">main</Badge> : null}
                    {wt.isPrunable ? <Badge variant="alarm">prunable</Badge> : null}
                  </div>
                  {wt.isMain ? (
                    <Button disabled>Main</Button>
                  ) : (
                    <Button
                      variant="force"
                      busy={busy === `${repo.path}:${wt.path}`}
                      onClick={() => {
                        if (!window.confirm(`Remove worktree ${wt.path}? The directory is deleted.`)) return;
                        void act(
                          `${repo.path}:${wt.path}`,
                          "/api/worktrees/remove",
                          { repoPath: repo.path, worktreePath: wt.path },
                          `Removed ${wt.path}.`,
                        );
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {repo.staleBranches.length > 0 ? (
              <>
                <p className="mb-2 font-mono text-[9px] uppercase leading-relaxed tracking-[0.12em] text-quiet">
                  Stale branches
                </p>
                <div className="flex flex-col gap-2">
                  {repo.staleBranches.map((b) => (
                    <div
                      key={b.name}
                      className="grid card-surface grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3.5 rounded-xl border border-line px-3.5 py-2.5 transition-colors hover:border-line-bright"
                    >
                      <div className="min-w-0 truncate">
                        <span className="font-mono text-muted">{b.name}</span>
                        <span className="ml-2.5 font-mono text-[11px] leading-relaxed text-quiet">
                          {formatRelative(b.lastCommitIso)}
                        </span>
                      </div>
                      <Badge variant={b.merged ? "quiet" : "alarm"}>
                        {b.merged ? "merged" : "unmerged"}
                      </Badge>
                      <Button
                        variant={b.merged ? "stop" : "force"}
                        busy={busy === `${repo.path}:${b.name}`}
                        onClick={() => {
                          const msg = b.merged
                            ? `Delete branch ${b.name}? It is fully merged.`
                            : `Delete branch ${b.name}? It has commits NOT in the default branch.`;
                          if (!window.confirm(msg)) return;
                          void act(
                            `${repo.path}:${b.name}`,
                            "/api/worktrees/delete-branch",
                            { repoPath: repo.path, branch: b.name, force: !b.merged },
                            `Deleted ${b.name}.`,
                          );
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </Card>
        ))
      )}
    </>
  );
}
