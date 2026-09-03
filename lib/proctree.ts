import { exec } from "./exec";
import { GuardError } from "./http";

export type ProcRow = { pid: number; ppid: number; uid: number };

const PS = "/bin/ps";

export async function readProcessTable(): Promise<Map<number, ProcRow>> {
  const out = await exec([PS, "-axo", "pid=,ppid=,uid="]);
  const table = new Map<number, ProcRow>();
  for (const line of out.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3) continue;
    const [pid, ppid, uid] = parts.map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isInteger(uid)) continue;
    table.set(pid, { pid, ppid, uid });
  }
  return table;
}

export function ancestorChain(pid: number, table: Map<number, ProcRow>): Set<number> {
  const ancestors = new Set<number>([1, pid]);
  let cursor = pid;
  while (table.has(cursor)) {
    const parent = table.get(cursor)!.ppid;
    if (parent <= 1 || ancestors.has(parent)) {
      ancestors.add(Math.max(parent, 1));
      break;
    }
    ancestors.add(parent);
    cursor = parent;
  }
  return ancestors;
}

// Deepest-first descendant order, target last. Pure so it can be tested
// without a live process table.
export function descendantOrder(pid: number, table: Map<number, ProcRow>): number[] {
  const children = new Map<number, number[]>();
  for (const row of table.values()) {
    const list = children.get(row.ppid);
    if (list) list.push(row.pid);
    else children.set(row.ppid, [row.pid]);
  }

  const depths = new Map<number, number>();
  const stack: Array<[number, number]> = [[pid, 0]];
  const seen = new Set<number>([pid]);
  while (stack.length) {
    const [parent, depth] = stack.pop()!;
    for (const child of children.get(parent) || []) {
      if (seen.has(child)) continue;
      seen.add(child);
      depths.set(child, depth + 1);
      stack.push([child, depth + 1]);
    }
  }

  const ordered = [...depths.keys()].sort((a, b) => {
    const da = depths.get(a)!;
    const db = depths.get(b)!;
    if (da !== db) return db - da;
    return a - b;
  });
  ordered.push(pid);
  return ordered;
}

// Signal a process and its descendants, deepest first, after refusing:
// PID 1, this process, its own ancestor chain, and any candidate owned by
// another user. Mirrors the original Stopper guards.
export async function killProcessTree(
  pid: number,
  signal: "SIGTERM" | "SIGKILL",
): Promise<{ signaled: number[] }> {
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new GuardError("pid must be an integer greater than 1.", 400);
  }
  const table = await readProcessTable();
  const uid = process.getuid!();

  const selfAncestors = ancestorChain(process.pid, table);
  if (pid === process.pid || selfAncestors.has(pid)) {
    throw new GuardError("Refusing to signal Dockmaster or its ancestor chain.");
  }

  const protectedPids = new Set<number>([process.pid, ...selfAncestors]);
  const order = descendantOrder(pid, table);
  for (const candidate of order) {
    if (candidate <= 1 || protectedPids.has(candidate)) {
      throw new GuardError("Refusing to signal Dockmaster or its ancestor chain.");
    }
    const row = table.get(candidate);
    if (row && row.uid !== uid) {
      throw new GuardError(`Process ${candidate} belongs to another user.`);
    }
  }

  const signaled: number[] = [];
  for (const candidate of order) {
    const row = table.get(candidate);
    if (!row || row.uid !== uid) continue;
    try {
      process.kill(candidate, signal);
      signaled.push(candidate);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ESRCH") continue;
      if (code === "EPERM") {
        throw new GuardError(`Permission denied while signaling PID ${candidate}.`);
      }
      throw err;
    }
  }
  return { signaled };
}
