import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { SshConnection } from "./ssh";
const machine = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Homelab",
  destination: "homelab",
  nodePath: "/node",
  companionPath: "/companion",
  scanRoot: "/dev",
};
function fake(reply?: (r: Record<string, unknown>) => unknown) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  child.stdin.on("data", (b) => {
    const r = JSON.parse(b.toString());
    if (reply)
      queueMicrotask(() => child.stdout.write(JSON.stringify(reply(r)) + "\n"));
  });
  const launch = vi.fn(() => child);
  return { child, launch: launch as unknown as typeof spawn };
}
const hello = {
  sessionId: "11111111-1111-1111-1111-111111111111",
  hostname: "homelab",
  os: "darwin",
  user: "naman",
  version: "2.0.2",
  scanRoot: "/dev",
  capabilities: ["ports", "vitals"],
};
const connections: SshConnection[] = [];
function connection(f: ReturnType<typeof fake>) {
  const c = new SshConnection(machine, f.launch, 50);
  connections.push(c);
  return c;
}
afterEach(() => {
  connections.forEach((c) => c.close());
  connections.length = 0;
  vi.useRealTimers();
});
describe("SSH lifecycle", () => {
  it("does not start an unhandshaken connection when SSH closes after hello", async () => {
    const f = fake((r) => {
      queueMicrotask(() => c.close());
      return {
        v: 2,
        id: r.id,
        result: { cachedAt: new Date().toISOString(), data: hello },
      };
    });
    const c = connection(f);
    await expect(c.request("ports")).rejects.toThrow(/Connection changed/);
    expect(f.launch).toHaveBeenCalledTimes(1);
  });
  it("handles a broken SSH input pipe without an unhandled stream error", async () => {
    const f = fake();
    const c = connection(f);
    const pending = expect(c.request("hello")).rejects.toThrow(/disconnected/);
    f.child.stdin.emit("error", new Error("EPIPE"));
    await pending;
    expect(c.currentSession).toBeNull();
  });
  it("handshakes once and reuses a connection for concurrent reads", async () => {
    const f = fake((r) => ({
      v: 2,
      id: r.id,
      result: {
        cachedAt: new Date().toISOString(),
        data: r.op === "hello" ? hello : { services: [] },
      },
    }));
    const c = connection(f);
    await Promise.all([c.request("ports"), c.request("ports")]);
    expect(f.launch).toHaveBeenCalledTimes(1);
  });
  it("rejects incompatible protocol and malformed payloads", async () => {
    for (const reply of [
      (r: Record<string, unknown>) => ({ v: 3, id: r.id }),
      (r: Record<string, unknown>) => ({
        v: 2,
        id: r.id,
        result: { cachedAt: "bad", data: hello },
      }),
    ]) {
      const c = connection(fake(reply));
      await expect(c.request("hello")).rejects.toThrow(
        /protocol mismatch|Malformed/,
      );
    }
  });
  it("rejects incompatible companion versions", async () => {
    const c = connection(
      fake((r) => ({
        v: 2,
        id: r.id,
        result: {
          cachedAt: new Date().toISOString(),
          data: { ...hello, version: "9.0.0" },
        },
      })),
    );
    await expect(c.request("hello")).rejects.toThrow(/version mismatch/);
  });
  it("times out pending calls and applies backoff", async () => {
    vi.useFakeTimers();
    const f = fake();
    const c = connection(f);
    const p = expect(c.request("ports")).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(51);
    await p;
    expect(f.child.kill).toHaveBeenCalled();
    await expect(c.request("ports")).rejects.toThrow(/backoff/);
    expect(f.launch).toHaveBeenCalledTimes(1);
  });
  it("rejects pending calls on disconnect without exposing stderr", async () => {
    const f = fake();
    const c = connection(f);
    const p = expect(c.request("hello")).rejects.toThrow(
      /authentication unavailable/,
    );
    f.child.stderr.write("Permission denied SECRET-VALUE");
    f.child.emit("close", 255);
    await p;
    expect(f.child.kill).toHaveBeenCalled();
  });
  it("closes an idle companion", async () => {
    vi.useFakeTimers();
    const f = fake((r) => ({
      v: 2,
      id: r.id,
      result: { cachedAt: new Date().toISOString(), data: hello },
    }));
    const c = connection(f);
    await c.request("hello");
    await vi.advanceTimersByTimeAsync(45001);
    expect(f.child.kill).toHaveBeenCalled();
  });
});

it("does not accept remote-supplied machine provenance", async () => {
  const f = fake((r) => ({
    v: 2,
    id: r.id,
    result: {
      machineId: "local",
      state: "ready",
      cachedAt: new Date().toISOString(),
      data: r.op === "hello" ? hello : { services: [] },
    },
  }));
  const result = await connection(f).request("ports");
  expect(result).not.toHaveProperty("machineId");
  expect(result).not.toHaveProperty("state");
});
