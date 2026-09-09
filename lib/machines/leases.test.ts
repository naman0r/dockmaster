import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  mutate: vi.fn(),
  session: "11111111-1111-1111-1111-111111111111",
}));
vi.mock("./config", () => ({ readMachines: async () => [{ id: "remote" }] }));
vi.mock("@/lib/settings", () => ({ moduleEnabled: async () => true }));
vi.mock("./collector", () => ({ collect: vi.fn() }));
vi.mock("./ssh", () => ({
  SshConnection: class {
    get currentSession() {
      return mocks.session;
    }
    request = mocks.request;
    mutate = mocks.mutate;
    close = vi.fn();
  },
}));
import { machineSnapshot, machineAction, invalidateMachine } from "./backend";
const action = {
  action: "processes.kill" as const,
  pid: 42,
  startedAt: "stamp",
  mode: "term" as const,
};
beforeEach(() => {
  invalidateMachine("remote");
  vi.clearAllMocks();
  mocks.session = "11111111-1111-1111-1111-111111111111";
  mocks.request.mockResolvedValue({
    cachedAt: new Date().toISOString(),
    data: { sample: [] },
  });
});
it("rejects remote actions without a current snapshot", async () => {
  await expect(machineAction("remote", action, "anything")).rejects.toThrow(
    /stale or disconnected/,
  );
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("does not replay a mutation after an ambiguous failure", async () => {
  const snap = await machineSnapshot("remote", "processes");
  mocks.mutate.mockRejectedValue(new Error("closed"));
  await expect(machineAction("remote", action, snap.lease!)).rejects.toThrow(
    /outcome is unknown/,
  );
  await expect(machineAction("remote", action, snap.lease!)).rejects.toThrow(
    /stale or disconnected/,
  );
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
});
it("invalidates mutation authority when the companion session changes", async () => {
  const snap = await machineSnapshot("remote", "processes");
  mocks.session = "22222222-2222-2222-2222-222222222222";
  await expect(machineAction("remote", action, snap.lease!)).rejects.toThrow(
    /stale or disconnected/,
  );
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("a Ports snapshot cannot authorize a Processes action", async () => {
  const snap = await machineSnapshot("remote", "ports");
  await expect(machineAction("remote", action, snap.lease!)).rejects.toThrow(
    /stale or disconnected/,
  );
});
