import type { ChangeCounts } from "./status";

export const REPO_SORTS = {
  recent: "Last commit: newest first", oldest: "Last commit: oldest first",
  name: "Name: A–Z", nameDesc: "Name: Z–A", tracked: "Most tracked changes",
  untracked: "Most untracked entries", ahead: "Most unpushed commits", behind: "Most commits behind",
} as const;
export type RepoSort = keyof typeof REPO_SORTS;
export function isRepoSort(value: string | null): value is RepoSort {
  return value !== null && Object.hasOwn(REPO_SORTS, value);
}

type SortableRepo = { name: string; path: string; lastCommitIso: string; ahead: number; behind: number; changes: ChangeCounts };
export function sortRepos<T extends SortableRepo>(repos: T[], sort: RepoSort): T[] {
  return [...repos].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || a.path.localeCompare(b.path);
    if (sort === "name") return byName;
    if (sort === "nameDesc") return -byName;
    if (sort === "recent" || sort === "oldest") {
      const aDate = Date.parse(a.lastCommitIso), bDate = Date.parse(b.lastCommitIso);
      if (!Number.isFinite(aDate)) return Number.isFinite(bDate) ? 1 : byName;
      if (!Number.isFinite(bDate)) return -1;
      return (sort === "recent" ? bDate - aDate : aDate - bDate) || byName;
    }
    const count = (r: T) => sort === "tracked"
      ? r.changes.modified + r.changes.added + r.changes.deleted + r.changes.renamed + r.changes.copied + r.changes.conflicted
      : sort === "untracked" ? r.changes.untrackedFiles + r.changes.untrackedFolders : r[sort];
    return count(b) - count(a) || byName;
  });
}
