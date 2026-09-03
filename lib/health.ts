import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { dataDir, ensureDataDir } from "@/lib/settings";
import { HttpError } from "@/lib/http";
import { mapLimit } from "@/lib/async";
import { TtlCache } from "@/lib/cache";

export type Check = { id: string; label: string; url: string };

export type CheckResult = {
  id: string;
  label: string;
  url: string;
  lastStatus: number | null;
  lastOk: boolean | null;
  latencyMs: number | null;
  checkedAt: string | null;
  error: string | null;
};

function checksFile(): string {
  return path.join(dataDir(), "health-checks.json");
}

export async function readChecks(): Promise<Check[]> {
  try {
    const raw = await fs.readFile(checksFile(), "utf8");
    const parsed = JSON.parse(raw) as Check[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writeChecks(checks: Check[]): Promise<void> {
  await ensureDataDir();
  const file = checksFile();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(checks, null, 2));
  await fs.rename(tmp, file);
}

export function validateUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, "url must be a valid absolute URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, "url must use http or https.");
  }
  return parsed.toString();
}

export async function addCheck(label: string, url: string): Promise<Check> {
  const clean = label.trim();
  if (!clean || clean.length > 120) {
    throw new HttpError(400, "label must be 1-120 characters.");
  }
  const checks = await readChecks();
  const check: Check = { id: crypto.randomUUID(), label: clean, url: validateUrl(url) };
  checks.push(check);
  await writeChecks(checks);
  return check;
}

export async function removeCheck(id: string): Promise<void> {
  const checks = await readChecks();
  const next = checks.filter((c) => c.id !== id);
  if (next.length === checks.length) {
    throw new HttpError(404, "No check with that id.");
  }
  await writeChecks(next);
}

export async function runCheck(check: Check, timeoutMs = 4000): Promise<CheckResult> {
  const base: CheckResult = {
    id: check.id,
    label: check.label,
    url: check.url,
    lastStatus: null,
    lastOk: null,
    latencyMs: null,
    checkedAt: new Date().toISOString(),
    error: null,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(check.url, {
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
    });
    return { ...base, lastStatus: res.status, lastOk: res.ok, latencyMs: Date.now() - started };
  } catch (err) {
    const message =
      controller.signal.aborted ? `timed out after ${timeoutMs}ms` : (err as Error).message;
    return { ...base, lastOk: false, latencyMs: Date.now() - started, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function runAllChecks(): Promise<CheckResult[]> {
  const checks = await readChecks();
  return mapLimit(checks, 8, (c) => runCheck(c));
}

export const resultsCache = new TtlCache<CheckResult[]>(30_000);
