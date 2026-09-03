import { HttpError } from "@/lib/http";
import { killProcessTree, readProcessTable } from "@/lib/proctree";
import { scanServices, portIsListening } from "./scan";

type StopPayload = {
  pid: number;
  port: number;
  startedAt: string;
  mode: "term" | "kill";
};

function validate(payload: unknown): StopPayload {
  if (typeof payload !== "object" || payload === null) {
    throw new HttpError(400, "Body must be a JSON object.");
  }
  const body = payload as Record<string, unknown>;
  const { pid, port, startedAt, mode } = body;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) {
    throw new HttpError(400, "pid must be an integer greater than 1.");
  }
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HttpError(400, "port must be an integer from 1 to 65535.");
  }
  if (typeof startedAt !== "string" || !startedAt) {
    throw new HttpError(400, "startedAt is required.");
  }
  if (mode !== "term" && mode !== "kill") {
    throw new HttpError(400, 'mode must be "term" or "kill".');
  }
  return { pid, port, startedAt, mode };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function stopService(payload: unknown): Promise<{
  ok: boolean;
  mode: string;
  signaled: number[];
  stillListening: boolean;
}> {
  const target = validate(payload);

  // Fresh scan + exact identity match: a stale row must never signal a
  // recycled PID. startedAt doubles as the PID-reuse guard.
  const fresh = await scanServices(true);
  const service = fresh.services.find(
    (s) => s.pid === target.pid && s.port === target.port && s.startedAt === target.startedAt,
  );
  if (!service) {
    throw new HttpError(
      409,
      "That listener changed since the last refresh. The list has been updated.",
    );
  }
  if (!service.isStoppable) {
    throw new HttpError(403, "That process is protected and cannot be stopped here.");
  }

  const table = await readProcessTable();
  if (!table.has(target.pid)) {
    throw new HttpError(409, "That process has already exited.");
  }
  if (table.get(target.pid)!.uid !== process.getuid!()) {
    throw new HttpError(403, "That process belongs to another user.");
  }

  const sig = target.mode === "term" ? "SIGTERM" : "SIGKILL";
  const { signaled } = await killProcessTree(target.pid, sig);

  const timeoutMs = target.mode === "term" ? 3000 : 1000;
  const deadline = Date.now() + timeoutMs;
  let stillListening = await portIsListening(target.port);
  while (stillListening && Date.now() < deadline) {
    await sleep(150);
    stillListening = await portIsListening(target.port);
  }

  return {
    ok: true,
    mode: target.mode,
    signaled,
    stillListening,
  };
}
