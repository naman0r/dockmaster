import net from "node:net";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/http";
import { authorizeAction } from "./backend";
import { readMachines, type RemoteMachine } from "./config";
import { sshArgs } from "./ssh";
import type { Service } from "@/lib/ports/scan";
export type TunnelInfo = {
  id: string;
  machineId: string;
  remotePort: number;
  localPort: number;
  url: string;
  error: string | null;
  lastUsedAt: string;
};
type Tunnel = TunnelInfo & {
  key: string;
  config: string;
  server: net.Server;
  sockets: Set<net.Socket>;
  children: Set<ChildProcessWithoutNullStreams>;
  timer?: ReturnType<typeof setTimeout>;
};
const globalTunnels = globalThis as typeof globalThis & {
  dockmasterTunnels?: Map<string, Tunnel>;
  dockmasterTunnelCreation?: Promise<unknown>;
};
const tunnels = (globalTunnels.dockmasterTunnels ??= new Map());
export function listTunnels(machineId: string): TunnelInfo[] {
  return [...tunnels.values()]
    .filter((t) => t.machineId === machineId)
    .map(
      ({ id, machineId, remotePort, localPort, url, error, lastUsedAt }) => ({
        id,
        machineId,
        remotePort,
        localPort,
        url,
        error,
        lastUsedAt,
      }),
    );
}
export function closeTunnel(id: string, machineId: string) {
  const t = tunnels.get(id);
  if (!t || t.machineId !== machineId) return;
  tunnels.delete(id);
  clearTimeout(t.timer);
  for (const socket of t.sockets) socket.destroy();
  for (const child of t.children) child.kill();
  t.server.close();
}
export function closeMachineTunnels(machineId: string) {
  for (const t of [...tunnels.values()])
    if (t.machineId === machineId) closeTunnel(t.id, machineId);
}
export function targetAddress(service: Service) {
  const raw =
    service.addresses.find((a) => a === "127.0.0.1" || a === "::1") ||
    service.addresses[0];
  const address = ["*", "0.0.0.0", "::"].includes(raw) ? "127.0.0.1" : raw;
  if (!net.isIP(address))
    throw new HttpError(400, "Unsupported listener address.");
  return net.isIP(address) === 6 ? `[${address}]` : address;
}
function armIdle(t: Tunnel) {
  clearTimeout(t.timer);
  if (t.sockets.size) return;
  t.timer = setTimeout(() => closeTunnel(t.id, t.machineId), 5 * 60000);
  t.timer.unref?.();
}
function forwardSocket(
  t: Tunnel,
  m: RemoteMachine,
  address: string,
  socket: net.Socket,
) {
  t.sockets.add(socket);
  t.lastUsedAt = new Date().toISOString();
  clearTimeout(t.timer);
  // -W carries one TCP stream over SSH; Node owns the loopback listener so
  // port allocation is atomic and configured SSH LocalForward rules stay disabled.
  const args = sshArgs(m).slice(0, -2);
  args.push("-W", `${address}:${t.remotePort}`, m.destination);
  const child = spawn("/usr/bin/ssh", args, { stdio: "pipe" });
  t.children.add(child);
  let error =
    "SSH forwarding failed. Check forwarding permission and target listener.";
  child.stderr.on("data", (b: Buffer) => {
    const s = b.toString();
    if (/administratively prohibited/i.test(s))
      error =
        "SSH server disallows port forwarding. Enable forwarding for this SSH user.";
    else if (/Permission denied|host key/i.test(s))
      error =
        "SSH authentication or host-key verification failed. Test the machine connection.";
  });
  child.on("error", () => {
    t.error = error;
    socket.destroy();
  });
  child.on("close", (code) => {
    t.children.delete(child);
    if (code && !socket.destroyed) t.error = error;
    socket.destroy();
  });
  child.stdout.once("data", () => {
    t.error = null;
  });
  child.stdin.on("error", () => socket.destroy());
  child.stdout.on("error", () => socket.destroy());
  socket.on("error", () => {});
  socket.on("close", () => {
    child.kill();
    t.children.delete(child);
    t.sockets.delete(socket);
    armIdle(t);
  });
  socket.setTimeout(5 * 60000, () => socket.destroy());
  socket.pipe(child.stdin);
  child.stdout.pipe(socket);
}
async function create(
  machineId: string,
  lease: string,
  payload: { pid: number; port: number; startedAt: string; localPort?: number },
): Promise<TunnelInfo> {
  const { connection } = await authorizeAction(machineId, "ports", lease);
  const result = await connection.request("ports", true);
  const services = (result.data as { services: Service[] }).services;
  const service = services.find(
    (s) =>
      s.pid === payload.pid &&
      s.port === payload.port &&
      s.startedAt === payload.startedAt,
  );
  if (!service)
    throw new HttpError(
      409,
      "Listener identity changed. Refresh before opening it.",
    );
  const machine = (await readMachines()).find((m) => m.id === machineId);
  if (!machine) throw new HttpError(404, "Unknown machine.");
  const address = targetAddress(service),
    key = JSON.stringify([
      machineId,
      service.pid,
      service.port,
      service.startedAt,
      address,
    ]);
  for (const t of tunnels.values())
    if (
      t.key === key &&
      t.config === JSON.stringify(machine) &&
      (!payload.localPort || t.localPort === payload.localPort)
    ) {
      t.lastUsedAt = new Date().toISOString();
      armIdle(t);
      return listTunnels(machineId).find((i) => i.id === t.id)!;
    }
  if (tunnels.size >= 20)
    throw new HttpError(
      409,
      "Close an existing tunnel before opening another (limit 20).",
    );
  let tunnel!: Tunnel;
  const server = net.createServer((socket) => {
    if (tunnel.sockets.size >= 32) {
      socket.destroy();
      return;
    }
    forwardSocket(tunnel, machine, address, socket);
  });
  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      const failed = (e: Error) => {
        server.off("listening", ready);
        reject(e);
      };
      const ready = () => {
        server.off("error", failed);
        resolve();
      };
      server.once("error", failed);
      server.once("listening", ready);
      server.listen(port, "127.0.0.1");
    });
  try {
    await listen(
      payload.localPort || (payload.port >= 1024 ? payload.port : 0),
    );
  } catch (e) {
    if (payload.localPort)
      throw new HttpError(
        409,
        "Requested local port is occupied or unavailable.",
      );
    if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    await listen(0);
  }
  const localPort = (server.address() as net.AddressInfo).port;
  tunnel = {
    id: randomUUID(),
    machineId,
    remotePort: payload.port,
    localPort,
    url: `http://127.0.0.1:${localPort}/`,
    error: null,
    lastUsedAt: new Date().toISOString(),
    key,
    config: JSON.stringify(machine),
    server,
    sockets: new Set(),
    children: new Set(),
  };
  server.on("error", () => closeTunnel(tunnel.id, machineId));
  tunnels.set(tunnel.id, tunnel);
  armIdle(tunnel);
  return listTunnels(machineId).find((i) => i.id === tunnel.id)!;
}
export function openTunnel(
  machineId: string,
  lease: string,
  payload: { pid: number; port: number; startedAt: string; localPort?: number },
) {
  // ponytail: serialize setup for at most 20 mappings; use per-machine queues if needed.
  const task = (globalTunnels.dockmasterTunnelCreation || Promise.resolve())
    .catch(() => {})
    .then(() => create(machineId, lease, payload));
  globalTunnels.dockmasterTunnelCreation = task;
  return task;
}
// Configuration changes close managed mappings without affecting unrelated forwards.
export async function reconcileTunnels(machineId: string) {
  const m = (await readMachines()).find((m) => m.id === machineId);
  for (const t of tunnels.values())
    if (t.machineId === machineId && t.config !== JSON.stringify(m))
      closeTunnel(t.id, machineId);
}
