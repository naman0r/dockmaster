import path from "path";
import { exec } from "@/lib/exec";
import { HttpError } from "@/lib/http";
import { mapLimit } from "@/lib/async";
import { findRepos } from "@/lib/walk";
import { devRoot, walkDepth } from "@/lib/settings";

export type WorktreeEntry = {
  path: string;
  head: string;
  branch: string;
  isMain: boolean;
  isPrunable: boolean;
  reason: string;
};

export type StaleBranch = {
  name: string;
  lastCommitIso: string;
  merged: boolean;
};

export type RepoWorktrees = {
  name: string;
  path: string;
  worktrees: WorktreeEntry[];
  staleBranches: StaleBranch[];
};

// Porcelain blocks separated by blank lines; fields are "key value".
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> & { prunableReason?: string } = {};
  const flush = () => {
    if (current.path) {
      entries.push({
        path: current.path,
        head: current.head || "",
        branch: current.branch || "(detached)",
        isMain: entries.length === 0,
        isPrunable: Boolean(current.prunableReason),
        reason: current.prunableReason || "",
      });
    }
    current = {};
  };
  for (const line of output.split("\n")) {
    if (!line) {
      flush();
      continue;
    }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") current.path = value;
    else if (key === "HEAD") current.head = value;
    else if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    else if (key === "prunable") current.prunableReason = value;
  }
  flush();
  return entries;
}

export function parseBranchRefs(output: string): Array<{ name: string; dateUnix: number }> {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, dateUnix] = line.split("\t");
      return { name, dateUnix: Number(dateUnix) };
    })
    .filter((b) => b.name && Number.isFinite(b.dateUnix));
}

const STALE_DAYS = 30;

async function staleBranches(repoPath: string, currentBranch: string): Promise<StaleBranch[]> {
  const refs = await exec(
    [
      "git",
      "-C",
      repoPath,
      "for-each-ref",
      "--format=%(refname:short)%09%(committerdate:unix)%09%(creatordate:iso-strict)",
      "refs/heads",
    ],
    { timeoutMs: 5000 },
  );
  const cutoff = Date.now() / 1000 - STALE_DAYS * 86400;
  const candidates = parseBranchRefs(refs).filter(
    (b) => b.dateUnix < cutoff && b.name !== currentBranch,
  );
  if (candidates.length === 0) return [];

  const defaultBranch = await defaultBranchOf(repoPath);
  return mapLimit(candidates, 4, async (b) => {
    const merged = await isAncestor(repoPath, b.name, defaultBranch);
    const iso = await exec(
      ["git", "-C", repoPath, "log", "-1", "--format=%cI", b.name],
      { timeoutMs: 5000 },
    ).catch(() => "");
    return { name: b.name, lastCommitIso: iso.trim(), merged };
  });
}

async function defaultBranchOf(repoPath: string): Promise<string> {
  const head = await exec(["git", "-C", repoPath, "symbolic-ref", "--short", "HEAD"], {
    timeoutMs: 3000,
  }).catch(() => "");
  const current = head.trim();
  if (current && current !== "HEAD") return current;
  const main = await exec(
    ["git", "-C", repoPath, "rev-parse", "--verify", "--quiet", "main"],
    { timeoutMs: 3000, okReturnCodes: [0, 1] },
  );
  return main.trim() ? "main" : "master";
}

// True when every commit of `branch` is reachable from `into`.
async function isAncestor(repoPath: string, branch: string, into: string): Promise<boolean> {
  const count = await exec(["git", "-C", repoPath, "rev-list", "--count", `${into}..${branch}`], {
    timeoutMs: 8000,
  });
  return Number(count.trim()) === 0;
}

