import { it, expect, vi, afterEach, beforeEach } from "vitest";
import net from "node:net";
const mocks = vi.hoisted(() => {
  const connection = {
    request: vi.fn(),
    currentSession: "session",
    machine: { id: "remote", name: "Homelab", destination: "homelab", nodePath: "/node", companionPath: "/companion", scanRoot: "/dev" },
  };
  return { connection, request: connection.request, authorize: vi.fn() };
});
vi.mock("./backend", () => ({ authorizeAction: mocks.authorize }));
vi.mock("./config", () => ({ readMachines: async () => [mocks.connection.machine] }));
beforeEach(() => {
  mocks.connection.currentSession = "session";
  mocks.authorize.mockReset().mockResolvedValue({ connection: mocks.connection, grant: { session: "session" } });
});
import {
  openTunnel,
  closeMachineTunnels,
  listTunnels,
  targetAddress,
} from "./tunnels";
const service = {
  pid: 42,
  port: 3000,
  startedAt: "stamp",
  addresses: ["127.0.0.1"],
};
afterEach(() => {
  closeMachineTunnels("remote");
});
it("allocates an available loopback port, reuses mappings, and cleans them up", async () => {
  const occupied = net.createServer();
  await new Promise<void>((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(0, "127.0.0.1", resolve);
  });
  const port = (occupied.address() as net.AddressInfo).port;
  try {
    mocks.request.mockResolvedValue({
      data: { services: [{ ...service, port }] },
    });
    const a = await openTunnel("remote", "lease", { ...service, port });
    const b = await openTunnel("remote", "lease", { ...service, port });
    expect(a.localPort).not.toBe(port);
    expect(a.id).toBe(b.id);
    expect(a.url).toContain("127.0.0.1");
    expect(listTunnels("other")).toEqual([]);
    closeMachineTunnels("remote");
    expect(listTunnels("remote")).toEqual([]);
  } finally {
    occupied.close();
  }
});
it("refuses changed listener identity", async () => {
  mocks.request.mockResolvedValue({ data: { services: [] } });
  await expect(openTunnel("remote", "lease", service)).rejects.toThrow(
    /identity changed/,
  );
});
it("validates forwarding destinations instead of accepting SSH syntax", () => {
  expect(targetAddress({ ...service, addresses: ["::1"] } as never)).toBe(
    "[::1]",
  );
  expect(() =>
    targetAddress({
      ...service,
      addresses: ["host:22 -oProxyCommand=bad"],
    } as never),
  ).toThrow(/Unsupported/);
});

it("rejects a configuration change while validating the remote listener", async () => {
  mocks.request.mockImplementationOnce(async () => {
    mocks.connection.currentSession = "";
    closeMachineTunnels("remote");
    return { data: { services: [service] } };
  });
  await expect(openTunnel("remote", "lease", service)).rejects.toThrow(/connection changed/);
  expect(listTunnels("remote")).toEqual([]);
});
it("closes a newly bound listener if configuration changes during setup", async () => {
  mocks.request.mockResolvedValue({ data: { services: [service] } });
  mocks.authorize.mockResolvedValueOnce({ connection: mocks.connection, grant: { session: "session" } });
  mocks.authorize.mockResolvedValue({ connection: { ...mocks.connection, machine: { ...mocks.connection.machine, destination: "other-host" } }, grant: { session: "session" } });
  await expect(openTunnel("remote", "lease", service)).rejects.toThrow(/connection changed/);
  expect(listTunnels("remote")).toEqual([]);
});
