import fs from "fs/promises";
import { devRoot } from "@/lib/settings";

export type Sample = { app: string; title: string };

// sampleFrontmost emits `app\n title` via linefeed so window titles that
// contain commas survive intact.
export function parseOsascriptOutput(output: string): Sample {
  const trimmed = output.replace(/\n+$/, "");
  const nl = trimmed.indexOf("\n");
  if (nl < 0) return { app: trimmed.trim(), title: "" };
  return { app: trimmed.slice(0, nl).trim(), title: trimmed.slice(nl + 1).trim() };
}

const BROWSERS = new Set([
  "safari",
  "google chrome",
  "chrome",
  "arc",
  "firefox",
  "microsoft edge",
  "brave browser",
]);

const DOMAIN = /\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|dev|io|org|net|app|ai|co|local))\b/i;

function projectFromTitle(title: string, projectNames: string[]): string {
  const lowered = title.toLowerCase();
  let best = "";
  let bestIndex = Infinity;
  for (const name of projectNames) {
    const index = lowered.indexOf(name.toLowerCase());
    if (index >= 0 && index < bestIndex) {
      best = name;
      bestIndex = index;
    }
  }
  return best;
}

export function attributeProject(
  app: string,
  title: string,
  projectNames: string[],
): string {
  if (BROWSERS.has(app.toLowerCase())) {
    const domain = DOMAIN.exec(title);
    if (domain) return domain[1];
    const named = projectFromTitle(title, projectNames);
    return named || app;
  }
  const named = projectFromTitle(title, projectNames);
  return named || app;
}

let projectNamesCache: { at: number; names: string[] } | null = null;

export async function projectNames(): Promise<string[]> {
  const now = Date.now();
  if (projectNamesCache && now - projectNamesCache.at < 10 * 60_000) {
    return projectNamesCache.names;
  }
  let names: string[] = [];
  try {
    const entries = await fs.readdir(devRoot(), { withFileTypes: true });
    names = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  } catch {
    names = [];
  }
  projectNamesCache = { at: now, names };
  return names;
}
