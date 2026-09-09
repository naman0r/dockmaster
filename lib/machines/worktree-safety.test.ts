import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it, expect, vi } from "vitest";
import { canonicalRepo } from "@/lib/worktrees/scan";
it("rejects a repository path that escapes the root through a symlink", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dm-root-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "dm-outside-"));
  vi.stubEnv("DOCKMASTER_DEV_ROOT", root);
  try {
    await fs.symlink(outside, path.join(root, "escape"));
    await expect(canonicalRepo(path.join(root, "escape"))).rejects.toThrow(
      /outside/,
    );
  } finally {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
