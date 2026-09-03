import { exec } from "@/lib/exec";
import { TtlCache } from "@/lib/cache";

export type Vitals = {
  uptimeSeconds: number;
  loadAvg: [number, number, number] | null;
  memFreePct: number | null;
  disk: { freeKb: number; totalKb: number; usedPct: number } | null;
  battery: { pct: number; source: string; status: string } | null;
  sampledAt: string;
};

export function parseBoottime(output: string): number | null {
  const sec = Number(output.match(/sec = (\d+)/)?.[1]);
  return Number.isFinite(sec) ? sec : null;
}

export function parseLoadAvg(output: string): [number, number, number] | null {
  const nums = output.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 3) return null;
  const [a, b, c] = nums.slice(0, 3).map(Number);
  if (![a, b, c].every(Number.isFinite)) return null;
  return [a, b, c];
}

// df -k / row: filesystem, total Kb, used Kb, available Kb, capacity%.
export function parseDf(output: string): Vitals["disk"] {
  const line = output.split("\n").find((l) => l.trim().startsWith("/"));
  if (!line) return null;
  const fields = line.trim().split(/\s+/);
  const totalKb = Number(fields[1]);
  const freeKb = Number(fields[3]);
  const usedPct = Number(fields[4]?.replace("%", ""));
  if (![totalKb, freeKb, usedPct].every(Number.isFinite)) return null;
  return { freeKb, totalKb, usedPct };
}

export function parseMemoryPressure(output: string): number | null {
  const pct = Number(output.match(/free percentage:\s*(\d+)%/i)?.[1]);
  return Number.isFinite(pct) ? pct : null;
}

// pmset -g batt: "Now drawing from 'AC Power'" then
// "-InternalBattery-0 (id=…)\t74%; charging; 0:57 remaining present: true".
// Desktops print "No internal battery".
export function parseBattery(output: string): Vitals["battery"] {
  if (/no internal battery/i.test(output)) return null;
  const pct = Number(output.match(/(\d+)%/)?.[1]);
  if (!Number.isFinite(pct)) return null;
  const source = output.match(/'([^']+)'/)?.[1] || "Unknown";
  const status = output.match(/;\s*([^;]+);/)?.[1]?.trim() || "unknown";
  return { pct, source, status };
}

async function sample(): Promise<Vitals> {
  const [boottime, loadavg, dfOut, memOut, battOut] = await Promise.allSettled([
    exec(["/usr/sbin/sysctl", "-n", "kern.boottime"]),
    exec(["/usr/sbin/sysctl", "-n", "vm.loadavg"]),
    exec(["/bin/df", "-k", "/"]),
    exec(["/usr/bin/memory_pressure", "-Q"]),
    exec(["/usr/bin/pmset", "-g", "batt"]),
  ]);

  const unwrap = <T,>(r: PromiseSettledResult<string>, parse: (out: string) => T): T | null =>
    r.status === "fulfilled" ? parse(r.value) : null;

  const bootSec = boottime.status === "fulfilled" ? parseBoottime(boottime.value) : null;
  const sampledAt = new Date().toISOString();
  return {
    uptimeSeconds: bootSec ? Math.max(0, Date.now() / 1000 - bootSec) : 0,
    loadAvg: unwrap(loadavg, parseLoadAvg),
    memFreePct: unwrap(memOut, parseMemoryPressure),
    disk: unwrap(dfOut, parseDf),
    battery: unwrap(battOut, parseBattery),
    sampledAt,
  };
}

const cache = new TtlCache<Vitals>(2000);

export async function sampleVitals(): Promise<{ data: Vitals; cachedAt: string }> {
  const { data, cachedAt } = await cache.get(false, sample);
  return { data, cachedAt };
}
