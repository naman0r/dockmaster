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
  const digest = "a".repeat(64);

  it("stages into a root-owned temp file and verifies its digest before installing", () => {
    const script = buildElevationScript("/tmp/hosts.tmp", digest);
    const steps = script.split("; ");
    const copy = steps.findIndex((s) => s.includes("/bin/cat '/tmp/hosts.tmp' > \"$t\""));
    const verify = steps.findIndex((s) => s.includes(`shasum -a 256 < "$t"`) && s.includes(`'${digest}'`));
    const install = steps.findIndex((s) => s.includes('/bin/mv -f "$t" /etc/hosts'));
    expect(steps[0]).toBe("set -e");
    expect(steps[1]).toContain("mktemp /etc/hosts.dockmaster.");
    expect(copy).toBeGreaterThan(1);
    expect(verify).toBeGreaterThan(copy);
    expect(install).toBeGreaterThan(verify);
    expect(script).not.toContain("cat '/tmp/hosts.tmp' > /etc/hosts");
  });

  it("restores world-readable permissions and flushes DNS after installing", () => {
    const script = buildElevationScript("/tmp/hosts.tmp", digest);
    expect(script).toContain('/bin/chmod 644 "$t"');
    expect(script).toContain("dscacheutil -flushcache");
    expect(script).toContain("killall -HUP mDNSResponder");
  });

  it("quotes the digest and path as shell literals", () => {
    const script = buildElevationScript("/tmp/it's here.tmp", digest);
    expect(script).toContain("'/tmp/it'\\''s here.tmp'");
  });
});
