import { it, expect, vi, afterEach } from "vitest";
import net from "node:net";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./backend", () => ({
  authorizeAction: async () => ({ connection: { request: mocks.request } }),
}));
vi.mock("./config", () => ({
  readMachines: async () => [
    {
      id: "remote",
      destination: "homelab",
      nodePath: "/node",
      companionPath: "/companion",
      scanRoot: "/dev",
    },
  ],
}));
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
