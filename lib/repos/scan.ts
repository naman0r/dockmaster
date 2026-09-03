import path from "path";
import { exec } from "@/lib/exec";
import { mapLimit } from "@/lib/async";
import { findRepos } from "@/lib/walk";
import { devRoot, walkDepth } from "@/lib/settings";

export type RepoRow = {
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

// "## main...origin/main [ahead 1, behind 2]" → branch, upstream, ahead/behind.
export function parseStatusHeader(
  line: string,
): { branch: string; ahead: number; behind: number; hasUpstream: boolean } {
  const body = line.replace(/^##\s+/, "");
  const noMeta = body.replace(/\s*\[.*\]\s*$/, "");
  const [local, upstream] = noMeta.split("...");
  const ahead = Number(body.match(/\bahead (\d+)/)?.[1] || 0);
  const behind = Number(body.match(/\bbehind (\d+)/)?.[1] || 0);
  return {
    branch: local ? local.replace(/^HEAD \(no branch\)$/, "(detached)") : "(unknown)",
    ahead,
    behind,
    hasUpstream: Boolean(upstream),
  };
}

// One entry per non-header line; untracked files count as dirty.
export function countDirty(output: string): number {
  return output
    .split("\n")
    .filter((line) => line && !line.startsWith("## ")).length;
}

export function parseBranchDates(output: string): Array<{ name: string; date: number }> {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, date] = line.split("\t");
      return { name, date: Number(date) };
    })
    .filter((b) => b.name && Number.isFinite(b.date));
}

const STALE_DAYS = 30;

export async function scanRepo(repoPath: string): Promise<RepoRow> {
  const row: RepoRow = {
    name: path.basename(repoPath),
    path: repoPath,
    branch: "",
    dirty: 0,
    ahead: 0,
    behind: 0,
    hasUpstream: false,
    lastCommitIso: "",
    lastCommitSubject: "",
    staleBranches: 0,
    error: "",
  };
  try {
    const status = await exec(
      ["git", "-C", repoPath, "status", "--porcelain=v1", "-b"],
      { timeoutMs: 5000 },
    );
    const lines = status.split("\n").filter(Boolean);
    const header = lines.find((l) => l.startsWith("## "));
    if (header) {
      const parsed = parseStatusHeader(header);
      row.branch = parsed.branch;
      row.ahead = parsed.ahead;
      row.behind = parsed.behind;
      row.hasUpstream = parsed.hasUpstream;
    } else {
      row.branch = "(unknown)";
    }
    row.dirty = countDirty(status);

    const [refs, log] = await Promise.all([
      exec(
        [
          "git",
          "-C",
          repoPath,
          "for-each-ref",
          "--format=%(refname:short)%09%(committerdate:unix)",
          "refs/heads",
        ],
        { timeoutMs: 5000 },
      ),
      exec(["git", "-C", repoPath, "log", "-1", "--format=%cI%x09%s"], {
        timeoutMs: 5000,
      }),
    ]);
    const cutoff = Date.now() / 1000 - STALE_DAYS * 86400;
    row.staleBranches = parseBranchDates(refs).filter(
      (b) => b.date < cutoff && b.name !== row.branch,
    ).length;
    const [iso, subject] = log.split("\t");
    row.lastCommitIso = iso || "";
    row.lastCommitSubject = subject || "";
  } catch (err) {
    row.error = (err as Error).message;
  }
  return row;
}

export type ReposData = {
  root: string;
  depth: number;
  repos: RepoRow[];
};

export async function scanRepos(): Promise<ReposData> {
  const root = devRoot();
  const depth = walkDepth();
  const repoPaths = await findRepos(root, depth);
  const repos = await mapLimit(repoPaths, 6, scanRepo);
  return { root, depth, repos };
}
