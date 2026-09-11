import os from "os";
import { parseStartedAt } from "@/lib/ports/scan";
import { ancestorChain, readProcessTable } from "@/lib/proctree";
import { exec } from "@/lib/exec";

const PS = "/bin/ps";

export type ProcessSample = {
  startedAt?: string;
  isStoppable?: boolean;
  pid: number;
  uid: number;
  user: string;
  command: string;
  cpuPct: number;
  rssKb: number;
};

type RawSample = Map<
  number,
  { uid: number; cputimeSec: number; rssKb: number; command: string; startedAt: string }
>;

// "MM:SS.cc" or "HH:MM:SS.cc" → seconds.
export function parseCputime(raw: string): number {
  const parts = raw.split(":").map(Number);
  if (!parts.every(Number.isFinite) || parts.length < 2 || parts.length > 3)
    return NaN;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function parseSample(output: string): RawSample {
  const sample: RawSample = new Map();
  for (const line of output.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 10) continue;
    const pid = Number(tokens[0]);
    const uid = Number(tokens[1]);
    const cputimeSec = parseCputime(tokens[2]);
    const rssKb = Number(tokens[3]);
    if (
      ![pid, uid, rssKb].every(Number.isInteger) ||
      !Number.isFinite(cputimeSec)
    )
      continue;
    sample.set(pid, {
      uid,
      cputimeSec,
      rssKb,
      command: tokens.slice(9).join(" "),
      startedAt: parseStartedAt(tokens.slice(4, 9).join(" ")),
    });
  }
  return sample;
}

export function toRows(
  first: RawSample,
  second: RawSample,
  intervalMs: number,
  users: Map<number, string>,
): ProcessSample[] {
  const rows: ProcessSample[] = [];
  const intervalSec = intervalMs / 1000;
  for (const [pid, now] of second) {
    const before = first.get(pid);
    if (
      !before || !now.startedAt ||
      before.startedAt !== now.startedAt || before.uid !== now.uid
    ) continue;
    const cpuPct = ((now.cputimeSec - before.cputimeSec) / intervalSec) * 100;
    rows.push({
      pid,
      uid: now.uid,
      user: users.get(now.uid) || String(now.uid),
      command: now.command,
      startedAt: now.startedAt,
      cpuPct: Math.max(0, cpuPct),
      rssKb: now.rssKb,
    });
  }
  // Instantaneous CPU is noisy for the sort; ties resolve by memory.
  rows.sort((a, b) => b.cpuPct - a.cpuPct || b.rssKb - a.rssKb);
  const byMem = [...rows].sort((a, b) => b.rssKb - a.rssKb);
  const top = new Map<number, ProcessSample>();
  for (const row of rows.slice(0, 25)) top.set(row.pid, row);
  for (const row of byMem.slice(0, 25)) top.set(row.pid, row);
  return [...top.values()].sort(
    (a, b) => b.cpuPct - a.cpuPct || b.rssKb - a.rssKb,
  );
}

async function readUsernames(): Promise<Map<number, string>> {
  // A full user table would need dscl, which is slow; only the current user
  // matters for display, everything else falls back to the numeric uid.
  const users = new Map<number, string>();
  try {
    users.set(process.getuid!(), os.userInfo().username);
  } catch {
    // Numeric uids are fine.
  }
  return users;
}

const PS_COLUMNS = ["pid=", "uid=", "cputime=", "rss=", "lstart=", "comm="];

export async function sampleProcesses(): Promise<{
  sample: ProcessSample[];
  sampledAt: string;
  intervalMs: number;
  currentUid: number;
}> {
  const args = ["-axo", PS_COLUMNS.join(",")];
  const first = parseSample(await exec([PS, ...args]));
  const intervalMs = 1000;
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
  const second = parseSample(await exec([PS, ...args]));
  const users = await readUsernames();
  const protectedPids = ancestorChain(process.pid, await readProcessTable());
  return {
    sample: toRows(first, second, intervalMs, users).map((row) => ({
      ...row,
      isStoppable:
        !!row.startedAt &&
        row.uid === process.getuid!() &&
        row.pid > 1 &&
        !protectedPids.has(row.pid),
    })),
    sampledAt: new Date().toISOString(),
    intervalMs,
    currentUid: process.getuid!(),
  };
}
