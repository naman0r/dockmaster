import { describe, expect, it } from "vitest";
import { branchPullRequestsUrl, githubRepositoryUrl } from "./git-links";

describe("GitHub remote links", () => {
  it.each([
    "git@github.com:owner/project.git", "https://github.com/owner/project.git",
    "ssh://git@github.com/owner/project.git", "https://github.com/owner/project/",
    "https://username:password@github.com/owner/project.git",
  ])("normalizes %s without returning credentials", (remote) => {
    expect(githubRepositoryUrl(remote)).toBe("https://github.com/owner/project");
  });
  it.each(["", "/local/repo", "git@gitlab.com:owner/repo.git", "https://github.com.evil.test/owner/repo", "javascript:alert(1)", "https://github.com/owner/repo/extra", "https://github.com/owner/repo?token=secret", "https://github.com/owner/%2e%2e"])("rejects unsupported or unsafe remotes: %s", (remote) => {
    expect(githubRepositoryUrl(remote)).toBeNull();
  });
  it("encodes branch qualifiers and includes PRs in every state", () => {
    const url = new URL(branchPullRequestsUrl("https://github.com/owner/repo", 'feature/a&b#123')!);
    expect(url.pathname).toBe("/owner/repo/pulls");
    expect(url.searchParams.get("q")).toBe('is:pr head:"feature/a&b#123"');
  });
  it("omits links when GitHub origin or a branch is unavailable", () => {
    expect(branchPullRequestsUrl(null, "main")).toBeNull();
    expect(branchPullRequestsUrl("https://github.com/owner/repo", "(detached)")).toBeNull();
  });
});
