import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  kill: vi.fn(),
  stop: vi.fn(),
  canonical: vi.fn(),
  revision: vi.fn(),
  remove: vi.fn(),
  prune: vi.fn(),
  branch: vi.fn(),
}));
vi.mock("@/lib/exec", () => ({ exec: mocks.exec }));
vi.mock("@/lib/processes/kill", () => ({ killByPid: mocks.kill }));
vi.mock("@/lib/ports/stop", () => ({ stopService: mocks.stop }));
vi.mock("@/lib/worktrees/scan", () => ({
  canonicalRepo: mocks.canonical,
  worktreeRevision: mocks.revision,
  removeWorktree: mocks.remove,
  pruneWorktrees: mocks.prune,
  deleteBranch: mocks.branch,
}));
import { executeAction } from "./actions";
beforeEach(() => {
  vi.clearAllMocks();
});
it("refuses a recycled process identity before signaling", async () => {
  mocks.exec.mockResolvedValue("42 1 501 Wed Sep 9 10:00:00 2026 user node");
  await expect(
    executeAction({
      action: "processes.kill",
      pid: 42,
      startedAt: "old",
      mode: "term",
    }),
  ).rejects.toThrow(/identity changed/);
  expect(mocks.kill).not.toHaveBeenCalled();
});
it("delegates remote port stopping with fresh tree identity validation", async () => {
  mocks.stop.mockResolvedValue({ stillListening: false });
  const a = {
    action: "ports.stop" as const,
    pid: 42,
    port: 3000,
    startedAt: "stamp",
    mode: "term" as const,
  };
  await executeAction(a);
  expect(mocks.stop).toHaveBeenCalledWith(a, true);
});
it("refuses changed Git metadata before pruning", async () => {
  mocks.canonical.mockResolvedValue("/dev/repo");
  mocks.revision.mockResolvedValue("b".repeat(64));
  await expect(
    executeAction({
      action: "worktrees.prune",
      repoPath: "/dev/repo",
      revision: "a".repeat(64),
    }),
  ).rejects.toThrow(/state changed/);
  expect(mocks.prune).not.toHaveBeenCalled();
});
it("rejects unrecognized action fields instead of allowing arbitrary commands", async () => {
  await expect(
    executeAction({
      action: "processes.kill",
      pid: 42,
      startedAt: "x",
      mode: "term",
      command: "anything",
    } as never),
  ).rejects.toThrow();
  expect(mocks.exec).not.toHaveBeenCalled();
});
