import { describe, expect, it } from "vitest";
import { parseHosts, assertSaneHostsContent, shellQuote, buildElevationScript } from "./hosts";

describe("parseHosts", () => {
  it("parses enabled entries with trailing comments", () => {
    const entries = parseHosts("127.0.0.1 localhost # the loopback\n");
    expect(entries[0]).toMatchObject({
      ip: "127.0.0.1",
      hostnames: ["localhost"],
      comment: "# the loopback",
      enabled: true,
    });
  });

  it("marks fully commented lines as disabled", () => {
    const entries = parseHosts("# 10.0.0.5 old-box\n");
    expect(entries[0].enabled).toBe(false);
    expect(entries[0].comment).toBe("# 10.0.0.5 old-box");
  });

  it("parses multiple hostnames", () => {
    const entries = parseHosts("::1 localhost ip6-localhost\n");
    expect(entries[0].hostnames).toEqual(["localhost", "ip6-localhost"]);
  });

  it("returns nothing for empty input", () => {
    expect(parseHosts("\n\n")).toEqual([]);
  });
});

describe("assertSaneHostsContent", () => {
  it("accepts a standard hosts file", () => {
    expect(() =>
      assertSaneHostsContent("127.0.0.1 localhost\n255.255.255.255 broadcasthost\n"),
    ).not.toThrow();
  });

  it("rejects content without the localhost mapping", () => {
    expect(() => assertSaneHostsContent("10.0.0.1 something\n")).toThrow(/127.0.0.1/);
  });
});

describe("shellQuote", () => {
  it("escapes single quotes", () => {
    expect(shellQuote("/tmp/it's a file")).toBe("'/tmp/it'\\''s a file'");
  });
});

describe("buildElevationScript", () => {
  it("writes, flushes, and signals mDNSResponder", () => {
    const script = buildElevationScript("/tmp/hosts.tmp");
    expect(script).toContain("cat '/tmp/hosts.tmp' > /etc/hosts");
    expect(script).toContain("dscacheutil -flushcache");
    expect(script).toContain("killall -HUP mDNSResponder");
  });
});
