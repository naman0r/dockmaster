import fs from "fs/promises";
import { createReadStream } from "fs";
import os from "os";
import path from "path";
import readline from "readline";
import { mapLimit } from "@/lib/async";
import { TtlCache } from "@/lib/cache";
import { exec } from "@/lib/exec";
import { LSOF, findProject, parseCwdOutput, parseDetailOutput } from "@/lib/ports/scan";

export type RunningAgent = {
  pid: number;
  kind: string;
  argv: string;
  cwd: string;
  project: string;
  startedAt: string;
  sessionId: string | null;
};

export type Session = {
  agent: "Claude Code" | "Codex";
  id: string;
  title: string;
  cwd: string;
  project: string;
  branch: string;
  models: string[];
  prompts: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  // Tokens the last turn carried: how full the context window is.
  contextTokens: number;
  costUsd: number | null;
  linesAdded: number;
  linesRemoved: number;
  startedAt: string;
  lastActive: string;
  pid: number | null;
};

export type AgentWatchData = { running: RunningAgent[]; sessions: Session[] };

// Basename of the launched binary, or of the script when a runtime launched it.
// ponytail: exact basename table, so a renamed or wrapped binary is invisible.
const AGENT_BINARIES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  "cursor-agent": "Cursor Agent",
  "kiro-cli": "Kiro CLI",
  kiro_cli: "Kiro CLI",
  aider: "Aider",
  amp: "Amp",
  copilot: "Copilot CLI",
  goose: "Goose",
};
const RUNTIMES = new Set(["node", "bun", "deno", "python", "python3"]);

export function agentKind(argv: string): string | null {
  const tokens = argv.split(/\s+/);
  let candidate = path.basename(tokens[0] || "");
  if (RUNTIMES.has(candidate.replace(/[\d.]+$/, "")) && tokens[1])
    candidate = path.basename(tokens[1]);
  return AGENT_BINARIES[candidate] ?? null;
}

export function sessionIdFromArgv(argv: string): string | null {
  return argv.match(/--session-id[= ]([0-9a-f-]{36})/)?.[1] ?? null;
}

type Folded = Omit<Session, "project" | "pid">;

const blank = (agent: Session["agent"], id: string, cwd = ""): Folded => ({
  agent, id, title: "", cwd, branch: "", models: [], prompts: 0, toolCalls: 0,
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, contextTokens: 0,
  costUsd: null, linesAdded: 0, linesRemoved: 0, startedAt: "", lastActive: "",
});

const promptText = (content: unknown): string => {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.filter((b) => b?.type === "text").map((b) => b.text || "").join(" ")
        : "";
  // Harness-injected context arrives as tagged blocks; a person's prompt does not.
  return text.trim().startsWith("<") ? "" : text.trim();
};

function bump(f: Folded, ts?: string) {
  if (!ts) return;
  if (!f.startedAt || ts < f.startedAt) f.startedAt = ts;
  if (ts > f.lastActive) f.lastActive = ts;
}

// A one-prompt exchange with no tool use ("hi", "!pwd") is noise, not work.
// ponytail: fixed rule; make it a setting if someone wants their one-liners back.
const substantial = (f: Folded) => f.outputTokens > 0 && (f.toolCalls > 0 || f.prompts > 1);

// Claude Code logs one line per content block, each repeating the message's
// usage, so a message id must count once. cost-state and ai-title rows are
// written by the CLI alongside the transcript.
export function foldClaudeLines(lines: string[], id: string): Folded | null {
  const f = blank("Claude Code", id);
  const seen = new Set<string>();
  const models = new Set<string>();
  let firstPrompt = "";
  for (const line of lines) {
    let row: Record<string, any>;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.type === "ai-title" && row.aiTitle) f.title = row.aiTitle;
    if (row.type === "cost-state") {
      f.costUsd = typeof row.totalCostUSD === "number" ? row.totalCostUSD : null;
      f.linesAdded = row.totalLinesAdded || 0;
      f.linesRemoved = row.totalLinesRemoved || 0;
      continue;
    }
    if (row.type !== "user" && row.type !== "assistant") continue;
    bump(f, row.timestamp);
    if (row.cwd && !f.cwd) f.cwd = row.cwd;
    if (row.gitBranch) f.branch = row.gitBranch;
    const m = row.message || {};
    if (row.type === "user" && !row.isMeta) {
      const text = promptText(m.content);
      if (text) {
        f.prompts += 1;
        firstPrompt ||= text;
      }
      continue;
    }
    if (Array.isArray(m.content))
      f.toolCalls += m.content.filter((b: any) => b?.type === "tool_use").length;
    if (!m.usage || !m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    if (m.model && m.model !== "<synthetic>") models.add(m.model);
    const u = m.usage;
    f.inputTokens += u.input_tokens || 0;
    f.outputTokens += u.output_tokens || 0;
    f.cacheReadTokens += u.cache_read_input_tokens || 0;
    f.contextTokens =
      (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  }
  if (!substantial(f)) return null;
  f.title ||= firstPrompt.slice(0, 120);
  f.models = [...models].sort();
  return f;
}

// Codex token_count rows carry cumulative totals; the last one wins.
export function foldCodexLines(lines: string[], id: string): Folded | null {
  const f = blank("Codex", id);
  const models = new Set<string>();
  for (const line of lines) {
    let row: Record<string, any>;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    bump(f, row.timestamp);
    const p = row.payload || {};
    if (row.type === "session_meta") {
      f.cwd = p.cwd || "";
      f.branch = p.git?.branch || "";
    } else if (row.type === "turn_context" && p.model) {
      models.add(p.model);
    } else if (row.type === "response_item" && p.type === "message" && p.role === "user") {
      const text = promptText(
        (p.content || []).map((b: any) => ({ type: "text", text: b?.text || "" })),
      );
      if (text) {
        f.prompts += 1;
        f.title ||= text.slice(0, 120);
      }
    } else if (row.type === "response_item" && /_call$/.test(p.type || "")) {
      f.toolCalls += 1;
    } else if (row.type === "event_msg" && p.type === "token_count" && p.info?.total_token_usage) {
      const u = p.info.total_token_usage;
      f.inputTokens = u.input_tokens || 0;
      f.outputTokens = u.output_tokens || 0;
      f.cacheReadTokens = u.cached_input_tokens || 0;
      const last = p.info.last_token_usage;
      if (last) f.contextTokens = (last.input_tokens || 0) + (last.cached_input_tokens || 0);
    }
  }
  if (!substantial(f)) return null;
  f.models = [...models].sort();
  return f;
}

async function readLines(file: string): Promise<string[]> {
  const lines: string[] = [];
  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) lines.push(line);
  return lines;
}

