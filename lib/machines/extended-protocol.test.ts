import { it, expect } from "vitest";
import { parseResult, VERSION, validRequest } from "./protocol";
it("validates action shape and requires connection identity", () => {
  const req = {
    v: VERSION,
    id: "a",
    op: "action",
    params: {
      action: "processes.kill",
      pid: 42,
      startedAt: "stamp",
      mode: "term",
    },
  };
  expect(validRequest(req)).toBe(false);
  expect(
    validRequest({ ...req, sessionId: "11111111-1111-1111-1111-111111111111" }),
  ).toBe(true);
  expect(
    validRequest({
      ...req,
      sessionId: "11111111-1111-1111-1111-111111111111",
      params: { action: "exec", command: "anything" },
    }),
  ).toBe(false);
});
it("rejects secret previews containing raw or partially redacted values", () => {
  const data = {
    scannedRepos: 1,
    findings: [
      {
        repo: "test",
        path: ".env",
        line: 1,
        ruleId: "test",
        ruleLabel: "test",
        severity: "high",
        preview: "sk-fake…",
        length: 30,
      },
    ],
    untrackedEnvFiles: [],
    envDrift: [],
  };
  expect(() =>
    parseResult("secrets", { cachedAt: new Date().toISOString(), data }),
  ).toThrow();
  data.findings[0].preview = "[redacted]";
  expect(() =>
    parseResult("secrets", { cachedAt: new Date().toISOString(), data }),
  ).not.toThrow();
});
it("rejects executable repository URLs from remote payloads", () => {
  const data = {
    root: "/dev",
    depth: 3,
    repos: [{ githubUrl: "javascript:alert(1)" }],
  };
  expect(() =>
    parseResult("repos", { cachedAt: new Date().toISOString(), data }),
  ).toThrow();
});
