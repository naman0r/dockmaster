import fs from "fs/promises";
import path from "path";
import { parseChanges, type ChangeCounts } from "./status";
import { parseToolVersions } from "./node";
import { readGithubUrl } from "@/lib/git-remote";
import { exec } from "@/lib/exec";
import { mapLimit } from "@/lib/async";
import { findRepos } from "@/lib/walk";
import { devRoot, walkDepth } from "@/lib/settings";

export type RepoRow = {
  githubUrl: string | null;
  name: string;
  path: string;
  branch: string;
  dirty: number;
  changes: ChangeCounts;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  lastCommitIso: string;
  lastCommitSubject: string;
  staleBranches: number;
  // Node version the repo pins (.nvmrc, .node-version, .tool-versions, or
  // package.json engines), "" when it pins nothing.
  nodeWanted: string;
  error: string;
};

async function readNodePin(repoPath: string): Promise<string> {
  const read = (name: string) =>
    fs.readFile(path.join(repoPath, name), "utf8").catch(() => "");
  const [nvmrc, nodeVersion, toolVersions, pkg] = await Promise.all([
    read(".nvmrc"),
    read(".node-version"),
    read(".tool-versions"),
    read("package.json"),
  ]);
  const fromPkg = (() => {
    try {
      const engines = (JSON.parse(pkg) as { engines?: { node?: unknown } }).engines;
      return typeof engines?.node === "string" ? engines.node : "";
    } catch {
      return "";
    }
  })();
  return (nvmrc.trim() || nodeVersion.trim() || parseToolVersions(toolVersions) || fromPkg).trim();
}

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
    githubUrl: null,
    name: path.basename(repoPath),
    path: repoPath,
    branch: "",
    dirty: 0,
    changes: parseChanges(""),
    ahead: 0,
    behind: 0,
    hasUpstream: false,
    lastCommitIso: "",
    lastCommitSubject: "",
    staleBranches: 0,
    nodeWanted: "",
    error: "",
  };
  try {
    const status = await exec(
      ["git", "-C", repoPath, "status", "--porcelain=v1", "--untracked-files=normal", "-b"],
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
    row.changes = parseChanges(status);
    row.dirty = Object.values(row.changes).reduce((sum, n) => sum + n, 0);

    const [refs, log, githubUrl, nodeWanted] = await Promise.all([
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
      readGithubUrl(repoPath),
      readNodePin(repoPath),
    ]);
    row.githubUrl = githubUrl;
    row.nodeWanted = nodeWanted;
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
  // ponytail: the node running Dockmaster, not the shell's; launchd has no nvm.
  nodeRunning: string;
  repos: RepoRow[];
};

export async function scanRepos(): Promise<ReposData> {
  const root = devRoot();
  const depth = walkDepth();
  const repoPaths = await findRepos(root, depth);
  const repos = await mapLimit(repoPaths, 6, scanRepo);
  return { root, depth, nodeRunning: process.version, repos };
}
