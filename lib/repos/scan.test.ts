import { describe, expect, it } from "vitest";
import { parseStatusHeader, countDirty, parseBranchDates, parseToolVersions, nodeMajor } from "./scan";

describe("parseStatusHeader", () => {
  it("parses branch with upstream and ahead/behind", () => {
    expect(parseStatusHeader("## main...origin/main [ahead 1, behind 2]")).toEqual({
      branch: "main",
      ahead: 1,
      behind: 2,
      hasUpstream: true,
    });
  });

  it("parses detached HEAD", () => {
    expect(parseStatusHeader("## HEAD (no branch)")).toEqual({
      branch: "(detached)",
      ahead: 0,
      behind: 0,
      hasUpstream: false,
    });
  });

  it("parses a branch with no upstream", () => {
    const parsed = parseStatusHeader("## feature/x");
    expect(parsed.branch).toBe("feature/x");
    expect(parsed.hasUpstream).toBe(false);
  });
});

describe("countDirty", () => {
  it("counts every non-header line including untracked", () => {
    const output = [
      "## main...origin/main",
      " M a.txt",
      "?? new.txt",
      "A  b.txt",
      "",
    ].join("\n");
    expect(countDirty(output)).toBe(3);
  });

  it("counts zero for a clean repo", () => {
    expect(countDirty("## main\n")).toBe(0);
  });
});

describe("parseBranchDates", () => {
  it("parses tab-separated name/date pairs", () => {
    expect(parseBranchDates("main\t1700000000\nold\t1000000000\n")).toEqual([
      { name: "main", date: 1700000000 },
      { name: "old", date: 1000000000 },
    ]);
  });

  it("skips malformed lines", () => {
    expect(parseBranchDates("main\nbroken\tabc\nold\t1\n")).toEqual([{ name: "old", date: 1 }]);
  });
});

describe("node pins", () => {
  it("reads the node line from .tool-versions", () => {
    expect(parseToolVersions("python 3.12\nnodejs 20.12.0\n")).toBe("20.12.0");
    expect(parseToolVersions("node 22\n")).toBe("22");
    expect(parseToolVersions("ruby 3.3\n")).toBe("");
  });
  it("compares by leading major only", () => {
    expect(nodeMajor("v20.12.0")).toBe(20);
    expect(nodeMajor(">=18 <21")).toBe(18);
    expect(nodeMajor("lts/iron")).toBeNull();
  });
});
