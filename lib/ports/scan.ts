import fs from "fs/promises";
import os from "os";
import path from "path";
import { exec } from "@/lib/exec";
import { TtlCache } from "@/lib/cache";

export const LSOF = "/usr/sbin/lsof";
const PS = "/bin/ps";

export type Service = {
  pid: number;
  ppid: number;
  port: number;
  addresses: string[];
  kind: string;
  project: string;
  cwd: string;
  argv: string;
  user: string;
  startedAt: string;
  isSystem: boolean;
  isStoppable: boolean;
  isExposed: boolean;
  note: string;
};

type Listener = {
  command: string;
  user: string;
  ports: Map<number, Set<string>>;
};

type Detail = {
  pid: number;
  ppid: number;
  uid: number;
  startedAt: string;
  user: string;
  argv: string;
};

export function parseAddress(value: string): { address: string; port: number } | null {
  const match = value.match(/:(\d+)(?:\s+\(LISTEN\))?$/);
  if (!match) return null;
  const port = Number(match[1]);
  if (!(port >= 1 && port <= 65535)) return null;
  let address = value.slice(0, match.index);
  if (address.startsWith("[") && address.endsWith("]")) {
    address = address.slice(1, -1);
  }
  return { address: address || "*", port };
}

export function parseListenerOutput(output: string): Map<number, Listener> {
  const processes = new Map<number, Listener>();
  let current: Listener | null = null;

  for (const raw of output.split("\n")) {
    if (!raw) continue;
    const field = raw[0];
    const value = raw.slice(1);
    if (field === "p") {
      const pid = Number(value);
      if (!Number.isInteger(pid)) {
        current = null;
        continue;
      }
      current = processes.get(pid) || { command: "", user: "", ports: new Map() };
      processes.set(pid, current);
    } else if (!current) {
      continue;
    } else if (field === "c") {
      current.command = value;
    } else if (field === "L") {
      current.user = value;
    } else if (field === "n") {
      const parsed = parseAddress(value);
      if (!parsed) continue;
      const set = current.ports.get(parsed.port) || new Set<string>();
      set.add(parsed.address);
      current.ports.set(parsed.port, set);
    }
  }

  for (const [pid, listener] of processes) {
    if (listener.ports.size === 0) processes.delete(pid);
  }
  return processes;
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export function parseStartedAt(raw: string): string {
  const match = raw.match(/^[A-Za-z]{3} ([A-Za-z]{3})\s+(\d+) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/);
  if (!match) return raw;
  const month = MONTHS[match[1]];
  if (month === undefined) return raw;
  const date = new Date(
    Number(match[6]),
    month,
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  return date.toISOString();
}

export function parseDetailOutput(output: string): Map<number, Detail> {
  const details = new Map<number, Detail>();
  for (const line of output.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 9) continue;
    const pid = Number(tokens[0]);
    const ppid = Number(tokens[1]);
    const uid = Number(tokens[2]);
    if (![pid, ppid, uid].every(Number.isInteger)) continue;
    details.set(pid, {
      pid,
      ppid,
      uid,
      startedAt: parseStartedAt(tokens.slice(3, 8).join(" ")),
      user: tokens[8],
      argv: tokens.slice(9).join(" "),
    });
  }
  return details;
}

export function parseCwdOutput(output: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let currentPid = 0;
  for (const raw of output.split("\n")) {
    if (!raw) continue;
    const field = raw[0];
    const value = raw.slice(1);
    if (field === "p") {
      const pid = Number(value);
      currentPid = Number.isInteger(pid) ? pid : 0;
    } else if (field === "n" && currentPid) {
      cwds.set(currentPid, value);
    }
  }
  return cwds;
}

const KIND_RULES: Array<[RegExp, string, boolean]> = [
  [/(?:^|\s)(?:\S*\/)?port_authority\.py(?:\s|$)/i, "Port Authority", true],
  [/\bvite\b/i, "Vite", true],
  [/\bnext(?:-server)?\b|[/\\]next\b/i, "Next.js", true],
  [/\bwebpack\b/i, "Webpack", true],
  [/\breact-scripts\b/i, "React", true],
  [/\buvicorn\b/i, "Uvicorn", true],
  [/\bgunicorn\b/i, "Gunicorn", true],
  [/\bmanage\.py\s+runserver\b/i, "Django", true],
  [/\bflask\b/i, "Flask", true],
  [/\brails(?:\s+server|\s+s)\b|\bpuma\b/i, "Rails", true],
  [/\bstorybook\b/i, "Storybook", true],
  [/\bjupyter\b/i, "Jupyter", true],
  [/\bpython\S*\s+-m\s+http\.server\b/i, "Python HTTP", true],
  [/\bbun\b/i, "Bun", true],
  [/\bdeno\b/i, "Deno", true],
  [/\besbuild\b/i, "esbuild", true],
  [/\bpostgres(?:ql)?\b/i, "Postgres", true],
  [/\bredis-server\b/i, "Redis", true],
  [/\bmysqld\b/i, "MySQL", true],
  [/\bmongod\b/i, "MongoDB", true],
  [/\bollama\b/i, "Ollama", true],
  [/\bcom\.docker\b|docker desktop/i, "Docker bridge", true],
  [/\borbstack\b/i, "OrbStack bridge", true],
];

export const INFRASTRUCTURE_KINDS = new Set([
  "Postgres",
  "Redis",
  "MySQL",
  "MongoDB",
  "Ollama",
  "Docker bridge",
  "OrbStack bridge",
]);

export function fallbackKind(argv: string, command: string): string {
  const candidate = argv.split(/\s+/)[0] || "";
  const base = path.basename(candidate) || command;
  return base || "Unknown";
}

export function classify(argv: string, command: string): { kind: string; knownDev: boolean } {
  const haystack = `${argv} ${command}`.trim();
  for (const [pattern, label, isDev] of KIND_RULES) {
    if (pattern.test(haystack)) return { kind: label, knownDev: isDev };
  }
  return { kind: fallbackKind(argv, command), knownDev: false };
}

export async function findProject(cwd: string): Promise<string> {
  if (!cwd || cwd === "/") return "";
  let current = path.resolve(cwd);
  for (let i = 0; i < 20; i++) {
    const hasGit = await fs
      .access(path.join(current, ".git"))
      .then(() => true, () => false);
    if (hasGit) return path.basename(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.basename(cwd);
}

export function isLoopbackAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "localhost") return true;
  if (lower === "*" || lower === "0.0.0.0" || lower === "::") return false;
  if (/^127\./.test(lower)) return true;
  if (lower === "::1" || lower === "::ffff:127.0.0.1") return true;
  return false;
}

export function isBackgroundProcess(uid: number, argv: string, cwd: string, knownDev: boolean): boolean {
  if (uid === 0) return true;
  const lowered = argv.toLowerCase();
  const systemPrefixes = [
    "/system/",
    "/usr/libexec/",
    "/library/apple/",
    "/library/privilegedhelpertools/",
  ];
  if (systemPrefixes.some((p) => lowered.startsWith(p))) return true;
  if (knownDev) return false;
  const pythonWrapper = lowered.includes("/python.app/contents/macos/python");
  const appBundle = lowered.includes(".app/contents/") || lowered.startsWith("/applications/");
  if (appBundle && !pythonWrapper) return true;
  return !cwd || cwd === "/";
}

export function isRuntimeBridge(argv: string, kind: string): boolean {
  const lowered = argv.toLowerCase();
  return (
    kind === "Docker bridge" ||
    kind === "OrbStack bridge" ||
    lowered.includes("com.docker") ||
    lowered.includes("orbstack")
  );
}

function addressSortKey(address: string): number {
  return isLoopbackAddress(address) ? 0 : 1;
}

function hasListeningAncestor(
  pid: number,
  port: number,
  listeners: Map<number, Listener>,
  details: Map<number, Detail>,
): boolean {
  const seen = new Set<number>([pid]);
  let cursor = details.get(pid)?.ppid;
  while (typeof cursor === "number" && cursor > 1 && !seen.has(cursor)) {
    seen.add(cursor);
    const ancestor = listeners.get(cursor);
    if (ancestor?.ports.has(port)) return true;
    const parent = details.get(cursor);
    if (!parent) break;
    cursor = parent.ppid;
  }
  return false;
}

const cache = new TtlCache<Service[]>(1500);

export async function scanServices(force: boolean): Promise<{
  services: Service[];
  cachedAt: string;
  scanMs: number;
}> {
  const { data, cachedAt, scanMs } = await cache.get(force, collectServices);
  return { services: data, cachedAt, scanMs };
}

async function collectServices(): Promise<Service[]> {
  const listenerOutput = await exec(
    [LSOF, "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcLn", "+c", "0"],
    { okReturnCodes: [0, 1] },
  );
  const listeners = parseListenerOutput(listenerOutput);
  if (listeners.size === 0) return [];

  const pidCsv = [...listeners.keys()].sort((a, b) => a - b).join(",");
  const [detailOutput, cwdOutput] = await Promise.all([
    exec([PS, "-o", "pid=,ppid=,uid=,lstart=,user=,command=", "-p", pidCsv], {
      okReturnCodes: [0, 1],
    }),
    exec([LSOF, "-a", "-d", "cwd", "-F", "n", "-p", pidCsv], { okReturnCodes: [0, 1] }),
  ]);
  const details = parseDetailOutput(detailOutput);
  const cwds = parseCwdOutput(cwdOutput);
  const projectCache = new Map<string, string>();
  const services: Service[] = [];
  const uid = process.getuid!();
  const homePrefix = `${os.homedir()}/`;

  for (const [pid, listener] of listeners) {
    const detail = details.get(pid);
    if (!detail) continue;
    const cwd = cwds.get(pid) || "";
    const argv = detail.argv || listener.command;
    const { kind, knownDev } = classify(argv, listener.command);
    if (!projectCache.has(cwd)) projectCache.set(cwd, await findProject(cwd));
    let project = projectCache.get(cwd)!;
    if (INFRASTRUCTURE_KINDS.has(kind) && !cwd.startsWith(homePrefix)) {
      project = kind;
    }
    const isSystem = isBackgroundProcess(detail.uid, argv, cwd, knownDev);
    const protectedProcess =
      pid <= 1 ||
      detail.uid !== uid ||
      isSystem ||
      isRuntimeBridge(argv, kind);

    for (const [port, rawAddresses] of listener.ports) {
      if (hasListeningAncestor(pid, port, listeners, details)) continue;
      const addresses = [...rawAddresses].sort(
        (a, b) => addressSortKey(a) - addressSortKey(b) || a.localeCompare(b),
      );
      const exposed = addresses.some((a) => !isLoopbackAddress(a));
      let note = "";
      if (
        (port === 5000 || port === 7000) &&
        argv.toLowerCase().includes("controlcenter")
      ) {
        note = "Usually macOS AirPlay Receiver";
      } else if (isRuntimeBridge(argv, kind)) {
        note = "Managed by the container runtime";
      }

      services.push({
        pid,
        ppid: detail.ppid,
        port,
        addresses,
        kind,
        project: project || kind,
        cwd,
        argv,
        user: detail.user || listener.user,
        startedAt: detail.startedAt,
        isSystem,
        isStoppable: !protectedProcess,
        isExposed: exposed,
        note,
      });
    }
  }

  services.sort((a, b) => a.port - b.port || a.pid - b.pid);
  return services;
}

export async function portIsListening(port: number): Promise<boolean> {
  const output = await exec(
    [LSOF, "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-F", "p"],
    { timeoutMs: 1500, okReturnCodes: [0, 1] },
  );
  return output.split("\n").some((line) => line.startsWith("p"));
}
