import { describe, expect, it } from "vitest";
import { redact, matchLine, isInterestingFile, RULES } from "./secrets";

describe("redact", () => {
  it("never returns the full secret", () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const preview = redact(secret);
    expect(preview).not.toContain("IOSFODNN7EXAMPLE");
    expect(preview).toContain("…");
    expect(preview).toContain("20 chars");
  });
});

describe("matchLine", () => {
  it("matches each rule", () => {
    const cases: Array<[string, string]> = [
      ["aws = AKIAIOSFODNN7EXAMPLE", "aws-access-key"],
      ["slack: xoxb-123456789012-abcdef", "slack-token"],
      ["ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef012345", "github-pat"],
      ["token = sk-proj-abcdefghij1234567890", "openai-key"],
      ["key = AIzaSyA1234567890abcdefghijklmnopqrstuv", "google-api-key"],
    ];
    for (const [line, ruleId] of cases) {
      expect(matchLine(line).some((h) => h.ruleId === ruleId)).toBe(true);
    }
  });

  it("matches private key headers", () => {
    expect(matchLine("-----BEGIN RSA PRIVATE KEY-----")[0].ruleId).toBe("private-key");
  });

  it("flags generic assignments as warnings", () => {
    const hits = matchLine('DB_PASSWORD = "hunter2hunter2"');
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warning");
  });

  it("allows placeholders in generic assignments", () => {
    expect(matchLine('password = "${DB_PASSWORD}"')).toHaveLength(0);
    expect(matchLine('api_key = "changeme"')).toHaveLength(0);
  });

  it("returns no hits for normal code", () => {
    expect(matchLine("const port = 3000;")).toHaveLength(0);
  });
});

describe("isInterestingFile", () => {
  it("selects env, key, and config files", () => {
    expect(isInterestingFile(".env")).toBe(true);
    expect(isInterestingFile(".env.local")).toBe(true);
    expect(isInterestingFile("config/production.yml")).toBe(true);
    expect(isInterestingFile("server.pem")).toBe(true);
    expect(isInterestingFile("id_rsa")).toBe(true);
    expect(isInterestingFile("docker-compose.override.yml")).toBe(true);
  });

  it("ignores ordinary source files", () => {
    expect(isInterestingFile("src/index.ts")).toBe(false);
    expect(isInterestingFile("README.md")).toBe(false);
  });
});

describe("rules", () => {
  it("every rule has an id and label", () => {
    for (const rule of RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.label).toBeTruthy();
    }
  });
});
