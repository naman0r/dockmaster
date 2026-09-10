import { z } from "zod";
import type { Service } from "@/lib/ports/scan";
import type { Vitals } from "@/lib/vitals";
import type { ReposData } from "@/lib/repos/scan";
import type { RepoWorktrees } from "@/lib/worktrees/scan";
import type { ProcessSample } from "@/lib/processes";
import type { CheckResult } from "@/lib/health";
import type { HostEntry } from "@/lib/hosts";
import type { scanSecrets } from "@/lib/secrets";
export const VERSION = 2;
export const COMPANION_VERSION = "2.0.2";
export const MAX_MESSAGE = 2 * 1024 * 1024;
export const READ_OPERATIONS = [
  "ports",
  "vitals",
  "repos",
  "worktrees",
  "processes",
  "health",
  "hosts",
  "secrets",
] as const;
export type ReadOperation = (typeof READ_OPERATIONS)[number];
export type Operation = "hello" | ReadOperation | "action";
export type Info = {
  hostname: string;
  os: string;
  user: string;
  version: string;
  scanRoot: string;
  capabilities: string[];
  sessionId: string;
};
export type HostsData = {
  entries: HostEntry[];
  profiles: {
    id: string;
    name: string;
    createdAt: string;
    lineCount: number;
  }[];
  activeProfile: string | null;
  revision: string;
  canApply: boolean;
};
export type Payloads = {
  hello: Info;
  ports: { services: Service[] };
  vitals: Vitals;
  repos: ReposData;
  worktrees: RepoWorktrees[];
  processes: {
    sample: ProcessSample[];
    sampledAt: string;
    intervalMs: number;
    currentUid: number;
  };
  health: { checks: CheckResult[] };
  hosts: HostsData;
  secrets: Awaited<ReturnType<typeof scanSecrets>>;
  action: { ok: boolean; stillAlive?: boolean; stillListening?: boolean };
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
  lease?: string;
};
export function record(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}
const str = z.string().max(32768);
const num = z.number().finite().nonnegative();
const integer = num.int();
const date = z.string().datetime({ offset: true });
const github = z
  .string()
  .regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/)
  .nullable();