async function recentJsonl(dir: string, since: number, depth: number): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0) out.push(...(await recentJsonl(full, since, depth - 1)));
    else if (e.isFile() && e.name.endsWith(".jsonl")) {
      const st = await fs.stat(full).catch(() => null);
      if (st && st.mtimeMs >= since) out.push(full);
    }
  }
  return out;
}

// Claude Code honors CLAUDE_CONFIG_DIR, and hosts like T3 Code keep one config
// dir per account under ~/.claude-swap-backup, so a single ~/.claude is not enough.
async function claudeProjectDirs(home: string): Promise<string[]> {
  const dirs = new Set([path.join(home, ".claude", "projects")]);
  if (process.env.CLAUDE_CONFIG_DIR) dirs.add(path.join(process.env.CLAUDE_CONFIG_DIR, "projects"));
  const swap = path.join(home, ".claude-swap-backup", "sessions");
  for (const name of await fs.readdir(swap).catch(() => [] as string[]))
    dirs.add(path.join(swap, name, "projects"));
  return [...dirs];
}

const WINDOW_MS = 7 * 24 * 3600 * 1000;
const MAX_SESSIONS = 60;

export const agentWatchCache = new TtlCache<AgentWatchData>(5000);

export async function scanAgentWatch(): Promise<AgentWatchData> {
  const ps = await exec(["/bin/ps", "-axo", "pid=,ppid=,uid=,lstart=,user=,command="]);
  const mine = process.getuid!();
  const matches = [...parseDetailOutput(ps).values()]
    .map((d) => ({ d, kind: agentKind(d.argv) }))
    .filter((m): m is { d: typeof m.d; kind: string } => m.kind !== null && m.d.uid === mine);
  const cwds = matches.length
    ? parseCwdOutput(
        await exec([LSOF, "-a", "-d", "cwd", "-F", "n", "-p", matches.map((m) => m.d.pid).join(",")], {
          okReturnCodes: [0, 1],
        }),
      )
    : new Map<number, string>();
  const running: RunningAgent[] = await mapLimit(matches, 6, async ({ d, kind }) => {
    const cwd = cwds.get(d.pid) || "";
    return {
      pid: d.pid,
      kind,
      argv: d.argv.slice(0, 200),
      cwd,
      project: (await findProject(cwd)).name,
      startedAt: d.startedAt,
      sessionId: sessionIdFromArgv(d.argv),
    };
  });
  running.sort((a, b) => a.kind.localeCompare(b.kind) || a.pid - b.pid);

  const since = Date.now() - WINDOW_MS;
  const home = os.homedir();
  const sources: Array<[string, number, (lines: string[], id: string) => Folded | null]> = [
    ...(await claudeProjectDirs(home)).map((d): [string, number, typeof foldClaudeLines] => [d, 1, foldClaudeLines]),
    [path.join(home, ".codex", "sessions"), 3, foldCodexLines],
  ];
  const folded: Folded[] = [];
  for (const [dir, depth, fold] of sources) {
    const files = await recentJsonl(dir, since, depth);
    const results = await mapLimit(files, 4, async (file) => {
      const id = path.basename(file, ".jsonl").replace(/^rollout-[\dT-]+-/, "");
      return fold(await readLines(file), id);
    });
    for (const r of results) if (r) folded.push(r);
  }
  folded.sort((a, b) => b.lastActive.localeCompare(a.lastActive));

  // A process claims a session by --session-id, else by sharing a cwd with
  // the newest session of the same agent. Each pid claims at most one.
  const claimed = new Set<number>();
  const sessions: Session[] = await mapLimit(folded.slice(0, MAX_SESSIONS), 6, async (f) => {
    const proc =
      running.find((r) => r.sessionId === f.id) ||
      running.find((r) => !claimed.has(r.pid) && r.kind === f.agent && r.cwd && r.cwd === f.cwd);
    if (proc) claimed.add(proc.pid);
    return { ...f, project: (await findProject(f.cwd)).name || path.basename(f.cwd), pid: proc?.pid ?? null };
  });
  sessions.sort((a, b) => Number(b.pid !== null) - Number(a.pid !== null) || b.lastActive.localeCompare(a.lastActive));
  return { running, sessions };
}
