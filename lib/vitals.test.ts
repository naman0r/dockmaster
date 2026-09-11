import { describe, expect, it } from "vitest";
import {
  parseBoottime,
  parseLoadAvg,
  parseDf,
  parseMemory,
  parseBattery,
} from "./vitals";

describe("parseBoottime", () => {
  it("extracts the epoch seconds", () => {
    expect(
      parseBoottime(
        "{ sec = 1788306999, usec = 848088 } Wed Sep  2 07:56:39 2026",
      ),
    ).toBe(1788306999);
  });

  it("returns null on garbage", () => {
    expect(parseBoottime("nope")).toBeNull();
  });
});

describe("parseLoadAvg", () => {
  it("parses the three averages", () => {
    expect(parseLoadAvg("{ 4.30 4.43 4.65 }")).toEqual([4.3, 4.43, 4.65]);
  });

  it("returns null without three numbers", () => {
    expect(parseLoadAvg("{ 1.00 }")).toBeNull();
  });
});

describe("parseDf", () => {
  it("parses the root volume row", () => {
    const out = [
      "Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on",
      "/dev/disk3s1s1   482766932  18748400 100408844    16%  458732 1004088440    0%   /",
    ].join("\n");
    expect(parseDf(out)).toEqual({
      freeKb: 100408844,
      totalKb: 482766932,
      usedPct: 16,
    });
  });

  it("returns null when the root row is missing", () => {
    expect(parseDf("Filesystem 1024-blocks\n")).toBeNull();
  });
});

describe("parseMemory", () => {
  it("excludes reclaimable cache and honors the reported page size", () => {
    for (const size of [4096, 16384]) {
      const output = `Mach Virtual Memory Statistics: (page size of ${size} bytes)
Pages free: 10.
File-backed pages: 40.
Pages purgeable: 5.
Pages occupied by compressor: 20.`;
      expect(parseMemory(output, 100 * size)).toEqual({
        memUsedBytes: 45 * size,
        memCachedBytes: 45 * size,
        memFreePct: 10,
      });
      expect(parseMemory(output, 20 * size)).toBeNull();
    }
  });
  it("reports unavailable for incomplete or malformed counters", () => {
    expect(parseMemory("", 64 * 1024 ** 3)).toBeNull();
    expect(parseMemory("page size of 16384 bytes\nPages free: 1.", 100000)).toBeNull();
  });
});

describe("parseBattery", () => {
  it("parses percent, source, and status", () => {
    const out =
      "Now drawing from 'AC Power'\n -InternalBattery-0 (id=22216803)\t74%; charging; 0:57 remaining present: true";
    expect(parseBattery(out)).toEqual({
      pct: 74,
      source: "AC Power",
      status: "charging",
    });
  });

  it("returns null on desktops", () => {
    expect(parseBattery("No internal battery")).toBeNull();
  });
});

it("computes CPU utilization from elapsed idle and total ticks", async () => {
  const { cpuUsage } = await import("./vitals");
  const before = [
    {
      model: "test",
      speed: 1,
      times: { user: 100, nice: 0, sys: 100, idle: 800, irq: 0 },
    },
  ];
  const after = [
    {
      model: "test",
      speed: 1,
      times: { user: 130, nice: 0, sys: 120, idle: 850, irq: 0 },
    },
  ];
  expect(cpuUsage(before, after)).toBe(50);
  expect(cpuUsage(before, before)).toBeNull();
});
