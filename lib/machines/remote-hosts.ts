import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { exec } from "@/lib/exec";
import {
  assertSaneHostsContent,
  parseHosts,
  readHostsFile,
  readProfiles,
} from "@/lib/hosts";
import { HttpError } from "@/lib/http";
import type { HostsData } from "./protocol";
export const HOSTS_HELPER = "/usr/local/libexec/dockmaster-hosts-helper";
export const hostsRevision = (content: string) =>
  crypto.createHash("sha256").update(content).digest("hex");
export async function hostsSnapshot(): Promise<HostsData> {
  const content = await readHostsFile(),
    profiles = await readProfiles();
  const canApply = await exec(["/usr/bin/sudo", "-n", "-l", HOSTS_HELPER], {
    timeoutMs: 2000,
  }).then(
    () => true,
    () => false,
  );
  return {
    entries: parseHosts(content),
    profiles: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      lineCount: p.content.split("\n").filter(Boolean).length,
    })),
    activeProfile: profiles.find((p) => p.content === content)?.name || null,
    revision: hostsRevision(content),
    canApply,
  };
}
export async function applyRemoteHosts(id: string, revision: string) {
  const profile = (await readProfiles()).find((p) => p.id === id);
  if (!profile) throw new HttpError(404, "Profile no longer exists.");
  assertSaneHostsContent(profile.content);
  if (hostsRevision(await readHostsFile()) !== revision)
    throw new HttpError(
      409,
      "Hosts changed. Refresh before applying a profile.",
    );
  await new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/sudo", ["-n", HOSTS_HELPER], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new HttpError(
          504,
          "Hosts update timed out. Check target state before retrying.",
        ),
      );
    }, 10000);
    child.on("error", () => {
      clearTimeout(timer);
      reject(
        new HttpError(
          503,
          "Hosts helper unavailable. Install the reviewed privileged helper on this machine.",
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new HttpError(
            code === 10 ? 409 : 403,
            code === 10
              ? "Hosts changed. Refresh before applying."
              : "Hosts helper refused the update. Install the fixed helper and its narrowly scoped sudo rule.",
          ),
        );
    });
    child.stdin.on("error", () => {});
    child.stdin.end(
      JSON.stringify({ expected: revision, content: profile.content }),
    );
  });
}
