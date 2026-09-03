// `next dev` and `next start` choose their port before they read .env, so a
// PORT= line there never takes effect. This launcher loads .env first and
// hands Next the port explicitly; the LaunchAgent installer routes through
// it too, so every way of starting Dockmaster agrees on the port.

import { createRequire } from "module";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const DEFAULT_PORT = 36252;

export const repoRoot = path.resolve(import.meta.dirname, "..");

// Values already in the shell environment win over the file, so
// DOCKMASTER_PORT=1234 npm run dev still works for a one-off.
export function loadEnv() {
  try {
    process.loadEnvFile(path.join(repoRoot, ".env"));
  } catch {
    // No .env is fine; every setting has a default.
  }
}

export function dockmasterPort() {
  const parsed = Number(process.env.DOCKMASTER_PORT);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : DEFAULT_PORT;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode !== "dev" && mode !== "start") {
    console.error("Usage: node scripts/serve.mjs dev|start");
    process.exit(1);
  }
  loadEnv();
  const bin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  // Run Next's CLI in this process rather than spawning it: one fewer resident
  // node process for something that runs all day.
  process.argv = [process.argv[0], bin, mode, "-H", "127.0.0.1", "-p", String(dockmasterPort())];
  process.chdir(repoRoot);
  await import(pathToFileURL(bin).href);
}
