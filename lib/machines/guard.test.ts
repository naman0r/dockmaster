import { it, expect } from "vitest";
import { guard } from "@/lib/guard";
import { getToken } from "@/lib/token";
it("keeps token and origin guards and refuses remote actions", () => {
  const headers = { host: "localhost:36252", "x-dockmaster-token": getToken() };
  expect(
    guard(
      new Request("http://localhost:36252/api/ports?machine=homelab", {
        headers,
      }),
    ),
  ).toBeNull();
  for (const route of [
    "ports/stop",
    "processes/kill",
    "worktrees/remove",
    "hosts/apply",
  ]) {
    expect(
      guard(
        new Request(`http://localhost:36252/api/${route}?machine=homelab`, {
          method: "POST",
          headers,
        }),
      )?.status,
    ).toBe(403);
  }
  expect(
    guard(
      new Request("http://localhost:36252/api/ports", {
        headers: { ...headers, origin: "http://evil.test" },
      }),
    )?.status,
  ).toBe(403);
  expect(guard(new Request("http://localhost:36252/api/ports"))?.status).toBe(
    401,
  );
  expect(
    guard(
      new Request("http://localhost:36252/api/ports/stop", {
        method: "POST",
        headers,
      }),
    ),
  ).toBeNull();
});
