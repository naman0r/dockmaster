import os from "os";
import { exec } from "@/lib/exec";

const PS = "/bin/ps";

export type ProcessSample = {
  pid: number;
  uid: number;
  user: string;
  command: string;
  cpuPct: number;
  rssKb: number;
};

type RawSample = Map<number, { uid: number; cputimeSec: number; rssKb: number; command: string }>;

// "MM:SS.cc" or "HH:MM:SS.cc" → seconds.
export function parseCputime(raw: string): number {
  const parts = raw.split(":").map(Number);
  if (!parts.every(Number.isFinite) || parts.length < 2 || parts.length > 3) return NaN;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function parseSample(output: string): RawSample {
  const sample: RawSample = new Map();
  for (const line of output.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 5) continue;
    const pid = Number(tokens[0]);
    const uid = Number(tokens[1]);
    const cputimeSec = parseCputime(tokens[2]);
    const rssKb = Number(tokens[3]);
    if (![pid, uid, rssKb].every(Number.isInteger) || !Number.isFinite(cputimeSec)) continue;
    sample.set(pid, { uid, cputimeSec, rssKb, command: tokens.slice(4).join(" ") });
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
    if (!before) continue;
    const cpuPct = ((now.cputimeSec - before.cputimeSec) / intervalSec) * 100;
    rows.push({
      pid,
      uid: now.uid,
      user: users.get(now.uid) || String(now.uid),
      command: now.command,
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
  return [...top.values()].sort((a, b) => b.cpuPct - a.cpuPct || b.rssKb - a.rssKb);
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

const PS_COLUMNS = ["pid=", "uid=", "cputime=", "rss=", "comm="];

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
  return {
    sample: toRows(first, second, intervalMs, users),
    sampledAt: new Date().toISOString(),
    intervalMs,
    currentUid: process.getuid!(),
  };
}
