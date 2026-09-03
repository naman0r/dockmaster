import { HttpError } from "@/lib/http";
import { killProcessTree } from "@/lib/proctree";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function killByPid(
  pid: number,
  mode: "term" | "kill",
): Promise<{ ok: boolean; signaled: number[]; stillAlive: boolean }> {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) {
    throw new HttpError(400, "pid must be an integer greater than 1.");
  }
  const sig = mode === "term" ? "SIGTERM" : "SIGKILL";
  const { signaled } = await killProcessTree(pid, sig);

  const deadline = Date.now() + (mode === "term" ? 3000 : 1000);
  let stillAlive = pidExists(pid);
  while (stillAlive && Date.now() < deadline) {
    await sleep(150);
    stillAlive = pidExists(pid);
  }
  return { ok: true, signaled, stillAlive };
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code !== "ESRCH";
  }
}
