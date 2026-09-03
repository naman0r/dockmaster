import { describe, expect, it } from "vitest";
import {
  parseWorktreeList,
  guardRemoveWorktree,
  guardDeleteBranch,
} from "./scan";

describe("parseWorktreeList", () => {
  it("parses porcelain blocks", () => {
    const output = [
      "worktree /Users/x/main",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /Users/x/feature",
      "HEAD def456",
      "branch refs/heads/feature",
      "",
    ].join("\n");
    const entries = parseWorktreeList(output);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      path: "/Users/x/main",
      branch: "main",
      isMain: true,
      isPrunable: false,
    });
    expect(entries[1]).toMatchObject({
      path: "/Users/x/feature",
      branch: "feature",
      isMain: false,
    });
  });

  it("records prunable reason", () => {
    const output = [
      "worktree /Users/x/gone",
      "HEAD abc123",
      "branch refs/heads/gone",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");
    const entries = parseWorktreeList(output);
    expect(entries[0].isPrunable).toBe(true);
    expect(entries[0].reason).toContain("non-existent");
  });
});

describe("guardRemoveWorktree", () => {
  const root = "/Users/x";

  it("rejects a path outside the dev root", () => {
    expect(() =>
      guardRemoveWorktree("/etc", ["/Users/x/main"], "/Users/x/main", root),
    ).toThrow(/outside/);
  });

  it("rejects an unlisted path", () => {
    expect(() =>
      guardRemoveWorktree("/Users/x/other", ["/Users/x/main"], "/Users/x/main", root),
    ).toThrow(/not a registered worktree/);
  });

  it("rejects the main worktree", () => {
    expect(() =>
      guardRemoveWorktree(
        "/Users/x/main",
        ["/Users/x/main", "/Users/x/feature"],
        "/Users/x/main",
        root,
      ),
    ).toThrow(/main worktree/);
  });

  it("accepts a valid linked worktree", () => {
    expect(() =>
      guardRemoveWorktree(
        "/Users/x/feature",
        ["/Users/x/main", "/Users/x/feature"],
        "/Users/x/main",
        root,
      ),
    ).not.toThrow();
  });
});

describe("guardDeleteBranch", () => {
  it("rejects the current branch", () => {
    expect(() => guardDeleteBranch("main", "main", "main")).toThrow(/checked-out/);
  });

  it("rejects the default branch even when not checked out", () => {
    expect(() => guardDeleteBranch("main", "feature", "main")).toThrow(/default branch/);
  });

  it("rejects malformed names", () => {
    expect(() => guardDeleteBranch("-D evil", "main", "main")).toThrow(/Invalid branch/);
  });

  it("accepts a normal stale branch", () => {
    expect(() => guardDeleteBranch("old-experiment", "main", "main")).not.toThrow();
  });
});
