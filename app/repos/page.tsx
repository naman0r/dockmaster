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

type RepoRow = {
  name: string;
  path: string;
  branch: string;
  dirty: number;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  lastCommitIso: string;
  lastCommitSubject: string;
  staleBranches: number;
  error: string;
};

type ReposSnapshot = {
  enabled: boolean;
  cachedAt: string | null;
  data: { root: string; depth: number; repos: RepoRow[] } | null;
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
  const [snap, setSnap] = useState<ReposSnapshot | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const toast = useToast();

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

  const repos = useMemo(() => {
    const list = snap?.data?.repos || [];
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? list.filter((r) =>
          `${r.name} ${r.branch} ${r.path}`.toLowerCase().includes(needle),
        )
      : list;
    return [...filtered].sort(
      (a, b) => b.dirty - a.dirty || a.name.localeCompare(b.name),
    );
  }, [snap, query]);

  return (
    <>
      <PageHeader
        eyebrow="Repo yard"
        title="Repository status board"
        description={`Every git repo under ${snap?.data?.root || "your dev root"}, ${
          snap?.data?.depth ?? 3
        } levels deep. Answers "what was I doing".`}
        right={<Toggle checked={enabled} onChange={toggleModule} label="Module on" />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="basis-[260px] grow max-w-[420px]">
          <SearchInput value={query} onChange={setQuery} placeholder="name, branch, path…" />
        </div>
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
      {snap?.enabled === false ? (
        <EmptyState glyph="[x]" title="Module off" hint="Switch it back on above." />
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
              key={r.path}
              className="grid card-surface grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl border border-line px-[18px] py-3.5 transition-colors hover:border-line-bright"
            >
              <div className="min-w-0 truncate">
                <strong>{r.name}</strong>
                <div className="font-mono text-[11px] leading-relaxed text-quiet truncate" title={r.path}>
                  {r.path}
                </div>
              </div>
              <div className="min-w-0 truncate">
                <span className="font-mono text-muted">{r.branch}</span>
                <div className="font-mono text-[11px] leading-relaxed text-quiet truncate" title={r.lastCommitSubject}>
                  {r.lastCommitIso ? `${formatRelative(r.lastCommitIso)} · ${r.lastCommitSubject}` : "—"}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {r.error ? <Badge variant="alarm">git error</Badge> : null}
                {r.dirty > 0 ? <Badge variant="alarm">dirty {r.dirty}</Badge> : <Badge variant="quiet">clean</Badge>}
                {r.ahead > 0 ? <Badge variant="scope">ahead {r.ahead}</Badge> : null}
                {r.behind > 0 ? <Badge variant="scope">behind {r.behind}</Badge> : null}
                {!r.hasUpstream && !r.error ? <Badge variant="quiet">no upstream</Badge> : null}
                {r.staleBranches > 0 ? <Badge variant="scope">{r.staleBranches} stale</Badge> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
