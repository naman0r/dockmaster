import fs from "fs/promises";
import os from "os";
import path from "path";
import { exec } from "@/lib/exec";
import { HttpError } from "@/lib/http";
import { TtlCache } from "@/lib/cache";
import { mapLimit } from "@/lib/async";
import { findRepos } from "@/lib/walk";
import { devRoot, walkDepth } from "@/lib/settings";

// Directory names that are always regenerable from source. Anything with one
// of these names under the dev root is eligible for cleaning; nothing else is.
export const ARTIFACT_DIRS = new Set([
  "node_modules",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  ".venv",
  "venv",
  ".pytest_cache",
  ".mypy_cache",
  ".gradle",
]);

// Tool caches outside the dev root. Each tool rebuilds its cache on demand.
export const HOME_CACHES: Array<{ label: string; rel: string }> = [
  { label: "Xcode DerivedData", rel: "Library/Developer/Xcode/DerivedData" },
  { label: "Xcode archives", rel: "Library/Developer/Xcode/Archives" },
  { label: "iOS device support", rel: "Library/Developer/Xcode/iOS DeviceSupport" },
  { label: "CoreSimulator caches", rel: "Library/Developer/CoreSimulator/Caches" },
  { label: "Homebrew cache", rel: "Library/Caches/Homebrew" },
  { label: "npm cache", rel: ".npm/_cacache" },
  { label: "pnpm store", rel: "Library/pnpm" },
  { label: "Yarn cache", rel: "Library/Caches/Yarn" },
  { label: "pip cache", rel: "Library/Caches/pip" },
  { label: "uv cache", rel: ".cache/uv" },
  { label: "Cargo registry", rel: ".cargo/registry" },
  { label: "Go build cache", rel: "Library/Caches/go-build" },
  { label: "Gradle caches", rel: ".gradle/caches" },
  { label: "CocoaPods cache", rel: "Library/Caches/CocoaPods" },
  { label: "Playwright browsers", rel: "Library/Caches/ms-playwright" },
  { label: "Puppeteer browsers", rel: ".cache/puppeteer" },
  { label: "Hugging Face hub", rel: ".cache/huggingface" },
];

export type Artifact = { path: string; name: string; sizeKb: number };
export type RepoDisk = { name: string; path: string; sizeKb: number; artifacts: Artifact[] };
export type CacheDisk = { label: string; path: string; sizeKb: number };
export type DiskData = {
  root: string;
  repos: RepoDisk[];
  caches: CacheDisk[];
  reclaimableKb: number;
};

export const diskCache = new TtlCache<DiskData>(10 * 60_000);

const REPO_DEPTH = 3;
const DU_CONCURRENCY = 4;
// Below this a row is noise (empty dist/, stray caches) and hides the real hogs.
const MIN_LIST_KB = 1024;

// du -sk prints "<kb>\t<path>" per argument; unreadable paths print to stderr
// and exit 1, which we tolerate because a partial answer still helps.
export function parseDu(output: string): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const line of output.split("\n")) {
    const m = /^(\d+)\t(.+)$/.exec(line);
    if (m) sizes.set(m[2], Number(m[1]));
  }
  return sizes;
}

export async function du(paths: string[], flags: string[] = []): Promise<Map<string, number>> {
  if (!paths.length) return new Map();
  const out = await exec(["/usr/bin/du", "-sk", ...flags, ...paths], {
    timeoutMs: 90000,
    okReturnCodes: [0, 1],
  });
  return parseDu(out);
}

// Artifact dirs are never descended into, so nested node_modules inside one
// count toward their parent. .git is skipped because it is not reclaimable.
async function findArtifacts(repo: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, level: number) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === ".git") continue;
      const full = path.join(dir, e.name);
      if (ARTIFACT_DIRS.has(e.name)) found.push(full);
      else if (level < REPO_DEPTH) await walk(full, level + 1);
    }
  }
  await walk(repo, 0);
  return found;
}

export async function scanDisk(): Promise<DiskData> {
  const root = devRoot();
  const repoPaths = await findRepos(root, walkDepth());
  const repos = await mapLimit(repoPaths, DU_CONCURRENCY, async (repo) => {
    const artifactPaths = await findArtifacts(repo);
    // -I makes the repo walk skip artifact dirs, so node_modules is read once
    // (for its own size) instead of again for the repo total.
    const [sizes, rest] = await Promise.all([
      du(artifactPaths),
      du([repo], [...ARTIFACT_DIRS].flatMap((name) => ["-I", name])),
    ]);
    const measured = artifactPaths.map((p) => ({ path: p, name: path.relative(repo, p), sizeKb: sizes.get(p) ?? 0 }));
    const artifacts = measured.filter((a) => a.sizeKb >= MIN_LIST_KB).sort((a, b) => b.sizeKb - a.sizeKb);
    const sizeKb = (rest.get(repo) ?? 0) + measured.reduce((acc, a) => acc + a.sizeKb, 0);
    return { name: path.basename(repo), path: repo, sizeKb, artifacts };
  });
  repos.sort((a, b) => b.sizeKb - a.sizeKb);

  const home = os.homedir();
  const present = (
    await Promise.all(
      HOME_CACHES.map(async (c) => {
        const full = path.join(home, c.rel);
        const ok = await fs.stat(full).then((s) => s.isDirectory(), () => false);
        return ok ? { label: c.label, path: full } : null;
      }),
    )
  ).filter((c): c is { label: string; path: string } => c !== null);
  const cacheSizes = await du(present.map((c) => c.path));
  const caches = present
    .map((c) => ({ ...c, sizeKb: cacheSizes.get(c.path) ?? 0 }))
    .sort((a, b) => b.sizeKb - a.sizeKb);

  const reclaimableKb =
    repos.reduce((acc, r) => acc + r.artifacts.reduce((a, x) => a + x.sizeKb, 0), 0) +
    caches.reduce((acc, c) => acc + c.sizeKb, 0);
  return { root, repos, caches, reclaimableKb };
}

// A target is cleanable only if it is exactly a known home cache, or a
// directory under the dev root whose own name is an artifact name. The path
// must resolve without symlinks so a planted link cannot redirect the delete.
export function assertCleanable(target: string, root: string, home: string): void {
  if (!path.isAbsolute(target) || path.resolve(target) !== target)
    throw new HttpError(400, "Target must be a normalized absolute path.");
  const isCache = HOME_CACHES.some((c) => path.join(home, c.rel) === target);
  const inRoot = target.startsWith(root + path.sep) && target !== root;
  if (!isCache && !(inRoot && ARTIFACT_DIRS.has(path.basename(target))))
    throw new HttpError(403, "Only build artifacts under the dev root and known tool caches can be cleaned.");
}

export async function cleanTarget(target: string): Promise<{ freedKb: number }> {
  const [root, home] = await Promise.all([fs.realpath(devRoot()), fs.realpath(os.homedir())]);
  assertCleanable(target, root, home);
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isDirectory())
    throw new HttpError(409, "Target is not a directory or no longer exists. Refresh before cleaning.");
  if ((await fs.realpath(target)) !== target)
    throw new HttpError(403, "Symlinked targets are not eligible for cleaning.");
  const freedKb = (await du([target])).get(target) ?? 0;
  // ponytail: single rm; a multi-GB node_modules can take tens of seconds, move-to-Trash if that bites.
  await fs.rm(target, { recursive: true, force: true });
  diskCache.invalidate();
  return { freedKb };
}
