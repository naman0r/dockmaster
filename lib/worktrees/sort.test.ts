import { expect, it } from "vitest";
import { isWorktreeSort, sortWorktrees } from "./sort";

it("sorts worktree groups without mutating scan data or counting the main worktree", () => {
  const main = { path: "/main", head: "abc", branch: "main", isMain: true, isPrunable: false, reason: "" };
  const linked = { ...main, path: "/linked", branch: "feature", isMain: false };
  const repos = [
    { name: "Repo10", path: "/ten", worktrees: [main, linked, linked], staleBranches: [] },
    { name: "repo2", path: "/two", worktrees: [main, { ...linked, isPrunable: true }], staleBranches: [] },
    { name: "Alpha", path: "/alpha", worktrees: [main], staleBranches: [{ name: "old", lastCommitIso: "2025-01-01", merged: true }] },
  ];
  const names = (sort: Parameters<typeof sortWorktrees>[1]) => sortWorktrees(repos, sort).map((repo) => repo.name);
  expect(names("name")).toEqual(["Alpha", "repo2", "Repo10"]);
  expect(names("nameDesc")).toEqual(["Repo10", "repo2", "Alpha"]);
  expect(names("worktrees")).toEqual(["Repo10", "repo2", "Alpha"]);
  expect(names("prunable")).toEqual(["repo2", "Alpha", "Repo10"]);
  expect(names("stale")).toEqual(["Alpha", "repo2", "Repo10"]);
  expect(repos.map((repo) => repo.name)).toEqual(["Repo10", "repo2", "Alpha"]);
  expect(sortWorktrees([
    { ...repos[2], name: "Same", path: "/b" },
    { ...repos[2], name: "Same", path: "/a", worktrees: [] },
  ], "worktrees").map((repo) => repo.path)).toEqual(["/a", "/b"]);
  expect(sortWorktrees([], "name")).toEqual([]);
  expect(isWorktreeSort("prunable")).toBe(true);
  expect(isWorktreeSort("toString")).toBe(false);
  expect(isWorktreeSort(null)).toBe(false);
});
