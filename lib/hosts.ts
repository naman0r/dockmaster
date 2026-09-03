import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { exec } from "@/lib/exec";
import { dataDir, ensureDataDir } from "@/lib/settings";
import { HttpError } from "@/lib/http";

const HOSTS_PATH = "/etc/hosts";

export type HostEntry = {
  ip: string;
  hostnames: string[];
  comment: string | null;
  enabled: boolean;
  raw: string;
};

export type Profile = {
  id: string;
  name: string;
  content: string;
  createdAt: string;
};

// A disabled entry is a whole line commented out; an enabled entry may still
// carry a trailing #comment, which stays attached for display.
export function parseHosts(text: string): HostEntry[] {
  const entries: HostEntry[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    if (raw.trim().startsWith("#")) {
      entries.push({ ip: "", hostnames: [], comment: raw.trim(), enabled: false, raw });
      continue;
    }
    let work = raw;
    let trailing: string | null = null;
    const hash = work.indexOf("#");
    if (hash >= 0) {
      trailing = work.slice(hash).trim();
      work = work.slice(0, hash);
    }
    const tokens = work.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      entries.push({ ip: "", hostnames: [], comment: trailing, enabled: false, raw });
      continue;
    }
    entries.push({
      ip: tokens[0],
      hostnames: tokens.slice(1),
      comment: trailing,
      enabled: true,
      raw,
    });
  }
  return entries;
}

export async function readHostsFile(): Promise<string> {
  try {
    return await fs.readFile(HOSTS_PATH, "utf8");
  } catch {
    throw new HttpError(503, "Could not read /etc/hosts.");
  }
}

export function assertSaneHostsContent(content: string): void {
  if (content.length > 256 * 1024) {
    throw new HttpError(400, "Profile content is too large.");
  }
  const ok = content.split("\n").some((line) => {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    return tokens[0] === "127.0.0.1" && tokens.includes("localhost");
  });
  if (!ok) {
    throw new HttpError(400, "Profile must keep 127.0.0.1 localhost mapped.");
  }
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// The staged file sits in a user-writable directory, so root never trusts it
// directly: it copies into a root-owned temp file, checks that copy's digest
// against the content we hashed, and only then renames it into place.
export function buildElevationScript(tempPath: string, sha256Hex: string): string {
  const src = shellQuote(tempPath);
  const expected = shellQuote(sha256Hex);
  return [
    "set -e",
    "t=$(/usr/bin/mktemp /etc/hosts.dockmaster.XXXXXX)",
    `/bin/cat ${src} > "$t"`,
    `if [ "$(/usr/bin/shasum -a 256 < "$t" | /usr/bin/cut -d' ' -f1)" != ${expected} ]; then /bin/rm -f "$t"; echo 'hosts content changed during apply' >&2; exit 1; fi`,
    '/bin/chmod 644 "$t"',
    '/bin/mv -f "$t" /etc/hosts',
    "/usr/bin/dscacheutil -flushcache",
    "/usr/bin/killall -HUP mDNSResponder",
  ].join("; ");
}

function profilesFile(): string {
  return path.join(dataDir(), "hosts-profiles.json");
}

export async function readProfiles(): Promise<Profile[]> {
  try {
    const raw = await fs.readFile(profilesFile(), "utf8");
    const parsed = JSON.parse(raw) as Profile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeProfiles(profiles: Profile[]): Promise<void> {
  await ensureDataDir();
  const file = profilesFile();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(profiles, null, 2));
  await fs.rename(tmp, file);
}

export async function saveProfile(name: string, content?: string): Promise<Profile> {
  const clean = name.trim();
  if (!clean || clean.length > 80) {
    throw new HttpError(400, "Profile name must be 1-80 characters.");
  }
  const profiles = await readProfiles();
  if (profiles.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    throw new HttpError(409, `A profile named "${clean}" already exists.`);
  }
  const body = content ?? (await readHostsFile());
  assertSaneHostsContent(body);
  const profile: Profile = {
    id: crypto.randomUUID(),
    name: clean,
    content: body,
    createdAt: new Date().toISOString(),
  };
  profiles.push(profile);
  await writeProfiles(profiles);
  return profile;
}

export async function deleteProfile(id: string): Promise<void> {
  const profiles = await readProfiles();
  const next = profiles.filter((p) => p.id !== id);
  if (next.length === profiles.length) {
    throw new HttpError(404, "No profile with that id.");
  }
  await writeProfiles(next);
}

// Writing /etc/hosts needs root. Elevation goes through the macOS GUI auth
// dialog via osascript: no sudoers entry, no privileged daemon. The current
// file is always backed up first.
export async function applyProfile(profile: Profile): Promise<{ backupPath: string }> {
  assertSaneHostsContent(profile.content);
  const dir = await ensureDataDir();
  const current = await readHostsFile();
  const backupPath = path.join(
    dir,
    "hosts-backups",
    `${new Date().toISOString().replace(/[:.]/g, "-")}.hosts`,
  );
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.writeFile(backupPath, current);

  const tempPath = path.join(dir, `hosts-apply-${Date.now()}.tmp`);
  await fs.writeFile(tempPath, profile.content);
  const digest = crypto.createHash("sha256").update(profile.content).digest("hex");
  try {
    await exec(
      [
        "/usr/bin/osascript",
        "-e",
        `do shell script ${JSON.stringify(buildElevationScript(tempPath, digest))} with administrator privileges with prompt "Dockmaster wants to update /etc/hosts"`,
      ],
      { timeoutMs: 120_000 },
    );
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("-128") || message.toLowerCase().includes("user canceled")) {
      throw new HttpError(409, "The authorization prompt was canceled; /etc/hosts was not changed.");
    }
    throw new HttpError(503, `Elevation failed: ${message}`);
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
  return { backupPath };
}
