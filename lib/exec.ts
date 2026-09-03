import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);

export class CommandError extends Error {}

export async function exec(
  argv: string[],
  opts: { timeoutMs?: number; okReturnCodes?: number[] } = {},
): Promise<string> {
  const { timeoutMs = 3000, okReturnCodes = [0] } = opts;
  try {
    const { stdout } = await run(argv[0], argv.slice(1), {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    });
    return stdout;
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    if (typeof e.code === "number" && okReturnCodes.includes(e.code)) {
      return e.stdout || "";
    }
    if (e.killed) throw new CommandError(`${argv[0]} timed out after ${timeoutMs}ms`);
    throw new CommandError(
      `${argv[0]} failed: ${(e.stderr || `exit status ${e.code}`).trim()}`,
    );
  }
}
