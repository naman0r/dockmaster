import { describe, expect, it } from "vitest";
import { agentKind, foldClaudeLines, foldCodexLines, foldOpenCodeRows, sessionIdFromArgv } from "./agentwatch";

describe("agentKind", () => {
  it("matches the binary basename or the script a runtime launched", () => {
    expect(agentKind("/Users/x/.local/bin/claude --session-id abc")).toBe("Claude Code");
    expect(agentKind("claude --output-format stream-json")).toBe("Claude Code");
    expect(agentKind("node /opt/homebrew/bin/gemini")).toBe("Gemini CLI");
    expect(agentKind("python3.12 /x/aider")).toBe("Aider");
  });
  it("ignores lookalikes", () => {
    expect(agentKind("/Applications/Kiro CLI.app/Contents/MacOS/kiro_cli_desktop")).toBeNull();
    expect(agentKind("/Applications/CodexBar.app/Contents/MacOS/CodexBar")).toBeNull();
    expect(agentKind("node server.js --claude")).toBeNull();
  });
  it("pulls a session id out of argv", () => {
    expect(sessionIdFromArgv("claude --session-id ba4bc031-a6d1-4da4-a1ff-0855ff7bf4a6 --verbose")).toBe(
      "ba4bc031-a6d1-4da4-a1ff-0855ff7bf4a6",
    );
    expect(sessionIdFromArgv("claude")).toBeNull();
  });
});

const assistant = (id: string, tools = 0) =>
  JSON.stringify({
    type: "assistant",
    cwd: "/Users/x/Developer/shop",
    gitBranch: "feat/cart",
    timestamp: "2026-09-17T03:19:18.914Z",
    message: {
      id,
      model: "claude-fable-5-1",
      content: Array.from({ length: tools }, () => ({ type: "tool_use", name: "Bash" })),
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
    },
  });
const user = (content: unknown, extra = {}) =>
  JSON.stringify({ type: "user", cwd: "/Users/x/Developer/shop", timestamp: "2026-09-17T03:19:16.000Z", message: { content }, ...extra });

describe("foldClaudeLines", () => {
  it("counts a message id once, prompts, tools, context, and cost-state", () => {
    const f = foldClaudeLines(
      [
        user("<system-reminder>ignored</system-reminder>"),
        user("fix the cart"),
        assistant("m1", 2),
        assistant("m1", 2),
        user([{ type: "tool_result", content: "ok" }]),
        assistant("m2"),
        "garbage",
        JSON.stringify({ type: "cost-state", totalCostUSD: 0.42, totalLinesAdded: 12, totalLinesRemoved: 3 }),
      ],
      "s1",
    )!;
    expect(f).toMatchObject({
      title: "fix the cart",
      prompts: 1,
      toolCalls: 4,
      inputTokens: 20,
      outputTokens: 10,
      cacheReadTokens: 200,
      contextTokens: 130,
      costUsd: 0.42,
      linesAdded: 12,
      linesRemoved: 3,
      branch: "feat/cart",
      cwd: "/Users/x/Developer/shop",
      models: ["claude-fable-5-1"],
      startedAt: "2026-09-17T03:19:16.000Z",
      lastActive: "2026-09-17T03:19:18.914Z",
    });
  });
  it("prefers the CLI's ai-title and drops empty or one-shot transcripts", () => {
    const f = foldClaudeLines([JSON.stringify({ type: "ai-title", aiTitle: "Cart fix" }), user("fix the cart"), assistant("m1", 1)], "s")!;
    expect(f.title).toBe("Cart fix");
    expect(foldClaudeLines([JSON.stringify({ type: "cost-state" }), user("hi")], "s")).toBeNull();
    expect(foldClaudeLines([user("hi"), assistant("m1")], "s")).toBeNull();
    expect(foldClaudeLines([user("hi"), assistant("m1"), user("and?"), assistant("m2")], "s")).not.toBeNull();
  });
});

describe("foldCodexLines", () => {
  it("takes the last cumulative token_count, the git branch, and the first human prompt", () => {
    const lines = [
      JSON.stringify({ timestamp: "2026-08-22T22:26:41Z", type: "session_meta", payload: { cwd: "/Users/x/Developer/site", git: { branch: "main" } } }),
      JSON.stringify({ type: "turn_context", payload: { model: "gpt-5-codex" } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>x" }] } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "add tests" }] } }),
      JSON.stringify({ type: "response_item", payload: { type: "custom_tool_call" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 5, output_tokens: 1, cached_input_tokens: 2 } } } }),
      JSON.stringify({ timestamp: "2026-08-22T22:30:00Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 50, output_tokens: 9, cached_input_tokens: 20 }, last_token_usage: { input_tokens: 30, cached_input_tokens: 20 } } } }),
    ];
    const f = foldCodexLines(lines, "c1")!;
    expect(f).toMatchObject({
      title: "add tests",
      prompts: 1,
      toolCalls: 1,
      inputTokens: 50,
      outputTokens: 9,
      cacheReadTokens: 20,
      contextTokens: 50,
      branch: "main",
      cwd: "/Users/x/Developer/site",
      lastActive: "2026-08-22T22:30:00Z",
      models: ["gpt-5-codex"],
      costUsd: null,
    });
  });
});

describe("foldOpenCodeRows", () => {
  it("rolls subagent spend into the parent and drops one-shot sessions", () => {
    const row = (id: string, extra = {}) => ({
      id, parent_id: null, title: "sweep the repos", directory: "/Users/x/Developer/subc",
      model: JSON.stringify({ id: "glm-5.3-flash" }), cost: 0.25, tokens_input: 100, tokens_output: 40,
      tokens_cache_read: 1000, summary_additions: 3, summary_deletions: 1, time_created: 1789860501639,
      time_updated: 1789862338977, prompts: 2, tools: 5,
      last_tokens: JSON.stringify({ input: 10, cache: { read: 200, write: 5 } }), ...extra,
    });
    const out = foldOpenCodeRows([
      row("top"),
      row("kid", { parent_id: "top", cost: 0.05, tools: 7, time_updated: 1789862400000 }),
      row("grandkid", { parent_id: "kid", cost: 0.01, tools: 1 }),
      row("hi", { prompts: 1, tools: 0, last_tokens: null, model: "not json" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      agent: "OpenCode", id: "top", cwd: "/Users/x/Developer/subc", models: ["glm-5.3-flash"], prompts: 2,
      toolCalls: 13, inputTokens: 300, outputTokens: 120, contextTokens: 215, linesAdded: 3, linesRemoved: 1,
      lastActive: new Date(1789862400000).toISOString(),
    });
    expect(out[0].costUsd).toBeCloseTo(0.31);
  });
});
