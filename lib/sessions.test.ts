import { describe, it, expect } from "vitest";
import { buildWorkspaces, leftoverServers, parseProcs, type Tree } from "@/lib/sessions";
import type { Session } from "@/lib/agentwatch";
import type { Service } from "@/lib/ports/scan";

const now = Date.parse("2026-09-20T12:00:00Z");
const root = "/Users/me/Developer/app";
const wt = "/Users/me/Developer/app/.worktrees/fix";

const session = (over: Partial<Session>): Session => ({
  agent: "Claude Code", id: "s1", title: "", cwd: root, project: "app", branch: "main", models: [],
  prompts: 2, toolCalls: 3, inputTokens: 0, outputTokens: 1, cacheReadTokens: 0, contextTokens: 0,
  costUsd: 1.5, linesAdded: 0, linesRemoved: 0,
  startedAt: "2026-09-18T10:00:00Z", lastActive: "2026-09-18T11:00:00Z", pid: null, ...over,
});

const service = (over: Partial<Service>): Service => ({
  pid: 500, ppid: 1, port: 3000, addresses: ["127.0.0.1"], kind: "Vite", project: "app", repoPath: root,
  cwd: root, argv: "vite", user: "me", startedAt: "2026-09-18T10:30:00Z",
  isSystem: false, isStoppable: true, isExposed: false, note: "", ...over,
});

const tree = (over: Partial<Tree>): Tree => ({
  path: wt, repoPath: root, branch: "fix", isPrunable: false, merged: true, dirty: 0,
  createdAt: "2026-09-10T00:00:00Z", sizeKb: 2048, ...over,
});

const build = (over: Partial<Parameters<typeof buildWorkspaces>[0]>) =>
  buildWorkspaces({ now, sessions: [], running: [], services: [], procs: new Map(), trees: [], roots: new Map([[root, root]]), ...over });

describe("buildWorkspaces", () => {
  it("flags a terminal-less server that outlived its agent", () => {
    const data = build({ sessions: [session({})], services: [service({})], procs: new Map([[500, { ppid: 1, tty: false }]]) });
    expect(leftoverServers(data.workspaces[0])).toHaveLength(1);
    expect(data.leftovers).toMatchObject({ agents: 1, servers: 1, worktrees: 0 });
  });

  it("leaves alone servers with a terminal, older than the session, or protected", () => {
    for (const [svc, tty] of [
      [service({}), true],
      [service({ startedAt: "2026-09-01T00:00:00Z" }), false],
      [service({ isStoppable: false }), false],
    ] as const) {
      const data = build({ sessions: [session({})], services: [svc], procs: new Map([[500, { ppid: 1, tty }]]) });
      expect(data.leftovers.servers).toBe(0);
    }
    const active = build({
      sessions: [session({ lastActive: "2026-09-20T11:58:00Z" })],
      services: [service({})],
      procs: new Map([[500, { ppid: 1, tty: false }]]),
    });
    expect(active.leftovers.servers).toBe(0);
  });

  it("gives a server to the running agent that launched it", () => {
    const running = [{ pid: 40, kind: "Claude Code", argv: "claude", cwd: root, project: "app", startedAt: "", sessionId: null }];
    const procs = new Map([[500, { ppid: 45, tty: false }], [45, { ppid: 40, tty: false }]]);
    const data = build({ running, services: [service({ cwd: "/tmp" })], procs });
    expect(data.workspaces[0].servers[0].owner).toBe("agent");
    expect(data.leftovers.servers).toBe(0);
  });

  it("lets a folder that is not a repo claim only servers started in it", () => {
    const home = build({ sessions: [session({ cwd: "/Users/me" })], services: [service({})], roots: new Map() });
    expect(home.workspaces[0].servers).toHaveLength(0);
    const daemon = build({ sessions: [session({ cwd: "/Users/me" })], services: [service({ cwd: "/Users/me" })], roots: new Map() });
    expect(daemon.workspaces[0].servers).toHaveLength(0);
    const plain = build({ sessions: [session({})], services: [service({})], roots: new Map() });
    expect(plain.workspaces[0].servers).toHaveLength(1);
  });

  it("flags a quiet merged worktree, and nothing dirty, fresh, or on main", () => {
    expect(build({ trees: [tree({})] }).leftovers).toMatchObject({ worktrees: 1, kb: 2048 });
    for (const t of [
      tree({ dirty: 1 }),
      tree({ branch: "main" }),
      tree({ createdAt: "2026-09-20T09:00:00Z" }),
      tree({ merged: false }),
    ])
      expect(build({ trees: [t] }).workspaces, JSON.stringify(t)).toHaveLength(0);
    const busy = build({ trees: [tree({})], sessions: [session({ cwd: wt, lastActive: "2026-09-20T11:00:00Z" })] });
    expect(busy.leftovers.worktrees).toBe(0);
  });
});

describe("parseProcs", () => {
  it("reads ppid and whether a terminal is attached", () => {
    const procs = parseProcs("  500     1 ??\n  600   590 ttys003\n\n");
    expect(procs.get(500)).toEqual({ ppid: 1, tty: false });
    expect(procs.get(600)).toEqual({ ppid: 590, tty: true });
  });
});
