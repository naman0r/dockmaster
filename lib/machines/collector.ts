import os from "node:os";
import { scanServices } from "@/lib/ports/scan";
import { sampleVitals } from "@/lib/vitals";
import { devRoot } from "@/lib/settings";
import { COMPANION_VERSION, type Operation, type Result } from "./protocol";
export async function collect(op: Operation, force = false): Promise<Result> {
  if (op === "hello")
    return {
      cachedAt: new Date().toISOString(),
      data: {
        hostname: os.hostname(),
        os: process.platform,
        user: os.userInfo().username,
        version: COMPANION_VERSION,
        scanRoot: devRoot(),
        capabilities: process.platform === "darwin" ? ["ports", "vitals"] : [],
      },
    };
  if (process.platform !== "darwin")
    throw new Error(
      "Unsupported OS: this companion currently supports macOS only.",
    );
  if (op === "vitals") return sampleVitals();
  const { services, cachedAt, scanMs } = await scanServices(force);
  return { data: { services }, cachedAt, scanMs };
}
