import { describe, it, expect } from "vitest";
import { buildReceipt, type Action } from "@/lib/receipt";
import type { Session } from "@/lib/agentwatch";

const now = Date.parse("2026-09-20T12:00:00Z");

const session = (over: Partial<Session>): Session => ({
  agent: "Claude Code", id: "s", title: "", cwd: "/x", project: "app", branch: "", models: [],
  prompts: 2, toolCalls: 10, inputTokens: 100, outputTokens: 50, cacheReadTokens: 900, contextTokens: 0,
  costUsd: 1.5, linesAdded: 20, linesRemoved: 5,
  startedAt: "2026-09-19T10:00:00Z", lastActive: "2026-09-19T11:30:00Z", pid: null, ...over,
});

describe("buildReceipt", () => {
  it("totals the last seven days and names agents that record no cost", () => {
    const r = buildReceipt(
      now,
      [
        session({}),
        session({ agent: "Codex", project: "api", costUsd: null }),
        session({ lastActive: "2026-09-01T00:00:00Z", costUsd: 99 }),
      ],
      [],
    );
    expect(r).toMatchObject({
      sessions: 2, prompts: 4, toolCalls: 20, tokensIn: 200, tokensCached: 1800, tokensOut: 100,
      linesAdded: 40, linesRemoved: 10, costUsd: 1.5, uncosted: ["Codex"],
    });
    expect(r.projects[0]).toEqual({ name: "app", sessions: 1, costUsd: 1.5 });
    expect(r.agents).toHaveLength(2);
  });

  it("counts cleanup actions from this week only", () => {
    const actions: Action[] = [
      { at: "2026-09-19T00:00:00Z", kind: "server", count: 2, freedKb: 0 },
      { at: "2026-09-18T00:00:00Z", kind: "worktree", count: 1, freedKb: 2048 },
      { at: "2026-09-18T00:00:00Z", kind: "artifact", count: 1, freedKb: 1024 },
      { at: "2026-08-01T00:00:00Z", kind: "server", count: 50, freedKb: 9999 },
    ];
    expect(buildReceipt(now, [], actions)).toMatchObject({ serversStopped: 2, worktreesRemoved: 1, freedKb: 3072 });
  });
});
