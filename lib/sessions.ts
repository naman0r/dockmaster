import fs from "fs/promises";
import path from "path";
import { exec } from "@/lib/exec";
import { HttpError } from "@/lib/http";
import { TtlCache } from "@/lib/cache";
import { mapLimit } from "@/lib/async";
import { du } from "@/lib/disk";
import { moduleEnabled } from "@/lib/settings";
import { agentWatchCache, scanAgentWatch, type RunningAgent, type Session } from "@/lib/agentwatch";
import { findProject, scanServices, type Service } from "@/lib/ports/scan";
import { stopService } from "@/lib/ports/stop";
import { recordAction } from "@/lib/receipt";
import {
  defaultBranchOf,
  pruneWorktrees,
  removeWorktree,
  scanWorktrees,
  worktreesCache,
} from "@/lib/worktrees/scan";

// A linked worktree, which is where agent runners put parallel sessions.
export type Tree = {
  path: string;
  repoPath: string;
  branch: string;
  isPrunable: boolean;
  merged: boolean;
  dirty: number;
  createdAt: string;
  sizeKb: number | null;
};

export type ServerOwner = "agent" | "leftover" | "other";

export type Workspace = {
  path: string;
  project: string;
  branch: string;
  tree: Tree | null;
  sessions: Session[];
  agents: RunningAgent[];
  servers: Array<Service & { owner: ServerOwner }>;
  costUsd: number;
  lastActive: string;
  // Why the worktree itself is a leftover; "" when it is not.
  worktreeLeftover: string;
};

export type SessionsData = {
  workspaces: Workspace[];
  leftovers: { agents: number; servers: number; worktrees: number; kb: number };
};

export type Proc = { ppid: number; tty: boolean };

const QUIET_MS = 24 * 3600 * 1000;
// An agent served from another folder (opencode serve) has no process here, so
// recent session activity is the only sign that it is still using the server.
const SERVER_IDLE_MS = 10 * 60_000;
const time = (iso: string) => Date.parse(iso) || 0;

export function leftoverServers(w: Workspace): Workspace["servers"] {
  return w.servers.filter((s) => s.owner === "leftover");
}

