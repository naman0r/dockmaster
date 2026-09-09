import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { RemoteMachine } from "./config";
import {
  Lines,
  COMPANION_VERSION,
  VERSION,
  record,
  validateResult,
  type Operation,
  type Result,
  type Info,
} from "./protocol";
export const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
export function sshArgs(m: RemoteMachine): string[] {
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ConnectTimeout=8",
    "-o",
    "ServerAliveInterval=5",
    "-o",
    "ServerAliveCountMax=2",
    "-o",
    "ClearAllForwardings=yes",
    m.destination,
    `exec ${quote(m.nodePath)} ${quote(m.companionPath)} ${quote(m.scanRoot)}`,
  ];
}
type Pending = {
  op: Operation;
  resolve: (r: Result) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export class SshConnection {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private hello: Promise<Info> | null = null;
  private idle?: ReturnType<typeof setTimeout>;
  private retryAt = 0;
  private failures = 0;
  private lastError = "SSH unavailable.";
  constructor(
    readonly machine: RemoteMachine,
    private launch = spawn,
    private timeoutMs = 12000,
  ) {}
  close(message = "SSH connection closed.", failed = false) {
    const child = this.child;
    this.child = null;
    this.hello = null;
    clearTimeout(this.idle);
    if (failed) {
      this.failures++;
      this.retryAt =
        Date.now() +
        Math.min(30000, 1000 * 2 ** Math.min(this.failures - 1, 5));
      this.lastError = message;
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    this.pending.clear();
    child?.stdin.end();
    child?.kill();
  }
  private start() {
    if (this.child) return;
    if (Date.now() < this.retryAt)
      throw new Error(this.lastError + " Retrying after a short backoff.");
    const c = this.launch("/usr/bin/ssh", sshArgs(this.machine), {
      env: { ...process.env, DOCKMASTER_DEV_ROOT: undefined },
      stdio: "pipe",
    });
    this.child = c;
    const lines = new Lines();
    let diagnostic =
      "SSH unreachable or companion exited. Check reachability and the configured absolute paths.";
    const fail = (message: string) => {
      if (this.child === c) this.close(message, true);
    };
    c.stderr.on("data", (chunk: Buffer) => {
      // Classify only: never relay SSH output, banners, or remote shell content.
      const s = chunk.toString();
      if (/host key|Host identification/i.test(s))
        diagnostic =
          "SSH host key is unknown or changed. Verify the host in Terminal using this destination, then retry.";
      else if (/Permission denied|authentication/i.test(s))
        diagnostic =
          "SSH authentication unavailable. Configure noninteractive SSH access for Dockmaster's user; check Keychain or IdentityAgent for LaunchAgent use.";
      else if (/not found|No such file|Cannot find module/i.test(s))
        diagnostic =
          "Companion or Node not found. Install the companion and verify both absolute paths.";
    });
    c.on("error", () => fail("Unable to start /usr/bin/ssh."));
    c.on("close", () => fail(diagnostic));
    c.stdout.on("data", (chunk: Buffer) => {
      if (this.child !== c) return;
      try {
        lines.push(chunk, (line) => {
          const msg: unknown = JSON.parse(line);
          if (!record(msg) || msg.v !== VERSION)
            throw new Error(
              "Companion protocol mismatch. Rebuild and install the matching companion.",
            );
          if (typeof msg.id !== "string")
            throw new Error(
              "Malformed companion response. Rebuild and install the matching companion.",
            );
          const p = this.pending.get(msg.id);
          if (!p) throw new Error("Unexpected companion response ID.");
          if (msg.error !== undefined)
            throw new Error(
              "Remote collection failed. Verify the companion version, runtime and target permissions.",
            );
          if (!validateResult(p.op, msg.result))
            throw new Error(
              "Malformed companion payload. Rebuild and install the matching companion.",
            );
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          p.resolve({
            cachedAt: msg.result.cachedAt,
            data: msg.result.data,
            ...(msg.result.scanMs === undefined
              ? {}
              : { scanMs: msg.result.scanMs }),
          });
        });
      } catch (e) {
        fail(
          e instanceof SyntaxError
            ? "Malformed companion protocol: stdout must contain only protocol messages."
            : (e as Error).message,
        );
      }
    });
  }
  private raw(op: Operation): Promise<Result> {
    this.start();
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), 45000);
    this.idle.unref?.();
    if (this.pending.size >= 8)
      return Promise.reject(new Error("Companion is busy. Retry shortly."));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(
        () =>
          this.close(
            "SSH request timed out. The machine may be asleep or unreachable.",
            true,
          ),
        this.timeoutMs,
      );
      this.pending.set(id, { op, resolve, reject, timer });
      this.child!.stdin.write(
        JSON.stringify({ v: VERSION, id, op }) + "\n",
        (e) => {
          if (e) this.close("SSH disconnected.", true);
        },
      );
    });
  }
  async request(op: Operation, _force = false): Promise<Result> {
    if (!this.hello)
      this.hello = this.raw("hello").then((r) => {
        const info = r.data as Info;
        if (info.version !== COMPANION_VERSION) {
          this.close(
            `Companion version mismatch. Install companion ${COMPANION_VERSION} from this checkout.`,
            true,
          );
          throw new Error(this.lastError);
        }
        this.failures = 0;
        return info;
      });
    const info = await this.hello;
    if (op === "hello")
      return { cachedAt: new Date().toISOString(), data: info };
    if (!info.capabilities.includes(op))
      throw new Error(
        `Unsupported capability: ${op}. This milestone requires macOS.`,
      );
    return this.raw(op);
  }
}
