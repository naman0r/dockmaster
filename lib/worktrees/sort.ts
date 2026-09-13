import type { RepoWorktrees } from "./scan";

export const WORKTREE_SORTS = {
  name: "Name: A–Z",
  nameDesc: "Name: Z–A",
  worktrees: "Most linked worktrees",
  prunable: "Most prunable worktrees",
  stale: "Most stale branches",
} as const;

export type WorktreeSort = keyof typeof WORKTREE_SORTS;

export function isWorktreeSort(value: string | null): value is WorktreeSort {
  return value !== null && Object.hasOwn(WORKTREE_SORTS, value);
}

type SortableRepo = Pick<RepoWorktrees, "name" | "path" | "worktrees" | "staleBranches">;

export function sortWorktrees<T extends SortableRepo>(repos: T[], sort: WorktreeSort): T[] {
  return [...repos].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || a.path.localeCompare(b.path);
    if (sort === "name") return byName;
    if (sort === "nameDesc") return -byName;
    const count = (repo: T) => sort === "stale"
      ? repo.staleBranches.length
      : repo.worktrees.filter((wt) => sort === "prunable" ? wt.isPrunable : !wt.isMain).length;
    return count(b) - count(a) || byName;
  });
}
