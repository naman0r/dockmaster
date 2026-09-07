import { exec } from "@/lib/exec";
import { githubRepositoryUrl } from "@/lib/git-links";

export async function readGithubUrl(repoPath: string): Promise<string | null> {
  const remote = await exec(["git", "-C", repoPath, "config", "--get", "remote.origin.url"], {
    timeoutMs: 2000, okReturnCodes: [0, 1],
  }).catch(() => "");
  return githubRepositoryUrl(remote);
}
