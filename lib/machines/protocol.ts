import type { Service } from "@/lib/ports/scan";
import type { Vitals } from "@/lib/vitals";
export const VERSION = 1;
export const COMPANION_VERSION = "1.0.0";
export const MAX_MESSAGE = 2 * 1024 * 1024;
export type Operation = "hello" | "ports" | "vitals";
export type Info = {
  hostname: string;
  os: string;
  user: string;
  version: string;
  scanRoot: string;
  capabilities: string[];
};
export type Payloads = {
  hello: Info;
  ports: { services: Service[] };
  vitals: Vitals;
};
export type Result<K extends Operation = Operation> = {
  cachedAt: string;
  data: Payloads[K];
  scanMs?: number;
};
export type MachineSnapshot<T> = {
  machineId: string;
  enabled: boolean;
  cachedAt: string | null;
  receivedAt: string;
  data: T | null;
  state: "ready" | "stale" | "unreachable" | "disabled" | "unsupported";
  error?: string;
};
export function record(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}
const str = (x: unknown) => typeof x === "string" && x.length <= 32768;
const num = (x: unknown) =>
  typeof x === "number" && Number.isFinite(x) && x >= 0;
const date = (x: unknown) => str(x) && Number.isFinite(Date.parse(x as string));
export function validRequest(
  x: unknown,
): x is { v: number; id: string; op: Operation } {
  return (
    record(x) &&
    x.v === VERSION &&
    typeof x.id === "string" &&
    /^[a-zA-Z0-9-]{1,80}$/.test(x.id) &&
    ["hello", "ports", "vitals"].includes(String(x.op))
  );
}
export function validateResult(op: Operation, x: unknown): x is Result {
  if (!record(x) || !date(x.cachedAt) || !record(x.data)) return false;
  if (x.scanMs !== undefined && !num(x.scanMs)) return false;
  const d = x.data;
  if (op === "hello")
    return (
      [d.hostname, d.os, d.user, d.version, d.scanRoot].every(str) &&
      Array.isArray(d.capabilities) &&
      d.capabilities.length < 32 &&
      d.capabilities.every(str)
    );
  if (op === "ports")
    return (
      Array.isArray(d.services) &&
      d.services.length <= 10000 &&
      d.services.every(
        (s) =>
          record(s) &&
          [s.pid, s.ppid, s.port].every(Number.isInteger) &&
          Number(s.pid) > 0 &&
          Number(s.ppid) >= 0 &&
          Number(s.port) > 0 &&
          Number(s.port) <= 65535 &&
          [s.kind, s.project, s.cwd, s.argv, s.user, s.startedAt, s.note].every(
            str,
          ) &&
          [s.isSystem, s.isStoppable, s.isExposed].every(
            (b) => typeof b === "boolean",
          ) &&
          Array.isArray(s.addresses) &&
          s.addresses.length <= 100 &&
          s.addresses.every(str),
      )
    );
  return (
    num(d.uptimeSeconds) &&
    num(d.cores) &&
    Number(d.cores) > 0 &&
    date(d.sampledAt) &&
    (d.loadAvg === null ||
      (Array.isArray(d.loadAvg) &&
        d.loadAvg.length === 3 &&
        d.loadAvg.every(num))) &&
    (d.memFreePct === null ||
      (num(d.memFreePct) && Number(d.memFreePct) <= 100)) &&
    (d.disk === null ||
      (record(d.disk) &&
        [d.disk.freeKb, d.disk.totalKb, d.disk.usedPct].every(num))) &&
    (d.battery === null ||
      (record(d.battery) &&
        num(d.battery.pct) &&
        Number(d.battery.pct) <= 100 &&
        str(d.battery.source) &&
        str(d.battery.status)))
  );
}
// Byte-bounded framing also handles split UTF-8 characters safely.
export class Lines {
  private buffer = Buffer.alloc(0);
  push(chunk: Buffer, accept: (line: string) => void) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let end: number;
    while ((end = this.buffer.indexOf(10)) >= 0) {
      if (end > MAX_MESSAGE) throw new Error("Protocol message too large.");
      const line = this.buffer.subarray(0, end).toString("utf8");
      this.buffer = this.buffer.subarray(end + 1);
      accept(line);
    }
    if (this.buffer.length > MAX_MESSAGE)
      throw new Error("Protocol message too large.");
  }
}
