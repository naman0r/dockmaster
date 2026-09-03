import fs from "fs/promises";
import type { Dirent } from "fs";
import path from "path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  "venv",
  ".venv",
  "__pycache__",
  ".cache",
  ".Trash",
  "Library",
]);

// Depth-limited walk for git repositories. A directory counts as a repo when
// it contains .git (a directory, or a file for linked worktrees); repos are
// never descended into. Used by the repos, worktrees, and secrets modules.
export async function findRepos(root: string, maxDepth: number): Promise<string[]> {
  const repos: string[] = [];

  async function walk(dir: string, level: number): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const hasGit = await fs
        .access(path.join(full, ".git"))
        .then(() => true, () => false);
      if (hasGit) {
        repos.push(full);
        continue;
      }
      if (level < maxDepth) await walk(full, level + 1);
    }
  }

  await walk(root, 0);
  return repos.sort();
}
