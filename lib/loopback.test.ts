import { describe, expect, it } from "vitest";
import { hostIsLoopback } from "./loopback";

describe("hostIsLoopback", () => {
  it("accepts loopback names on any port", () => {
    expect(hostIsLoopback("127.0.0.1:36252")).toBe(true);
    expect(hostIsLoopback("localhost:3000")).toBe(true);
    expect(hostIsLoopback("LOCALHOST")).toBe(true);
    expect(hostIsLoopback("[::1]:36252")).toBe(true);
  });

  it("rejects rebound and lookalike hosts", () => {
    expect(hostIsLoopback("evil.example:36252")).toBe(false);
    expect(hostIsLoopback("localhost.evil.example")).toBe(false);
    expect(hostIsLoopback("127.0.0.1.nip.io:36252")).toBe(false);
    expect(hostIsLoopback("[::1")).toBe(false);
    expect(hostIsLoopback("")).toBe(false);
  });
});
