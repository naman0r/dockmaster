import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "@/lib/exec";
import { HttpError } from "@/lib/http";
import { parseDetailOutput } from "@/lib/ports/scan";
import { stopService } from "@/lib/ports/stop";
import { killByPid } from "@/lib/processes/kill";
import {
  canonicalRepo,
  worktreeRevision,
  removeWorktree,
  pruneWorktrees,
  deleteBranch,
} from "@/lib/worktrees/scan";
import { addCheck, removeCheck, resultsCache } from "@/lib/health";
import { saveProfile, deleteProfile } from "@/lib/hosts";
import { cleanTarget } from "@/lib/disk";
import { stopContainer } from "@/lib/containers";
import { devRoot } from "@/lib/settings";
import { applyRemoteHosts } from "./remote-hosts";
import { actionSchema, type Action, type Payloads } from "./protocol";
export async function executeAction(raw: Action): Promise<Payloads["action"]> {
  const a = actionSchema.parse(raw);
  if (a.action === "ports.stop") {
    const r = await stopService(a, true);
    return { ok: true, stillListening: r.stillListening };
  }
  if (a.action === "processes.kill") {
    const details = parseDetailOutput(
      await exec(
        [
          "/bin/ps",
          "-o",
          "pid=,ppid=,uid=,lstart=,user=,command=",
          "-p",
          String(a.pid),
        ],
        { okReturnCodes: [0, 1] },
      ),
    );
    if (details.get(a.pid)?.startedAt !== a.startedAt)
      throw new HttpError(
        409,
        "Process identity changed. Refresh before stopping it.",
      );
    const r = await killByPid(a.pid, a.mode, a.startedAt);
    return { ok: true, stillAlive: r.stillAlive };
  }
  if (a.action.startsWith("worktrees.")) {
    const w = a as Extract<Action, { repoPath: string }>;
    const repo = await canonicalRepo(w.repoPath);
    if ((await worktreeRevision(repo)) !== w.revision)
      throw new HttpError(
        409,
        "Worktree or branch state changed. Refresh before applying this action.",
      );
    if (w.action === "worktrees.remove") {
      const root = await fs.realpath(devRoot());
      const target = await fs.realpath(w.worktreePath);
      if (!target.startsWith(root + path.sep))
        throw new HttpError(
          403,
          "Worktree resolves outside the configured development root.",
        );
      // Require the supplied registered path to resolve without aliases.
      if (target !== path.resolve(w.worktreePath))
        throw new HttpError(
          403,
          "Symlinked worktree paths are not eligible for remote removal.",
        );
      await removeWorktree(repo, target, w.force);
    } else if (w.action === "worktrees.prune") await pruneWorktrees(repo);
    else await deleteBranch(repo, w.branch, w.force);
    return { ok: true };
  }
  if (a.action === "disk.clean") return { ok: true, ...(await cleanTarget(a.path)) };
  if (a.action === "containers.stop") return stopContainer(a.id, a.createdAt);
  if (a.action === "health.add") {
    await addCheck(a.label, a.url);
    resultsCache.invalidate();
  } else if (a.action === "health.remove") {
    await removeCheck(a.id);
    resultsCache.invalidate();
  } else if (a.action === "hosts.save") await saveProfile(a.name, a.content);
  else if (a.action === "hosts.delete") await deleteProfile(a.id);
  else if (a.action === "hosts.apply") await applyRemoteHosts(a.id, a.revision);
  return { ok: true };
}
