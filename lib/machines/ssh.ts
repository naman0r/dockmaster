import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { HttpError } from "@/lib/http";
import { randomUUID } from "node:crypto";
import type { RemoteMachine } from "./config";
import {
  Lines,
  COMPANION_VERSION,
  VERSION,
  record,
  parseResult,
  type Action,
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
  private session: string | null = null;
  get currentSession() {
    return this.child ? this.session : null;
  }
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
    this.session = null;
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
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          if (msg.error !== undefined) {
            if (
              !record(msg.error) ||
              typeof msg.error.code !== "number" ||
              msg.error.code < 400 ||
              msg.error.code > 599 ||
              typeof msg.error.message !== "string" ||
              msg.error.message.length > 1000
            ) {
              p.reject(new Error("Malformed companion error."));
              throw new Error("Malformed companion error.");
            }
            p.reject(new HttpError(msg.error.code, msg.error.message));
          } else {
            try {
              p.resolve(parseResult(p.op, msg.result));
            } catch {
              p.reject(
                new Error(
                  "Malformed companion payload. Install the matching companion.",
                ),
              );
              throw new Error("Malformed companion payload.");
            }
          }
          if (!this.pending.size) this.armIdle();
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
  private armIdle() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), 45000);
    this.idle.unref?.();
  }
  private raw(op: Operation, force = false, params?: Action): Promise<Result> {
    if (op === "action") {
      if (!this.currentSession)
        return Promise.reject(
          new HttpError(
            409,
            "Connection changed. Refresh before performing an action.",
          ),
        );
    } else this.start();
    clearTimeout(this.idle);
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
        op === "hello" || ["ports", "vitals"].includes(op)
          ? this.timeoutMs
          : Math.max(this.timeoutMs, op === "action" ? 45000 : 120000),
      );
      this.pending.set(id, { op, resolve, reject, timer });
      this.child!.stdin.write(
        JSON.stringify({
          v: VERSION,
          id,
          op,
          force,
          ...(params ? { params, sessionId: this.session } : {}),
        }) + "\n",
        (e) => {
          if (e) this.close("SSH disconnected.", true);
        },
      );
    });
  }
  async request(op: Operation, force = false): Promise<Result> {
    if (op === "action") throw new Error("Use the explicit mutation method.");
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
        this.session = info.sessionId;
        return info;
      });
    const info = await this.hello;
    if (op === "hello")
      return { cachedAt: new Date().toISOString(), data: info };
    if (!info.capabilities.includes(op))
      throw new Error(
        `Unsupported capability: ${op}. This milestone requires macOS.`,
      );
    return this.raw(op, force);
  }
  mutate(params: Action, expectedSession: string): Promise<Result> {
    if (this.currentSession !== expectedSession)
      return Promise.reject(
        new HttpError(
          409,
          "Connection changed. Refresh before performing an action.",
        ),
      );
    return this.raw("action", false, params);
  }
}
