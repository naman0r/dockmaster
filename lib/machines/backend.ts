import { readMachines } from "./config";
import { collect } from "./collector";
import { SshConnection } from "./ssh";
import { moduleEnabled } from "@/lib/settings";
import type { MachineSnapshot, Operation, Result } from "./protocol";
export interface MachineBackend {
  request(op: Operation, force?: boolean): Promise<Result>;
}
const local: MachineBackend = { request: collect };
// Share across Next route bundles and development reloads in this Node process.
const state = globalThis as typeof globalThis & {
  dockmasterMachines?: Map<
    string,
    {
      key: string;
      connection: SshConnection;
      snapshots: Map<string, Result>;
      inflight: Map<string, Promise<Result>>;
    }
  >;
};
const pool = (state.dockmasterMachines ??= new Map());
export function invalidateMachine(id: string) {
  pool.get(id)?.connection.close("Machine configuration changed.");
  pool.delete(id);
}
export async function backend(id: string) {
  if (id === "local")
    return {
      connection: local,
      snapshots: new Map<string, Result>(),
      inflight: new Map<string, Promise<Result>>(),
    };
  const machine = (await readMachines()).find((m) => m.id === id);
  if (!machine)
    throw new Error("Unknown machine. Add it in Settings or select This Mac.");
  const key = JSON.stringify(machine);
  let entry = pool.get(id);
  if (entry?.key !== key) {
    invalidateMachine(id);
    entry = {
      key,
      connection: new SshConnection(machine),
      snapshots: new Map(),
      inflight: new Map(),
    };
    pool.set(id, entry);
  }
  return entry!;
}
export async function machineSnapshot(
  id: string,
  op: "ports" | "vitals",
  force = false,
): Promise<MachineSnapshot<unknown>> {
  const base = {
    machineId: id,
    enabled: true,
    cachedAt: null,
    receivedAt: new Date().toISOString(),
    data: null,
  };
  if (op === "ports" && !(await moduleEnabled("ports")))
    return { ...base, enabled: false, state: "disabled" };
  const entry = await backend(id);
  try {
    let task = entry.inflight.get(op);
    if (!task) {
      task = entry.connection.request(op, force);
      entry.inflight.set(op, task);
    }
    const result = await task;
    entry.snapshots.set(op, result);
    return {
      ...base,
      ...result,
      receivedAt: new Date().toISOString(),
      state: "ready",
    };
  } catch (e) {
    if (id === "local") throw e;
    const error = (e as Error).message;
    const previous = entry.snapshots.get(op);
    return {
      ...base,
      ...previous,
      receivedAt: new Date().toISOString(),
      state: error.startsWith("Unsupported")
        ? "unsupported"
        : previous
          ? "stale"
          : "unreachable",
      error,
    };
  } finally {
    entry.inflight.delete(op);
  }
}
