import { describe, it, expect } from "vitest";
import { Lines, MAX_MESSAGE, validRequest, validateResult } from "./protocol";
import { validateMachine } from "./config";
import { sshArgs } from "./ssh";
export const machine = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Homelab",
  destination: "namanrusia@m1max-homelab.tailaaa918.ts.net",
  nodePath: "/node",
  companionPath: "/companion.cjs",
  scanRoot: "/dev",
};
describe("companion protocol", () => {
  it("allows only versioned read operations", () => {
    expect(validRequest({ v: 2, id: "a", op: "ports" })).toBe(true);
    for (const op of ["exec", "kill", "__proto__", null])
      expect(validRequest({ v: 2, id: "a", op })).toBe(false);
    expect(validRequest({ v: 3, id: "a", op: "ports" })).toBe(false);
  });
  it("rejects invalid nested payloads", () => {
    const r = {
      cachedAt: new Date().toISOString(),
      data: { services: [{ pid: 1, port: 3000 }] },
    };
    expect(validateResult("ports", r)).toBe(false);
    expect(
      validateResult("vitals", {
        cachedAt: r.cachedAt,
        data: { uptimeSeconds: 1, cores: 8, loadAvg: [1, 2, "bad"] },
      }),
    ).toBe(false);
    expect(
      validateResult("ports", { cachedAt: r.cachedAt, data: { services: [] } }),
    ).toBe(true);
  });
  it("bounds frames and preserves fragmented unicode", () => {
    const l = new Lines();
    const received: string[] = [];
    const b = Buffer.from('"é"\n{}\n');
    l.push(b.subarray(0, 2), (s) => received.push(s));
    l.push(b.subarray(2), (s) => received.push(s));
    expect(received).toEqual(['"é"', "{}"]);
    expect(() => l.push(Buffer.alloc(MAX_MESSAGE + 1), () => {})).toThrow(
      /large/,
    );
  });
  it("rejects option injection and quotes remote shell paths", () => {
    for (const destination of [
      "-oProxyCommand=evil",
      "host;evil",
      "user@host\nfoo",
    ])
      expect(() => validateMachine({ ...machine, destination })).toThrow();
    const args = sshArgs({ ...machine, companionPath: "/a b/'$(touch nope)" });
    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(args.at(-1)).toContain("'/a b/'\\''$(touch nope)'");
  });
});
