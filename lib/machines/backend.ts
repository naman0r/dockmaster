import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/http";
import { readMachines } from "./config";
import { collect } from "./collector";
import { SshConnection } from "./ssh";
import { moduleEnabled } from "@/lib/settings";
import {
  actionSchema,
  type Action,
  type ReadOperation,
  type MachineSnapshot,
  type Result,
} from "./protocol";
const local = { request: collect };
// Share across Next route bundles and development reloads in this Node process.
const state = globalThis as typeof globalThis & {
  dockmasterMachinesV2?: Map<
    string,
    {
      key: string;
      leases: Map<string, { token: string; session: string; at: number }>;
      connection: SshConnection;
      snapshots: Map<string, Result>;
      inflight: Map<string, Promise<Result>>;
    }
  >;
};
const pool = (state.dockmasterMachinesV2 ??= new Map());
export function invalidateMachine(id: string) {
  pool.get(id)?.connection.close("Machine configuration changed.");
  pool.delete(id);
}
export async function backend(id: string) {
  if (id === "local")
    return {
      connection: local,
      leases: new Map<string, { token: string; session: string; at: number }>(),
      snapshots: new Map<string, Result>(),
      inflight: new Map<string, Promise<Result>>(),
    };
  const machine = (await readMachines()).find((m) => m.id === id);
  if (!machine)
    throw new Error("Unknown machine. Add it in Settings or select This Mac.");
  const key = JSON.stringify(machine);
  let entry = pool.get(id);
  if (entry?.key !== key || !(entry.connection instanceof SshConnection)) {
    invalidateMachine(id);
    entry = {
      key,
      leases: new Map(),
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
  op: ReadOperation,
  force = false,
): Promise<MachineSnapshot<unknown>> {
  const base = {
    machineId: id,
    enabled: true,
    cachedAt: null,
    receivedAt: new Date().toISOString(),
    data: null,
  };
  if (op !== "vitals" && !(await moduleEnabled(op)))
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
    let lease: string | undefined;
    if (
      entry.connection instanceof SshConnection &&
      entry.connection.currentSession
    ) {
      const session = entry.connection.currentSession;
      const previous = entry.leases.get(op);
      lease = previous?.session === session ? previous.token : randomUUID();
      entry.leases.set(op, { token: lease, session, at: Date.now() });
    }
    return {
      ...base,
      ...result,
      receivedAt: new Date().toISOString(),
      state: "ready",
      lease,
    };
  } catch (e) {
    if (id === "local") throw e;
    entry.leases.delete(op);
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

export async function authorizeAction(
  id: string,
  module: ReadOperation,
  lease: string,
  consume = false,
) {
  const entry = await backend(id);
  if (module !== "vitals" && !(await moduleEnabled(module)))
    throw new HttpError(403, "This module is disabled.");
  const grant = entry.leases.get(module);
  if (
    !(entry.connection instanceof SshConnection) ||
    !grant ||
    grant.token !== lease ||
    Date.now() - grant.at > 90000 ||
    entry.connection.currentSession !== grant.session
  )
    throw new HttpError(
      409,
      "Snapshot is stale or disconnected. Refresh this machine before acting.",
    );
  // Check and consume without yielding so concurrent submissions cannot reuse a grant.
  if (consume) entry.leases.delete(module);
  return { entry, grant, connection: entry.connection };
}
export async function machineAction(id: string, raw: Action, lease: string) {
  const action = actionSchema.parse(raw);
  const module = action.action.split(".")[0] as ReadOperation;
  const { entry, grant, connection } = await authorizeAction(id, module, lease, true);
  try {
    const result = await connection.mutate(action, grant.session);
    entry.snapshots.delete(module);
    return { ...result.data, machineId: id };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(
      502,
      "Remote action outcome is unknown after connection failure. Refresh and inspect the target before deciding whether to retry.",
    );
  }
}
