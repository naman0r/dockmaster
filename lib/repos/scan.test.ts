import { describe, expect, it } from "vitest";
import { parseStatusHeader, countDirty, parseBranchDates } from "./scan";

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
