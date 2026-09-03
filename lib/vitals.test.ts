import { describe, expect, it } from "vitest";
import {
  parseBoottime,
  parseLoadAvg,
  parseDf,
  parseMemoryPressure,
  parseBattery,
} from "./vitals";

describe("parseBoottime", () => {
  it("extracts the epoch seconds", () => {
    expect(parseBoottime("{ sec = 1788306999, usec = 848088 } Wed Sep  2 07:56:39 2026")).toBe(
      1788306999,
    );
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
    expect(parseDf(out)).toEqual({ freeKb: 100408844, totalKb: 482766932, usedPct: 16 });
  });

  it("returns null when the root row is missing", () => {
    expect(parseDf("Filesystem 1024-blocks\n")).toBeNull();
  });
});

describe("parseMemoryPressure", () => {
  it("extracts the free percentage", () => {
    expect(parseMemoryPressure("System-wide memory free percentage: 47%")).toBe(47);
  });
});

describe("parseBattery", () => {
  it("parses percent, source, and status", () => {
    const out =
      "Now drawing from 'AC Power'\n -InternalBattery-0 (id=22216803)\t74%; charging; 0:57 remaining present: true";
    expect(parseBattery(out)).toEqual({ pct: 74, source: "AC Power", status: "charging" });
  });

  it("returns null on desktops", () => {
    expect(parseBattery("No internal battery")).toBeNull();
  });
});
