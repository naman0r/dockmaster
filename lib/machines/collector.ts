import os from "node:os";
import { randomUUID } from "node:crypto";
import { scanServices } from "@/lib/ports/scan";
import { sampleVitals } from "@/lib/vitals";
import { scanRepos } from "@/lib/repos/scan";
import { scanWorktrees } from "@/lib/worktrees/scan";
import { sampleProcesses } from "@/lib/processes";
import { runAllChecks, resultsCache } from "@/lib/health";
import { scanSecrets } from "@/lib/secrets";
import { devRoot } from "@/lib/settings";
import { TtlCache } from "@/lib/cache";
import { hostsSnapshot } from "./remote-hosts";
import {
  COMPANION_VERSION,
  READ_OPERATIONS,
  type Operation,
  type Result,
} from "./protocol";
export const sessionId = randomUUID();
const repos = new TtlCache(60000),
  worktrees = new TtlCache(60000),
  processes = new TtlCache(2500),
  secrets = new TtlCache(300000);
export function invalidateCollectors() {
  repos.invalidate();
  worktrees.invalidate();
  processes.invalidate();
  resultsCache.invalidate();
  secrets.invalidate();
}
export async function collect(op: Operation, force = false): Promise<Result> {
  if (op === "hello")
    return {
      cachedAt: new Date().toISOString(),
      data: {
        hostname: os.hostname(),
        os: process.platform,
        user: os.userInfo().username,
        version: COMPANION_VERSION,
        scanRoot: devRoot(),
        capabilities:
          process.platform === "darwin" ? [...READ_OPERATIONS, "action"] : [],
        sessionId,
      },
    };
  if (process.platform !== "darwin")
    throw new Error("Unsupported OS: this companion supports macOS only.");
  if (op === "vitals") return sampleVitals();
  if (op === "ports") {
    const { services, cachedAt, scanMs } = await scanServices(force);
    return { data: { services }, cachedAt, scanMs };
  }
  if (op === "repos") return repos.get(force, scanRepos) as Promise<Result>;
  if (op === "worktrees")
    return worktrees.get(force, scanWorktrees) as Promise<Result>;
  if (op === "processes")
    return processes.get(force, sampleProcesses) as Promise<Result>;
  if (op === "health") {
    const r = await resultsCache.get(force, runAllChecks);
    return { ...r, data: { checks: r.data } };
  }
  if (op === "hosts")
    return { cachedAt: new Date().toISOString(), data: await hostsSnapshot() };
  if (op === "secrets")
    return secrets.get(force, scanSecrets) as Promise<Result>;
  throw new Error("Unsupported operation.");
}
