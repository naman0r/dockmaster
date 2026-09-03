import fs from "fs/promises";
import path from "path";
import { exec } from "@/lib/exec";
import { mapLimit } from "@/lib/async";
import { findRepos } from "@/lib/walk";
import { devRoot, walkDepth } from "@/lib/settings";

export type SecretRule = {
  id: string;
  label: string;
  pattern: RegExp;
  severity: "high" | "warning";
};

export type Finding = {
  repo: string;
  path: string;
  line: number;
  ruleId: string;
  ruleLabel: string;
  severity: "high" | "warning";
  preview: string;
  length: number;
};

const PLACEHOLDER = /(\$\{[^}]*\}|<[^>]*>|your[-_]|changeme|example|xxx|todo|insert[-_])/i;

export const RULES: SecretRule[] = [
  { id: "aws-access-key", label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/, severity: "high" },
  { id: "slack-token", label: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, severity: "high" },
  { id: "github-pat", label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, severity: "high" },
  { id: "private-key", label: "Private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, severity: "high" },
  { id: "openai-key", label: "OpenAI-style key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/, severity: "high" },
  { id: "google-api-key", label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, severity: "high" },
  {
    id: "generic-secret",
    label: "Secret-looking assignment",
    // Lookbehind blocks letter-prefixed words (notasecret) while still
    // matching keys like DB_PASSWORD or apiKey.
    pattern: /(?<![a-z])(password|passwd|secret|api_?key|auth_?token)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    severity: "warning",
  },
];

export function redact(secret: string): string {
  if (secret.length <= 8) return "…";
  return `${secret.slice(0, 4)}… (${secret.length} chars)`;
}

export function matchLine(line: string): Array<{ ruleId: string; ruleLabel: string; severity: "high" | "warning"; preview: string; length: number }> {
  const hits: ReturnType<typeof matchLine> = [];
  for (const rule of RULES) {
    const match = rule.pattern.exec(line);
    if (!match) continue;
    if (rule.id === "generic-secret" && PLACEHOLDER.test(match[0])) continue;
    hits.push({
      ruleId: rule.id,
      ruleLabel: rule.label,
      severity: rule.severity,
      preview: redact(match[0]),
      length: match[0].length,
    });
  }
  return hits;
}

const INTERESTING = /(^\.env|\.env$|\.env\.|\.pem$|\.key$|id_rsa|settings\.py$|compose.*\.ya?ml$|(^|\/)(config|conf)\.[a-z]+$)/i;

export function isInterestingFile(relPath: string): boolean {
  const base = path.basename(relPath).toLowerCase();
  if (base.startsWith(".env") || base.endsWith(".env")) return true;
  if (/\.(pem|key)$/.test(base) || base.startsWith("id_rsa")) return true;
  if (base === "settings.py") return true;
  if (/compose.*\.ya?ml$/.test(base)) return true;
  if (INTERESTING.test(relPath)) return true;
  return /\.(ya?ml|toml|ini|json|properties)$/.test(base) && relPath.split(path.sep).includes("config");
}

const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES_PER_REPO = 400;

type RepoResult = { findings: Finding[]; untrackedEnv: string[] };

async function scanRepo(repoPath: string): Promise<RepoResult> {
  const result: RepoResult = { findings: [], untrackedEnv: [] };
  let tracked: string[];
  try {
    const out = await exec(["git", "-C", repoPath, "ls-files"], { timeoutMs: 8000 });
    tracked = out.split("\n").filter(Boolean);
  } catch {
    return result;
  }
  const trackedSet = new Set(tracked);

  const candidates = tracked.filter(isInterestingFile).slice(0, MAX_FILES_PER_REPO);

  // .env-style files sitting in the worktree but NOT committed are the good ones.
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(repoPath)).filter((name) => name.startsWith(".env") || name.endsWith(".env"));
  } catch {
    // Repo directory unreadable; tracked scan above already failed silently.
  }
  result.untrackedEnv = entries.filter((name) => !trackedSet.has(name));

  await mapLimit(candidates, 8, async (rel) => {
    const full = path.join(repoPath, rel);
    try {
      const stat = await fs.stat(full);
      if (stat.size > MAX_FILE_BYTES) return;
      const [head, content] = await Promise.all([
        fs.open(full, "r").then(async (handle) => {
          const buf = Buffer.alloc(8192);
          const { bytesRead } = await handle.read(buf, 0, 8192, 0);
          await handle.close();
          return buf.subarray(0, bytesRead);
        }),
        fs.readFile(full, "utf8"),
      ]);
      if (head.includes(0)) return;
      content.split("\n").forEach((line, index) => {
        for (const hit of matchLine(line)) {
          result.findings.push({
            repo: path.basename(repoPath),
            path: rel,
            line: index + 1,
            ruleId: hit.ruleId,
            ruleLabel: hit.ruleLabel,
            severity: hit.severity,
            preview: hit.preview,
            length: hit.length,
          });
        }
      });
    } catch {
      // Unreadable file (permissions, race); skip it.
    }
  });
  return result;
}

export async function scanSecrets(): Promise<{
  scannedRepos: number;
  findings: Finding[];
  untrackedEnvFiles: Array<{ repo: string; path: string }>;
}> {
  const root = devRoot();
  const repoPaths = await findRepos(root, walkDepth());
  const results = await mapLimit(repoPaths, 4, scanRepo);
  const findings = results.flatMap((r) => r.findings);
  findings.sort(
    (a, b) =>
      (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1) ||
      a.repo.localeCompare(b.repo) ||
      a.path.localeCompare(b.path),
  );
  return {
    scannedRepos: repoPaths.length,
    findings,
    untrackedEnvFiles: results.flatMap((r, i) =>
      r.untrackedEnv.map((p) => ({ repo: path.basename(repoPaths[i]), path: p })),
    ),
  };
}