export function buildWorkspaces(input: {
  now: number;
  sessions: Session[];
  running: RunningAgent[];
  services: Service[];
  procs: Map<number, Proc>;
  trees: Tree[];
  roots: Map<string, string>;
}): SessionsData {
  const { now, procs, trees } = input;
  const byPath = new Map<string, Workspace>();
  const at = (root: string): Workspace => {
    let w = byPath.get(root);
    if (!w) {
      const tree = trees.find((t) => t.path === root) ?? null;
      w = {
        path: root, project: path.basename(root) || root, branch: tree?.branch ?? "", tree,
        sessions: [], agents: [], servers: [], costUsd: 0, lastActive: "", worktreeLeftover: "",
      };
      byPath.set(root, w);
    }
    return w;
  };
  const rootOf = (cwd: string) => input.roots.get(cwd) || cwd;

  for (const s of input.sessions) if (s.cwd) at(rootOf(s.cwd)).sessions.push(s);
  for (const a of input.running) if (a.cwd) at(rootOf(a.cwd)).agents.push(a);
  for (const t of trees) if (t.merged || t.isPrunable) at(t.path);

  for (const w of byPath.values()) {
    w.sessions.sort((a, b) => b.lastActive.localeCompare(a.lastActive));
    w.branch ||= w.sessions[0]?.branch ?? "";
    w.lastActive = w.sessions[0]?.lastActive ?? "";
    w.costUsd = w.sessions.reduce((n, s) => n + (s.costUsd || 0), 0);
  }

  const agentRoot = new Map(input.running.filter((a) => a.cwd).map((a) => [a.pid, rootOf(a.cwd)]));
  const launchedBy = (pid: number): string | undefined => {
    let cursor = pid;
    for (let i = 0; i < 64 && cursor > 1; i++) {
      if (agentRoot.has(cursor)) return agentRoot.get(cursor);
      cursor = procs.get(cursor)?.ppid ?? 0;
    }
  };
  // Daemons of desktop apps run from / or the home folder, so a server there says nothing about an agent.
  // ponytail: depth test stands in for "is a home directory"; pass os.homedir() in if homes elsewhere matter.
  const shallow = (p: string) => p.split(path.sep).length <= 3;
  // Only a repo claims servers in its subfolders; an agent started from the
  // home folder would otherwise claim every server on the machine.
  const repoRoots = new Set([...input.roots.values(), ...trees.map((t) => t.path)]);
  const containing = (cwd: string): Workspace | undefined => {
    let best: Workspace | undefined;
    for (const w of byPath.values())
      if (
        (repoRoots.has(w.path) ? cwd === w.path || cwd.startsWith(w.path + path.sep) : cwd === w.path && !shallow(w.path)) &&
        w.path.length > (best?.path.length ?? 0)
      )
        best = w;
    return best;
  };

  for (const s of input.services) {
    const held = launchedBy(s.pid);
    if (held) {
      at(held).servers.push({ ...s, owner: "agent" });
      continue;
    }
    const w = s.isSystem ? undefined : containing(s.cwd);
    if (!w) continue;
    // Once its agent exits the process is reparented to launchd, so ancestry
    // is gone. What remains: no terminal (a server you started yourself has
    // one), started after an agent began working here, and no agent here now.
    // ponytail: a server you daemonized yourself in the same folder matches too.
    const first = Math.min(...w.sessions.map((x) => time(x.startedAt)).filter(Boolean));
    const leftover =
      s.isStoppable &&
      !procs.get(s.pid)?.tty &&
      w.agents.length === 0 &&
      time(s.startedAt) >= first &&
      now - time(w.lastActive) > SERVER_IDLE_MS;
    w.servers.push({ ...s, owner: leftover ? "leftover" : "other" });
  }

  for (const w of byPath.values()) {
    const t = w.tree;
    // Uncommitted work is not junk, and neither is a checkout of the default branch.
    if (!t || w.agents.length || t.dirty > 0 || t.branch === "main" || t.branch === "master") continue;
    if (now - Math.max(time(w.lastActive), time(t.createdAt)) < QUIET_MS) continue;
    w.worktreeLeftover = t.isPrunable ? "directory is gone" : t.merged ? "branch is merged" : "";
  }

  const workspaces = [...byPath.values()]
    .filter((w) => w.sessions.length || w.agents.length || w.worktreeLeftover)
    .sort((a, b) => b.agents.length - a.agents.length || b.lastActive.localeCompare(a.lastActive));

  const leftovers = { agents: 0, servers: 0, worktrees: 0, kb: 0 };
  for (const w of workspaces) {
    const pids = new Set(leftoverServers(w).map((s) => s.pid));
    if (!pids.size && !w.worktreeLeftover) continue;
    leftovers.agents += w.sessions.filter((s) => s.pid === null).length;
    leftovers.servers += pids.size;
    if (w.worktreeLeftover) {
      leftovers.worktrees += 1;
      leftovers.kb += w.tree?.sizeKb ?? 0;
    }
  }
  return { workspaces, leftovers };
}

export function parseProcs(output: string): Map<number, Proc> {
  const procs = new Map<number, Proc>();
  for (const line of output.split("\n")) {
    const [pid, ppid, tty] = line.trim().split(/\s+/);
    if (Number.isInteger(Number(pid)) && tty) procs.set(Number(pid), { ppid: Number(ppid), tty: tty !== "??" });
  }
  return procs;
}

const SIZE_TTL_MS = 10 * 60_000;
const sizes = new Map<string, { kb: number; at: number }>();

