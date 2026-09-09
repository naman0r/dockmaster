import { it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  remote: vi.fn(),
  local: vi.fn(),
  enabled: vi.fn(),
  configs: vi.fn(),
}));
vi.mock("./config", () => ({ readMachines: mocks.configs }));
vi.mock("./collector", () => ({ collect: mocks.local }));
vi.mock("@/lib/settings", () => ({ moduleEnabled: mocks.enabled }));
vi.mock("./ssh", () => ({
  SshConnection: class {
    request = mocks.remote;
    close = vi.fn();
  },
}));
import { machineSnapshot, invalidateMachine } from "./backend";
beforeEach(() => {
  invalidateMachine("remote");
  invalidateMachine("other");
  vi.clearAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.configs.mockResolvedValue([{ id: "remote" }, { id: "other" }]);
});
it("isolates identical port numbers between machines and retains only that machine's snapshot", async () => {
  mocks.remote.mockResolvedValueOnce({
    cachedAt: "2026-09-09T00:00:00Z",
    data: { services: [{ port: 3000, pid: 42 }] },
  });
  const remote = await machineSnapshot("remote", "ports");
  mocks.local.mockResolvedValue({
    cachedAt: "2026-09-09T00:00:00Z",
    data: { services: [{ port: 3000, pid: 99 }] },
  });
  const local = await machineSnapshot("local", "ports");
  expect(remote.machineId).toBe("remote");
  expect(local.data).not.toEqual(remote.data);
  mocks.remote.mockRejectedValue(new Error("SSH unreachable"));
  const stale = await machineSnapshot("remote", "ports");
  expect(stale.state).toBe("stale");
  expect(stale.data).toEqual(remote.data);
  expect((await machineSnapshot("other", "ports")).data).toBeNull();
  expect((await machineSnapshot("local", "ports")).state).toBe("ready");
});
it("coalesces concurrent reads without delaying local requests", async () => {
  let finish!: (r: unknown) => void;
  mocks.remote.mockReturnValue(new Promise((r) => (finish = r)));
  const a = machineSnapshot("remote", "ports"),
    b = machineSnapshot("remote", "ports");
  mocks.local.mockResolvedValue({
    cachedAt: new Date().toISOString(),
    data: { services: [] },
  });
  expect((await machineSnapshot("local", "ports")).state).toBe("ready");
  finish({ cachedAt: new Date().toISOString(), data: { services: [] } });
  await Promise.all([a, b]);
  expect(mocks.remote).toHaveBeenCalledTimes(1);
});
it("does not connect or scan a disabled module", async () => {
  mocks.enabled.mockResolvedValue(false);
  expect((await machineSnapshot("remote", "ports")).state).toBe("disabled");
  expect(mocks.remote).not.toHaveBeenCalled();
});
it("rejects unknown machine IDs instead of falling back to local", async () => {
  await expect(machineSnapshot("missing", "ports")).rejects.toThrow(
    /Unknown machine/,
  );
  expect(mocks.local).not.toHaveBeenCalled();
});
