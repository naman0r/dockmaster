"use client";

import { targetId } from "@/lib/command-palette";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMachineApi, MachineNotice } from "@/components/machine-api";
import { usePoll, usePaletteTarget } from "@/components/hooks";
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

import type { RepoRow } from "@/lib/repos/scan";
import { nodeMajor } from "@/lib/repos/node";
import { CHANGE_LABELS, type ChangeCounts } from "@/lib/repos/status";
import {
  REPO_SORTS,
  isRepoSort,
  sortRepos,
  type RepoSort,
} from "@/lib/repos/sort";

type ReposSnapshot = {
  enabled: boolean;
  cachedAt: string | null;
  data: { root: string; depth: number; nodeRunning: string; repos: RepoRow[] } | null;
  scanMs?: number;
};

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ReposPage() {
  const { apiGet, apiPost, remote, machine, status } = useMachineApi();
  const [snap, setSnap] = useState<ReposSnapshot | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<RepoSort>("recent");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("dockmaster:repo-sort");
      if (isRepoSort(saved)) setSort(saved);
    } catch {
      /* Sorting still works when browser storage is unavailable. */
    }
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const toast = useToast();
  usePaletteTarget(snap, () => setQuery(""));

  const refresh = useCallback(async () => {
    try {
      setSnap(await apiGet<ReposSnapshot>("/api/repos"));
      setError("");
    } catch (err) {
      setError(`Scanner unavailable: ${(err as Error).message}`);
    }
  }, []);

  usePoll(refresh, 30_000);

  const forceRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setSnap(await apiPost<ReposSnapshot>("/api/repos/refresh", {}));
      setError("");
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setRefreshing(false);
    }
  }, [toast]);

  const toggleModule = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      try {
        await apiPost("/api/settings", { modules: { repos: next } });
        await refresh();
      } catch (err) {
        toast((err as Error).message, true);
        setEnabled(!next);
      }
    },
    [refresh, toast],
  );

  const runningMajor = nodeMajor(snap?.data?.nodeRunning || "");

  const repos = useMemo(() => {
    const list = snap?.data?.repos || [];
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? list.filter((r) =>
          `${r.name} ${r.branch} ${r.path}`.toLowerCase().includes(needle),
        )
      : list;
    return sortRepos(filtered, sort);
  }, [snap, query, sort]);

  return (
    <>
      <PageHeader
        eyebrow="Repo yard"
        title="Repository status board"
        description={`Every git repo under ${snap?.data?.root || "your dev root"}, ${
          snap?.data?.depth ?? 3
        } levels deep. Copy a local path or open a repository on GitHub.`}
        right={
          !remote && (
            <Toggle
              checked={enabled}
              onChange={toggleModule}
              label="Module on"
            />
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="basis-[260px] grow max-w-[420px]">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="name, branch, path…"
          />
        </div>
        <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
          Sort by
          <select
            value={sort}
            onChange={(event) => {
              const next = event.target.value;
              if (!isRepoSort(next)) return;
              setSort(next);
              try {
                localStorage.setItem("dockmaster:repo-sort", next);
              } catch {
                /* Optional preference. */
              }
            }}
            className="min-w-0 rounded-[2px] border border-line-bright bg-surface px-3 py-[9px] text-xs text-ink outline-none focus:border-accent"
          >
            {Object.entries(REPO_SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button busy={refreshing} onClick={forceRefresh}>
          {refreshing ? "Scanning…" : "Refresh"}
        </Button>
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
      <p className="mb-4 text-xs leading-relaxed text-muted">
        Counts describe file paths, not changed lines. Each tracked path is
        counted once, including staged changes. Untracked folders count as one
        entry each; their contents are not counted individually. Commit counts
        compare against locally cached remote history.
      </p>
      {snap?.enabled === false ? (
        <EmptyState
          glyph="[x]"
          title="Module off"
          hint="Switch it back on above."
        />
      ) : repos.length === 0 ? (
        <EmptyState
          glyph="[ : ]"
          title={query ? "No matching repos" : "No repositories found"}
          hint={
            query
              ? "Try a different name or branch."
              : "Set DOCKMASTER_DEV_ROOT in .env to where your projects live."
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {repos.map((r) => (
            <div
              key={`${machine.id}:${r.path}`}
              id={targetId("repo", remote ? `${machine.id}:${r.path}` : r.path)}
              tabIndex={-1}
              className="grid card-surface grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_132px] items-center max-[1200px]:grid-cols-2 max-[600px]:grid-cols-1 gap-3.5 rounded-xl border border-line px-[18px] py-3.5 transition-colors hover:border-line-bright"
            >
              <div className="min-w-0">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-quiet">
                  Repository
                </p>
                <strong className="block truncate" title={r.name}>
                  {r.name}
                </strong>
                <div
                  className="font-mono text-[11px] leading-relaxed text-quiet truncate"
                  title={r.path}
                >
                  {r.path}
                </div>
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-quiet">
                  Branch / last commit
                </p>
                <span
                  className="block truncate font-mono text-sm text-muted"
                  title={r.branch}
                >
                  {r.branch}
                </span>
                <div
                  className="font-mono text-[11px] leading-relaxed text-quiet truncate"
                  title={r.lastCommitSubject}
                >
                  {r.lastCommitIso
                    ? `${formatRelative(r.lastCommitIso)} · ${r.lastCommitSubject}`
                    : "—"}
                </div>
              </div>
              <div className="min-w-0">
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-quiet">
                  Status
                </p>
                {r.error ? (
                  <p className="break-words text-xs text-alarm">
                    Status unavailable: {r.error}
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      Object.entries(CHANGE_LABELS) as Array<
                        [keyof ChangeCounts, string]
                      >
                    ).map(([key, label]) =>
                      r.changes[key] > 0 ? (
                        <Badge
                          key={key}
                          variant={
                            key.startsWith("untracked") ? "scope" : "alarm"
                          }
                        >
                          {r.changes[key].toLocaleString()}{" "}
                          {r.changes[key] === 1 && key.startsWith("untracked")
                            ? label.slice(0, -1)
                            : label}
                        </Badge>
                      ) : null,
                    )}
                    {r.dirty === 0 ? (
                      <Badge variant="quiet">Working tree clean</Badge>
                    ) : null}
                    {r.ahead > 0 ? (
                      <Badge variant="scope">
                        {r.ahead} unpushed{" "}
                        {r.ahead === 1 ? "commit" : "commits"}
                      </Badge>
                    ) : null}
                    {r.behind > 0 ? (
                      <Badge variant="scope">
                        {r.behind} {r.behind === 1 ? "commit" : "commits"}{" "}
                        behind remote
                      </Badge>
                    ) : null}
                    {!r.hasUpstream ? (
                      <Badge variant="quiet">No tracking branch</Badge>
                    ) : null}
                    {r.nodeWanted &&
                    runningMajor !== null &&
                    nodeMajor(r.nodeWanted) !== null &&
                    nodeMajor(r.nodeWanted) !== runningMajor ? (
                      <Badge variant="scope">
                        wants node {r.nodeWanted} · dashboard runs {runningMajor}
                      </Badge>
                    ) : null}
                    {r.staleBranches > 0 ? (
                      <Badge variant="scope">
                        {r.staleBranches}{" "}
                        {r.staleBranches === 1 ? "branch" : "branches"} inactive
                        30+ days
                      </Badge>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-start gap-1.5">
                <p className="text-[10px] uppercase tracking-wider text-quiet">
                  Actions
                </p>
                <Button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(r.path);
                      toast("Repository path copied.");
                    } catch {
                      toast(
                        "Could not copy the path. Select and copy it from the row.",
                        true,
                      );
                    }
                  }}
                >
                  Copy path
                </Button>
                {r.githubUrl ? (
                  <a
                    href={r.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link py-1 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    Open on GitHub ↗
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