async function linkedTrees(force: boolean): Promise<Tree[]> {
  if (!(await moduleEnabled("worktrees"))) return [];
  const { data } = await worktreesCache.get(force, scanWorktrees);
  // A linked worktree under the dev root is scanned as a repo of its own, so
  // the same worktree list shows up once per checkout.
  const repos = new Map(data.filter((r) => r.worktrees.length > 1).map((r) => [r.worktrees[0].path, r]));
  const perRepo = await mapLimit([...repos.values()], 4, async (repo) => {
    const repoPath = repo.worktrees[0].path;
    const merged = new Set(
      (
        await exec(
          ["git", "-C", repoPath, "for-each-ref", "--format=%(refname:short)", `--merged=${await defaultBranchOf(repoPath)}`, "refs/heads"],
          { timeoutMs: 8000 },
        ).catch(() => "")
      ).split("\n"),
    );
    return Promise.all(
      repo.worktrees.filter((w) => !w.isMain).map(async (w): Promise<Tree> => {
        // A status that cannot be read counts as dirty, so the tree is left alone.
        const status = w.isPrunable
          ? ""
          : await exec(["git", "-C", w.path, "status", "--porcelain"], { timeoutMs: 5000 }).catch(() => "?");
        const stat = await fs.stat(w.path).catch(() => null);
        return {
          path: w.path, repoPath, branch: w.branch, isPrunable: w.isPrunable, merged: merged.has(w.branch),
          dirty: status.split("\n").filter(Boolean).length,
          createdAt: stat ? stat.birthtime.toISOString() : "", sizeKb: null,
        };
      }),
    );
  });
  const trees = perRepo.flat();

  const stale = trees.filter(
    (t) => t.merged && !t.isPrunable && t.dirty === 0 && Date.now() - (sizes.get(t.path)?.at ?? 0) > SIZE_TTL_MS,
  );
  for (const [p, kb] of await du(stale.map((t) => t.path))) sizes.set(p, { kb, at: Date.now() });
  for (const t of trees) t.sizeKb = sizes.get(t.path)?.kb ?? null;
  return trees;
}

export const sessionsCache = new TtlCache<SessionsData>(5000);

export async function scanSessions(force = false): Promise<SessionsData> {
  const [watch, services, procs, trees] = await Promise.all([
    agentWatchCache.get(force, scanAgentWatch).then((r) => r.data),
    moduleEnabled("ports").then((on) => (on ? scanServices(force).then((r) => r.services) : [])),
    exec(["/bin/ps", "-axo", "pid=,ppid=,tty="]).then(parseProcs),
    linkedTrees(force),
  ]);
  const cwds = [...new Set([...watch.sessions, ...watch.running].map((x) => x.cwd).filter(Boolean))];
  const found = await mapLimit(cwds, 6, async (cwd): Promise<[string, string]> => [cwd, (await findProject(cwd)).repoPath]);
  const roots = new Map(found.filter(([, repo]) => repo));
  return buildWorkspaces({ now: Date.now(), sessions: watch.sessions, running: watch.running, services, procs, trees, roots });
}

// Acts only on what a fresh scan still calls a leftover, so a stale row can
// neither stop a server an agent has since picked up nor remove a tree in use.
export async function cleanupWorkspace(target: string): Promise<{
  stopped: number[];
  stillListening: number[];
  removed: boolean;
  freedKb: number;
  worktreeError: string;
}> {
  const { data } = await sessionsCache.get(true, () => scanSessions(true));
  const w = data.workspaces.find((x) => x.path === target);
  if (!w) throw new HttpError(409, "That workspace changed since the last refresh. The list has been updated.");
  if (w.agents.length) throw new HttpError(409, "An agent is running there now.");
  const servers = leftoverServers(w);
  if (!servers.length && !w.worktreeLeftover) throw new HttpError(409, "Nothing left to clean up there.");

  const stopped: number[] = [];
  const stillListening: number[] = [];
  const done = new Set<number>();
  for (const s of servers) {
    if (done.has(s.pid)) continue;
    done.add(s.pid);
    const result = await stopService({ pid: s.pid, port: s.port, startedAt: s.startedAt, mode: "term" });
    (result.stillListening ? stillListening : stopped).push(s.port);
  }

  let removed = false;
  let worktreeError = "";
  if (w.worktreeLeftover && w.tree) {
    try {
      if (w.tree.isPrunable) await pruneWorktrees(w.tree.repoPath);
      else await removeWorktree(w.tree.repoPath, w.path, false);
      removed = true;
    } catch (err) {
      worktreeError = (err as Error).message;
    }
  }
  worktreesCache.invalidate();
  sessionsCache.invalidate();
  const freedKb = removed ? (w.tree?.sizeKb ?? 0) : 0;
  await recordAction("server", stopped.length);
  await recordAction("worktree", removed ? 1 : 0, freedKb);
  return { stopped, stillListening, removed, freedKb, worktreeError };
}
