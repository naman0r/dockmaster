// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { usePoll } from "@/components/hooks";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  pathname: "/ports",
}));
vi.mock("@/lib/client/api", () => ({
  apiGet: mocks.get,
  apiRequest: (url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? mocks.post(url, JSON.parse(String(init.body)), init)
      : mocks.get(url),
  apiPost: mocks.post,
  apiDelete: mocks.del,
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/components/remote-harbor", () => ({ RemoteHarbor: () => null }));
import ProcessesPage from "@/app/processes/page";
import PortsPage from "@/app/ports/page";
import {
  MachineProvider,
  MachineBoundary,
  MachineSelector,
  useMachine,
} from "@/components/machines";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  sessionStorage.clear();
  mocks.pathname = "/ports";
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("discards a previous machine's late response after selection changes", async () => {
  let localFinish!: (s: string) => void;
  const late = new Promise<string>((r) => (localFinish = r));
  mocks.get.mockResolvedValue({
    machines: [
      { id: "local", name: "This Mac" },
      { id: "remote", name: "Homelab" },
    ],
  });
  function View() {
    const { machine } = useMachine();
    const [value, setValue] = useState("loading");
    usePoll(async () => {
      setValue(
        await (machine.id === "local" ? late : Promise.resolve("remote ports")),
      );
    }, 2500);
    return React.createElement("p", null, value);
  }
  await act(async () =>
    root.render(
      React.createElement(
        MachineProvider,
        null,
        React.createElement(MachineSelector),
        React.createElement(MachineBoundary, null, React.createElement(View)),
      ),
    ),
  );
  const select = host.querySelector("select")!;
  await act(async () => {
    select.value = "remote";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.textContent).toContain("remote ports");
  await act(async () => localFinish("local ports"));
  expect(host.textContent).toContain("remote ports");
  expect(host.textContent).not.toContain("local ports");
});
it("pauses hidden scans and coalesces slow polls, then stops on unmount", async () => {
  vi.useFakeTimers();
  const scan = vi.fn(async () => {});
  function View() {
    usePoll(scan, 1000);
    return null;
  }
  await act(async () => root.render(React.createElement(View)));
  expect(scan).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: true,
  });
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(scan).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(scan).toHaveBeenCalledTimes(2);
  let finish!: () => void;
  scan.mockImplementation(() => new Promise<void>((r) => (finish = r)));
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(scan).toHaveBeenCalledTimes(3);
  await act(async () => {
    finish();
    root.render(null);
  });
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(scan).toHaveBeenCalledTimes(3);
});
it("does not mount local-only modules under a remote selection", async () => {
  sessionStorage.setItem("dockmaster-machine", "remote");
  mocks.pathname = "/logbook";
  mocks.get.mockResolvedValue({
    machines: [
      { id: "local", name: "This Mac" },
      { id: "remote", name: "Homelab" },
    ],
  });
  const mounted = vi.fn();
  function Local() {
    mounted();
    return null;
  }
  await act(async () =>
    root.render(
      React.createElement(
        MachineProvider,
        null,
        React.createElement(MachineBoundary, null, React.createElement(Local)),
      ),
    ),
  );
  expect(mounted).not.toHaveBeenCalled();
  expect(host.textContent).toContain("local-only");
});

it("renders remote listeners without misleading localhost links or unguarded actions", async () => {
  sessionStorage.setItem("dockmaster-machine", "remote");
  const service = {
    pid: 42,
    ppid: 1,
    port: 3000,
    addresses: ["127.0.0.1"],
    kind: "Node",
    project: "Remote project",
    cwd: "/dev/project",
    argv: "",
    user: "naman",
    startedAt: new Date().toISOString(),
    isSystem: false,
    isStoppable: false,
    isExposed: false,
    note: "",
  };
  mocks.get.mockImplementation(async (url: string) =>
    url.startsWith("/api/tunnels")
      ? { tunnels: [] }
      : url === "/api/machines"
        ? {
            machines: [
              { id: "local", name: "This Mac" },
              { id: "remote", name: "Homelab" },
            ],
          }
        : {
            machineId: "remote",
            enabled: true,
            state: "ready",
            cachedAt: new Date().toISOString(),
            data: { services: [service] },
          },
  );
  await act(async () =>
    root.render(
      React.createElement(
        MachineProvider,
        null,
        React.createElement(
          MachineBoundary,
          null,
          React.createElement(PortsPage),
        ),
      ),
    ),
  );
  expect(host.textContent).toContain("Remote project");
  expect(host.querySelector('a[href^="http://localhost"]')).toBeNull();
  expect(
    [...host.querySelectorAll("button")].some((b) => b.textContent === "Stop"),
  ).toBe(false);
  expect(host.textContent).toContain("Protected");
});

it("keeps Notepad shared and available while a remote machine is selected", async () => {
  sessionStorage.setItem("dockmaster-machine", "remote");
  mocks.pathname = "/notepad";
  mocks.get.mockResolvedValue({
    machines: [
      { id: "local", name: "This Mac" },
      { id: "remote", name: "Homelab" },
    ],
  });
  await act(async () =>
    root.render(
      React.createElement(
        MachineProvider,
        null,
        React.createElement(
          MachineBoundary,
          null,
          React.createElement("p", null, "Shared note"),
        ),
      ),
    ),
  );
  expect(host.textContent).toContain("Shared note");
  expect(host.textContent).toContain("stored on this Mac");
  expect(host.textContent).not.toContain("local-only");
});
it("sends the displayed process identity and current lease to the selected machine", async () => {
  sessionStorage.setItem("dockmaster-machine", "remote");
  mocks.pathname = "/processes";
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  mocks.get.mockImplementation(async (url: string) =>
    url === "/api/machines"
      ? {
          machines: [
            { id: "local", name: "This Mac" },
            { id: "remote", name: "Homelab" },
          ],
        }
      : {
          machineId: "remote",
          enabled: true,
          state: "ready",
          lease: "grant",
          cachedAt: new Date().toISOString(),
          data: {
            sample: [
              {
                pid: 42,
                uid: 501,
                user: "test",
                command: "node",
                cpuPct: 0,
                rssKb: 123,
                startedAt: "identity",
                isStoppable: true,
              },
            ],
            currentUid: 501,
            sampledAt: new Date().toISOString(),
            intervalMs: 1000,
          },
        },
  );
  mocks.post.mockResolvedValue({ stillAlive: false });
  await act(async () =>
    root.render(
      React.createElement(
        MachineProvider,
        null,
        React.createElement(
          MachineBoundary,
          null,
          React.createElement(ProcessesPage),
        ),
      ),
    ),
  );
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Stop",
  )!;
  await act(async () => button.click());
  expect(mocks.post).toHaveBeenCalledWith(
    "/api/processes/kill?machine=remote",
    { pid: 42, mode: "term", startedAt: "identity" },
    expect.objectContaining({ headers: { "X-Dockmaster-Lease": "grant" } }),
  );
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Homelab"));
  confirm.mockRestore();
});