export async function scanWorktrees(): Promise<RepoWorktrees[]> {
  const root = devRoot();
  const repoPaths = await findRepos(root, walkDepth());
  const results = await mapLimit(repoPaths, 6, async (repoPath): Promise<RepoWorktrees | null> => {
    try {
      const list = await exec(["git", "-C", repoPath, "worktree", "list", "--porcelain"], {
        timeoutMs: 5000,
      });
      const worktrees = parseWorktreeList(list);
      const current = worktrees[0]?.branch || "";
      const stale = await staleBranches(repoPath, current);
      if (worktrees.length <= 1 && stale.length === 0) return null;
      return {
        name: path.basename(repoPath),
        path: repoPath,
        worktrees,
        staleBranches: stale,
      };
    } catch {
      return null;
    }
  });
  return results.filter((r): r is RepoWorktrees => r !== null);
}

// ---- Actions ----

function assertInsideDevRoot(target: string, root: string): void {
  const resolved = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new HttpError(403, "Path is outside the configured dev root.");
  }
}

export function guardRemoveWorktree(
  worktreePath: string,
  repoPath: string,
  listed: string[],
  mainWorktree: string,
  root: string = devRoot(),
): void {
  assertInsideDevRoot(worktreePath, root);
  if (!listed.includes(path.resolve(worktreePath))) {
    throw new HttpError(409, "That path is not a registered worktree of this repo.");
  }
  if (path.resolve(worktreePath) === path.resolve(mainWorktree)) {
    throw new HttpError(403, "Refusing to remove the repo's main worktree.");
  }
  void repoPath;
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force: boolean,
): Promise<void> {
  assertInsideDevRoot(repoPath, devRoot());
  assertInsideDevRoot(worktreePath, devRoot());
  const list = await exec(["git", "-C", repoPath, "worktree", "list", "--porcelain"], {
    timeoutMs: 5000,
  });
  const entries = parseWorktreeList(list);
  guardRemoveWorktree(
    worktreePath,
    repoPath,
    entries.map((e) => path.resolve(e.path)),
    entries[0]?.path || "",
  );
  const args = ["git", "-C", repoPath, "worktree", "remove", path.resolve(worktreePath)];
  if (force) args.push("--force");
  await exec(args, { timeoutMs: 15000 });
}

export async function pruneWorktrees(repoPath: string): Promise<string[]> {
  assertInsideDevRoot(repoPath, devRoot());
  const out = await exec(["git", "-C", repoPath, "worktree", "prune", "-v", "--dry-run"], {
    timeoutMs: 5000,
    okReturnCodes: [0],
  });
  if (!out.trim()) return [];
  await exec(["git", "-C", repoPath, "worktree", "prune", "-v"], { timeoutMs: 15000 });
  return out.trim().split("\n");
}

export function guardDeleteBranch(branch: string, current: string, defaultBranch: string): void {
  if (!branch || branch.startsWith("-")) {
    throw new HttpError(400, "Invalid branch name.");
  }
  if (branch === current) {
    throw new HttpError(403, "Refusing to delete the checked-out branch.");
  }
  if (branch === defaultBranch || branch === "main" || branch === "master") {
    throw new HttpError(403, "Refusing to delete the default branch.");
  }
}

export async function deleteBranch(
  repoPath: string,
  branch: string,
  force: boolean,
): Promise<{ deleted: string; merged: boolean }> {
  assertInsideDevRoot(repoPath, devRoot());
  const head = await exec(["git", "-C", repoPath, "symbolic-ref", "--short", "HEAD"], {
    timeoutMs: 3000,
  }).catch(() => "");
  const current = head.trim();
  const defaultBranch = await defaultBranchOf(repoPath);
  guardDeleteBranch(branch, current, defaultBranch);

  const merged = await isAncestor(repoPath, branch, defaultBranch);
  if (!merged && !force) {
    throw new HttpError(
      409,
      `${branch} has commits not in ${defaultBranch}. Pass force to delete anyway.`,
    );
  }
  await exec(["git", "-C", repoPath, "branch", force ? "-D" : "-d", branch], {
    timeoutMs: 5000,
  });
  return { deleted: branch, merged };
}
