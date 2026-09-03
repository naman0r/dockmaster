import { describe, expect, it } from "vitest";
import { parseCputime, parseSample, toRows } from "./processes";

describe("parseCputime", () => {
  it("parses MM:SS.cc", () => {
    expect(parseCputime("05:30.25")).toBeCloseTo(330.25);
  });

  it("parses HH:MM:SS.cc", () => {
    expect(parseCputime("1:02:03.5")).toBeCloseTo(3723.5);
  });

  it("rejects garbage", () => {
    expect(Number.isNaN(parseCputime("abc"))).toBe(true);
    expect(Number.isNaN(parseCputime("1:2:3:4"))).toBe(true);
  });
});

describe("parseSample", () => {
  it("parses ps column output", () => {
    const sample = parseSample("  42  501  3:20.00  51200 /usr/bin/node\n");
    expect(sample.get(42)).toMatchObject({
      uid: 501,
      cputimeSec: 200,
      rssKb: 51200,
      command: "/usr/bin/node",
    });
  });
});

describe("toRows", () => {
  const users = new Map([[501, "naman"]]);

  it("computes instantaneous cpu and merges cpu/mem tops", () => {
    const first = parseSample("1 501 0:00.00 1000 /a\n2 501 0:00.00 90000 /b\n");
    const second = parseSample("1 501 0:00.50 1000 /a\n2 501 0:00.00 91000 /b\n");
    const rows = toRows(first, second, 1000, users);
    const a = rows.find((r) => r.pid === 1)!;
    const b = rows.find((r) => r.pid === 2)!;
    expect(a.cpuPct).toBeCloseTo(50);
    expect(b.cpuPct).toBeCloseTo(0);
    expect(b.rssKb).toBe(91000);
    expect(a.user).toBe("naman");
  });

  it("clamps negative deltas to zero", () => {
    const first = parseSample("1 501 0:10.00 1000 /a\n");
    const second = parseSample("1 501 0:09.00 1000 /a\n");
    expect(toRows(first, second, 1000, users)[0].cpuPct).toBe(0);
  });
});
