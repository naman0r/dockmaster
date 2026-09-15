import fs from "fs/promises";
import os from "os";
import path from "path";
import { exec, CommandError } from "@/lib/exec";
import { HttpError } from "@/lib/http";
import { TtlCache } from "@/lib/cache";

export type Container = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  project: string;
  createdAt: string;
};

export type ContainersData = {
  // null when docker is installed and the daemon answered; otherwise why not.
  unavailable: string | null;
  containers: Container[];
};

// launchd gives the server a minimal PATH, so look where the runtimes install.
const DOCKER_CANDIDATES = [
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
  path.join(os.homedir(), ".orbstack/bin/docker"),
  "/Applications/Docker.app/Contents/Resources/bin/docker",
];

let dockerBin: string | null | undefined;

async function docker(): Promise<string | null> {
  if (dockerBin !== undefined) return dockerBin;
  for (const candidate of DOCKER_CANDIDATES) {
    if (await fs.access(candidate).then(() => true, () => false)) {
      dockerBin = candidate;
      return candidate;
    }
  }
  dockerBin = null;
  return null;
}

// docker ps --format '{{json .}}' prints one object per line. Labels is a
// comma-joined k=v list; the compose project label is the only one we use.
export function parsePsOutput(output: string): Container[] {
  const containers: Container[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    let row: Record<string, string>;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!/^[0-9a-f]{12,64}$/.test(row.ID || "")) continue;
    const project =
      (row.Labels || "")
        .split(",")
        .find((kv) => kv.startsWith("com.docker.compose.project="))
        ?.slice("com.docker.compose.project=".length) || "";
    containers.push({
      id: row.ID,
      name: row.Names || row.ID.slice(0, 12),
      image: row.Image || "",
      state: row.State || "",
      status: row.Status || "",
      ports: row.Ports || "",
      project,
      createdAt: row.CreatedAt || "",
    });
  }
  containers.sort(
    (a, b) =>
      Number(b.state === "running") - Number(a.state === "running") ||
      a.name.localeCompare(b.name),
  );
  return containers;
}

export const containersCache = new TtlCache<ContainersData>(3000);

export async function scanContainers(): Promise<ContainersData> {
  const bin = await docker();
  if (!bin) return { unavailable: "Docker CLI not found.", containers: [] };
  try {
    const out = await exec(
      [bin, "ps", "-a", "--no-trunc", "--format", "{{json .}}"],
      { timeoutMs: 5000 },
    );
    return { unavailable: null, containers: parsePsOutput(out) };
  } catch (err) {
    if (err instanceof CommandError)
      return { unavailable: "Docker daemon is not running.", containers: [] };
    throw err;
  }
}

export async function stopContainer(
  id: unknown,
  createdAt: unknown,
): Promise<{ ok: boolean; stillRunning: boolean }> {
  if (typeof id !== "string" || !/^[0-9a-f]{12,64}$/.test(id))
    throw new HttpError(400, "id must be a container id.");
  if (typeof createdAt !== "string" || !createdAt)
    throw new HttpError(400, "createdAt is required.");
  const fresh = await containersCache.get(true, scanContainers);
  const target = fresh.data.containers.find((c) => c.id === id);
  if (!target || target.createdAt !== createdAt)
    throw new HttpError(
      409,
      "That container changed since the last refresh. The list has been updated.",
    );
  if (target.state !== "running")
    throw new HttpError(409, "That container is not running.");
  const bin = (await docker())!;
  // docker stop is SIGTERM then SIGKILL after the grace period, mirroring Ports.
  await exec([bin, "stop", "--time", "10", id], { timeoutMs: 15000 });
  containersCache.invalidate();
  const after = await containersCache.get(true, scanContainers);
  return {
    ok: true,
    stillRunning:
      after.data.containers.find((c) => c.id === id)?.state === "running",
  };
}