const service = z.object({
  pid: integer.positive(),
  ppid: integer,
  port: integer.min(1).max(65535),
  addresses: z.array(str).max(100),
  kind: str,
  project: str,
  cwd: str,
  argv: str,
  user: str,
  startedAt: str,
  isSystem: z.boolean(),
  isStoppable: z.boolean(),
  isExposed: z.boolean(),
  note: str,
});
const count = z.object({
  modified: integer,
  added: integer,
  deleted: integer,
  renamed: integer,
  copied: integer,
  conflicted: integer,
  untrackedFiles: integer,
  untrackedFolders: integer,
});
const schemas = {
  hello: z.object({
    hostname: str,
    os: str,
    user: str,
    version: str,
    scanRoot: str,
    capabilities: z.array(str).max(32),
    sessionId: z.string().uuid(),
  }),
  ports: z.object({ services: z.array(service).max(10000) }),
  vitals: z.object({
    uptimeSeconds: num,
    cores: integer.positive(),
    loadAvg: z.tuple([num, num, num]).nullable(),
    memFreePct: num.max(100).nullable(),
    disk: z.object({ freeKb: num, totalKb: num, usedPct: num }).nullable(),
    battery: z
      .object({ pct: num.max(100), source: str, status: str })
      .nullable(),
    sampledAt: date,
    cpuPct: num.max(100).nullable().optional(),
    memTotalBytes: num.optional(),
    memUsedBytes: num.optional(),
    memCachedBytes: num.optional(),
  }),
  repos: z.object({
    root: str,
    depth: integer,
    repos: z
      .array(
        z.object({
          githubUrl: github,
          name: str,
          path: str,
          branch: str,
          dirty: integer,
          changes: count,
          ahead: integer,
          behind: integer,
          hasUpstream: z.boolean(),
          lastCommitIso: str,
          lastCommitSubject: str,
          staleBranches: integer,
          error: str,
        }),
      )
      .max(10000),
  }),
  worktrees: z
    .array(
      z.object({
        githubUrl: github,
        name: str,
        path: str,
        revision: z.string().length(64),
        worktrees: z
          .array(
            z.object({
              path: str,
              head: str,
              branch: str,
              isMain: z.boolean(),
              isPrunable: z.boolean(),
              reason: str,
            }),
          )
          .max(10000),
        staleBranches: z
          .array(
            z.object({ name: str, lastCommitIso: str, merged: z.boolean() }),
          )
          .max(10000),
      }),
    )
    .max(10000),
  processes: z.object({
    sample: z
      .array(
        z.object({
          pid: integer.positive(),
          uid: integer,
          user: str,
          command: str,
          cpuPct: num,
          rssKb: num,
          startedAt: str,
          isStoppable: z.boolean(),
        }),
      )
      .max(10000),
    sampledAt: date,
    intervalMs: num,
    currentUid: integer,
  }),
  health: z.object({
    checks: z
      .array(
        z.object({
          id: str,
          label: str,
          url: z
            .string()
            .max(4096)
            .url()
            .refine((s) => /^https?:\/\//.test(s)),
          lastStatus: integer.nullable(),
          lastOk: z.boolean().nullable(),
          latencyMs: num.nullable(),
          checkedAt: date.nullable(),
          error: str.nullable(),
        }),
      )
      .max(1000),
  }),
  hosts: z.object({
    entries: z
      .array(
        z.object({
          ip: str,
          hostnames: z.array(str).max(100),
          comment: str.nullable(),
          enabled: z.boolean(),
          raw: str,
        }),
      )
      .max(10000),
    profiles: z
      .array(
        z.object({ id: str, name: str, createdAt: date, lineCount: integer }),
      )
      .max(1000),
    activeProfile: str.nullable(),
    revision: z.string().length(64),
    canApply: z.boolean(),
  }),
  secrets: z.object({
    scannedRepos: integer,
    findings: z
      .array(
        z.object({
          repo: str,
          path: str,
          line: integer,
          ruleId: str,
          ruleLabel: str,
          severity: z.enum(["high", "warning"]),
          preview: z.literal("[redacted]"),
          length: integer,
        }),
      )
      .max(20000),
    untrackedEnvFiles: z.array(z.object({ repo: str, path: str })).max(10000),
  }),
  action: z.object({
    ok: z.boolean(),
    stillAlive: z.boolean().optional(),
    stillListening: z.boolean().optional(),
  }),
};
const pid = z.number().int().min(2);
const mode = z.enum(["term", "kill"]);
const absolute = z
  .string()
  .min(1)
  .max(4096)
  .startsWith("/")
  .refine((s) => !/[\x00-\x1f]/.test(s));
const revision = z.string().regex(/^[a-f0-9]{64}$/);
export const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("ports.stop"),
      pid,
      port: z.number().int().min(1).max(65535),
      startedAt: str.min(1),
      mode,
    })
    .strict(),
  z
    .object({
      action: z.literal("processes.kill"),
      pid,
      startedAt: str.min(1),
      mode,
    })
    .strict(),
  z
    .object({
      action: z.literal("worktrees.remove"),
      repoPath: absolute,
      worktreePath: absolute,
      revision,
      force: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("worktrees.prune"),
      repoPath: absolute,
      revision,
    })
    .strict(),
  z
    .object({
      action: z.literal("worktrees.delete-branch"),
      repoPath: absolute,
      branch: str.min(1),
      revision,
      force: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("health.add"),
      label: str.min(1).max(120),
      url: str.max(4096),
    })
    .strict(),
  z.object({ action: z.literal("health.remove"), id: str.min(1) }).strict(),
  z
    .object({
      action: z.literal("hosts.save"),
      name: str.min(1).max(80),
      content: z.string().max(262144).optional(),
    })
    .strict(),
  z.object({ action: z.literal("hosts.delete"), id: str.min(1) }).strict(),
  z
    .object({ action: z.literal("hosts.apply"), id: str.min(1), revision })
    .strict(),
]);
export type Action = z.infer<typeof actionSchema>;
const requestSchema = z
  .object({
    v: z.literal(VERSION),
    id: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
    op: z.enum(["hello", ...READ_OPERATIONS, "action"]),
    force: z.boolean().optional(),
    params: actionSchema.optional(),
    sessionId: z.string().uuid().optional(),
  })
  .strict()
  .refine((r) =>
    r.op === "action" ? !!r.params && !!r.sessionId : !r.params && !r.sessionId,
  );
export function validRequest(x: unknown): x is z.infer<typeof requestSchema> {
  return requestSchema.safeParse(x).success;
}
export function parseResult(op: Operation, x: unknown): Result {
  const envelope = z
    .object({ cachedAt: date, scanMs: num.optional(), data: schemas[op] })
    .parse(x);
  return envelope as Result;
}
export function validateResult(op: Operation, x: unknown): x is Result {
  try {
    parseResult(op, x);
    return true;
  } catch {
    return false;
  }
}
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
