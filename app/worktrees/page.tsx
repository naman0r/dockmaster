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
      <div className="toolbar">
        <div className="grow">
          <SearchInput value={query} onChange={setQuery} placeholder="repo name or path…" />
        </div>
        <span className="hint mono">
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
          <Card key={repo.path} className="pad" >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>{repo.name}</h3>
                <p className="hint mono trunc" style={{ margin: "4px 0 0" }}>{repo.path}</p>
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
            <div className="table" style={{ marginBottom: repo.staleBranches.length ? 14 : 0 }}>
              {repo.worktrees.map((wt) => (
                <div
                  key={wt.path}
                  className="row"
                  style={{ gridTemplateColumns: "minmax(0,1fr) auto auto", padding: "10px 14px" }}
                >
                  <div className="trunc">
                    <span className="mono muted">{wt.branch}</span>
                    <div className="hint mono trunc" title={wt.path}>
                      {wt.path}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
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
                <p className="hint" style={{ margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 9 }}>
                  Stale branches
                </p>
                <div className="table">
                  {repo.staleBranches.map((b) => (
                    <div
                      key={b.name}
                      className="row"
                      style={{ gridTemplateColumns: "minmax(0,1fr) auto auto", padding: "10px 14px" }}
                    >
                      <div className="trunc">
                        <span className="mono muted">{b.name}</span>
                        <span className="hint mono" style={{ marginLeft: 10 }}>
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
