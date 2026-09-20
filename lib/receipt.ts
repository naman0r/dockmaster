import fs from "fs/promises";
import path from "path";
import { dataDir, ensureDataDir } from "@/lib/settings";
import type { Session } from "@/lib/agentwatch";

export type ActionKind = "server" | "worktree" | "artifact";
export type Action = { at: string; kind: ActionKind; count: number; freedKb: number };

export type Receipt = {
  from: string;
  to: string;
  sessions: number;
  agents: Array<{ name: string; sessions: number }>;
  prompts: number;
  toolCalls: number;
  tokensIn: number;
  tokensCached: number;
  tokensOut: number;
  linesAdded: number;
  linesRemoved: number;
  projects: Array<{ name: string; sessions: number; costUsd: number }>;
  costUsd: number;
  // Agents with a session that recorded no cost, so the total can say what it leaves out.
  uncosted: string[];
  serversStopped: number;
  worktreesRemoved: number;
  freedKb: number;
};

const WEEK_MS = 7 * 24 * 3600 * 1000;
const KEEP_MS = 90 * 24 * 3600 * 1000;

function actionsFile(): string {
  return path.join(dataDir(), "actions.json");
}

export async function readActions(): Promise<Action[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(actionsFile(), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ponytail: read-modify-write with no lock; two actions landing in the same
// millisecond can drop one. Switch to append-only lines if that ever shows.
export async function recordAction(kind: ActionKind, count: number, freedKb = 0): Promise<void> {
  if (count <= 0) return;
  const cutoff = Date.now() - KEEP_MS;
  const actions = (await readActions()).filter((a) => Date.parse(a.at) >= cutoff);
  actions.push({ at: new Date().toISOString(), kind, count, freedKb });
  await ensureDataDir();
  const tmp = `${actionsFile()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(actions));
  await fs.rename(tmp, actionsFile());
}

export function buildReceipt(now: number, sessions: Session[], actions: Action[]): Receipt {
  const since = now - WEEK_MS;
  const week = sessions.filter((s) => Date.parse(s.lastActive) >= since);
  const recent = actions.filter((a) => Date.parse(a.at) >= since);
  const sum = (pick: (s: Session) => number) => week.reduce((n, s) => n + pick(s), 0);
  const tally = (kind: ActionKind, pick: (a: Action) => number) =>
    recent.filter((a) => a.kind === kind).reduce((n, a) => n + pick(a), 0);

  const agents = new Map<string, number>();
  const projects = new Map<string, { sessions: number; costUsd: number }>();
  for (const s of week) {
    agents.set(s.agent, (agents.get(s.agent) || 0) + 1);
    const p = projects.get(s.project) || { sessions: 0, costUsd: 0 };
    p.sessions += 1;
    p.costUsd += s.costUsd || 0;
    projects.set(s.project, p);
  }

  return {
    from: new Date(since).toISOString(),
    to: new Date(now).toISOString(),
    sessions: week.length,
    agents: [...agents].map(([name, n]) => ({ name, sessions: n })).sort((a, b) => b.sessions - a.sessions),
    prompts: sum((s) => s.prompts),
    toolCalls: sum((s) => s.toolCalls),
    tokensIn: sum((s) => s.inputTokens),
    tokensCached: sum((s) => s.cacheReadTokens),
    tokensOut: sum((s) => s.outputTokens),
    linesAdded: sum((s) => s.linesAdded),
    linesRemoved: sum((s) => s.linesRemoved),
    projects: [...projects]
      .map(([name, p]) => ({ name, ...p }))
      .sort((a, b) => b.costUsd - a.costUsd || b.sessions - a.sessions)
      .slice(0, 5),
    costUsd: sum((s) => s.costUsd || 0),
    uncosted: [...new Set(week.filter((s) => s.costUsd === null).map((s) => s.agent))].sort(),
    serversStopped: tally("server", (a) => a.count),
    worktreesRemoved: tally("worktree", (a) => a.count),
    freedKb: recent.reduce((n, a) => n + a.freedKb, 0),
  };
}
