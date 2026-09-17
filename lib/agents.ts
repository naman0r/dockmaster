import fs from "fs/promises";
import os from "os";
import path from "path";
import { mapLimit } from "@/lib/async";
import { TtlCache } from "@/lib/cache";
import { exec } from "@/lib/exec";
import { HttpError } from "@/lib/http";

export type Agent = {
  label: string;
  file: string;
  program: string;
  loaded: boolean;
  pid: number | null;
  lastExit: number | null;
  runAtLoad: boolean;
  keepAlive: boolean;
};

export type AgentsData = { agents: Agent[] };

// Dockmaster's own LaunchAgent (scripts/agent.mjs). Unloading it from inside
// the page would kill the server mid-request.
const OWN_LABEL = "com.dockmaster.app";

const agentsDir = () => path.join(os.homedir(), "Library", "LaunchAgents");

// launchctl list is "PID\tStatus\tLabel"; PID is "-" for loaded-but-idle jobs
// and Status is the last exit code (negative for signals).
export function parseLaunchctlList(output: string): Map<string, { pid: number | null; lastExit: number }> {
  const rows = new Map<string, { pid: number | null; lastExit: number }>();
  for (const line of output.split("\n").slice(1)) {
    const [pid, status, label] = line.split("\t");
    if (!label) continue;
    rows.set(label, { pid: pid === "-" ? null : Number(pid), lastExit: Number(status) });
  }
  return rows;
}

type Plist = {
  Label?: string;
  Program?: string;
  ProgramArguments?: string[];
  RunAtLoad?: boolean;
  KeepAlive?: boolean | Record<string, unknown>;
};

export function agentFromPlist(file: string, plist: Plist, live: ReturnType<typeof parseLaunchctlList>): Agent | null {
  const label = plist.Label || path.basename(file, ".plist");
  const argv = plist.ProgramArguments || (plist.Program ? [plist.Program] : []);
  const row = live.get(label);
  return {
    label,
    file,
    program: argv.join(" "),
    loaded: row !== undefined,
    pid: row?.pid ?? null,
    lastExit: row?.lastExit ?? null,
    runAtLoad: plist.RunAtLoad === true,
    keepAlive: plist.KeepAlive !== undefined && plist.KeepAlive !== false,
  };
}

export const agentsCache = new TtlCache<AgentsData>(3000);

export async function scanAgents(): Promise<AgentsData> {
  const dir = agentsDir();
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const live = parseLaunchctlList(await exec(["/bin/launchctl", "list"]));
  const agents = await mapLimit(
    names.filter((n) => n.endsWith(".plist")),
    6,
    async (name) => {
      const file = path.join(dir, name);
      try {
        const json = await exec(["/usr/bin/plutil", "-convert", "json", "-o", "-", file]);
        return agentFromPlist(file, JSON.parse(json) as Plist, live);
      } catch {
        return null;
      }
    },
  );
  const list = agents.filter((a): a is Agent => a !== null);
  list.sort(
    (a, b) =>
      Number(b.pid !== null) - Number(a.pid !== null) ||
      Number(b.loaded) - Number(a.loaded) ||
      a.label.localeCompare(b.label),
  );
  return { agents: list };
}

export async function toggleAgent(
  label: unknown,
  loaded: unknown,
): Promise<{ ok: boolean; loaded: boolean }> {
  if (typeof label !== "string" || !label) throw new HttpError(400, "label is required.");
  if (typeof loaded !== "boolean") throw new HttpError(400, "loaded must be a boolean.");
  if (label === OWN_LABEL) throw new HttpError(403, "Refusing to touch Dockmaster's own agent.");
  const fresh = await agentsCache.get(true, scanAgents);
  const target = fresh.data.agents.find((a) => a.label === label);
  if (!target || target.loaded !== loaded)
    throw new HttpError(409, "That agent changed since the last refresh. The list has been updated.");
  const domain = `gui/${process.getuid!()}`;
  // bootout of a KeepAlive job stops its process too, which is the point.
  await exec(
    loaded
      ? ["/bin/launchctl", "bootout", `${domain}/${label}`]
      : ["/bin/launchctl", "bootstrap", domain, target.file],
    { timeoutMs: 10000 },
  );
  agentsCache.invalidate();
  const after = await agentsCache.get(true, scanAgents);
  return { ok: true, loaded: after.data.agents.find((a) => a.label === label)?.loaded ?? false };
}
