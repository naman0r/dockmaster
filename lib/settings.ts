import fs from "fs/promises";
import os from "os";
import path from "path";

export const MODULES = [
  "ports",
  "repos",
  "worktrees",
  "health",
  "hosts",
  "processes",
  "secrets",
  "logbook",
] as const;

export type ModuleId = (typeof MODULES)[number];

export type Settings = {
  modules: Record<ModuleId, boolean>;
};

const DEFAULTS: Settings = {
  modules: {
    ports: true,
    repos: true,
    worktrees: true,
    health: true,
    hosts: true,
    processes: true,
    secrets: true,
    logbook: false,
  },
};

function expandHome(raw: string): string {
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

export function dataDir(): string {
  return expandHome(process.env.DOCKMASTER_DATA_DIR || "~/.dockmaster");
}

export function devRoot(): string {
  return expandHome(process.env.DOCKMASTER_DEV_ROOT || "~/Developer");
}

export function walkDepth(): number {
  const parsed = Number(process.env.DOCKMASTER_WALK_DEPTH);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 8) : 3;
}

export function logbookIntervalMs(): number {
  const parsed = Number(process.env.DOCKMASTER_LOGBOOK_INTERVAL_MS);
  return Number.isInteger(parsed) && parsed >= 3000 ? parsed : 10000;
}

export async function ensureDataDir(): Promise<string> {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(path.join(dataDir(), "settings.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { modules: { ...DEFAULTS.modules, ...(parsed.modules || {}) } };
  } catch {
    return DEFAULTS;
  }
}

export async function writeSettings(next: Settings): Promise<void> {
  await ensureDataDir();
  const file = path.join(dataDir(), "settings.json");
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2));
  await fs.rename(tmp, file);
}

export async function moduleEnabled(id: ModuleId): Promise<boolean> {
  return (await readSettings()).modules[id];
}

export async function patchSettings(
  patch: Partial<Record<ModuleId, boolean>>,
): Promise<Settings> {
  const current = await readSettings();
  const next: Settings = {
    modules: { ...current.modules },
  };
  for (const id of MODULES) {
    if (typeof patch[id] === "boolean") {
      next.modules[id] = patch[id] as boolean;
    }
  }
  await writeSettings(next);
  return next;
}
