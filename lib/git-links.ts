// Only recognized GitHub remotes become links; never expose embedded credentials.
export function githubRepositoryUrl(remote: string): string | null {
  const value = remote.trim();
  const scp = value.match(/^git@github\.com:([^\s]+)$/i);
  let pathname = scp?.[1];
  if (!pathname) {
    try {
      const url = new URL(value);
      if (url.hostname.toLowerCase() !== "github.com" || !["https:", "ssh:"].includes(url.protocol) || url.port || url.search || url.hash) return null;
      pathname = url.pathname.replace(/^\//, "");
    } catch { return null; }
  }
  const parts = pathname.replace(/\/$/, "").replace(/\.git$/, "").split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[\w.-]+$/.test(part) || part === "." || part === "..")) return null;
  return `https://github.com/${parts.join("/")}`;
}

export function branchPullRequestsUrl(repositoryUrl: string | null | undefined, branch: string): string | null {
  const repository = repositoryUrl ? githubRepositoryUrl(repositoryUrl) : null;
  if (!repository || !branch || branch.startsWith("(")) return null;
  // Quote the qualifier value so branch punctuation cannot become search syntax.
  return `${repository}/pulls?q=${encodeURIComponent(`is:pr head:${JSON.stringify(branch)}`)}`;
}
