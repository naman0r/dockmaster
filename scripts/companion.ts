import path from "node:path";
import {
  collect,
  invalidateCollectors,
  sessionId,
} from "../lib/machines/collector";
import { executeAction } from "../lib/machines/actions";
import { HttpError } from "../lib/http";
import {
  Lines,
  MAX_MESSAGE,
  VERSION,
  validRequest,
  type Result,
} from "../lib/machines/protocol";
if (process.argv[2]) process.env.DOCKMASTER_DEV_ROOT = process.argv[2];
process.env.DOCKMASTER_DATA_DIR = path.join(
  path.dirname(process.argv[1]),
  "data",
);
const lines = new Lines();
let active = 0;
let mutating = false;
function send(value: unknown) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > MAX_MESSAGE) process.exit(1);
  process.stdout.write(json + "\n");
}
function sanitize(result: Result): Result {
  if ("services" in result.data)
    return {
      ...result,
      data: { services: result.data.services.map((s) => ({ ...s, argv: "" })) },
    };
  if ("findings" in result.data)
    return {
      ...result,
      data: {
        ...result.data,
        findings: result.data.findings.map((f) => ({
          ...f,
          preview: "[redacted]",
        })),
      },
    };
  if ("depth" in result.data)
    return {
      ...result,
      data: {
        ...result.data,
        repos: result.data.repos.map((r) => ({
          ...r,
          error: r.error ? "Git inspection failed on this repository." : "",
        })),
      },
    };
  return result;
}
process.stdin.on("data", (chunk: Buffer) => {
  try {
    lines.push(chunk, (line) => {
      const req: unknown = JSON.parse(line);
      if (!validRequest(req)) {
        send({
          v: VERSION,
          error:
            "Incompatible or malformed request. Install matching companion.",
        });
        process.exit(1);
      }
      if (++active > 8) process.exit(1);
      void (async () => {
        if (req.op === "action") {
          if (req.sessionId !== sessionId || mutating)
            throw new HttpError(
              409,
              "Connection changed or another action is pending. Refresh before retrying.",
            );
          mutating = true;
          try {
            const data = await executeAction(req.params!);
            invalidateCollectors();
            return { cachedAt: new Date().toISOString(), data };
          } finally {
            mutating = false;
          }
        }
        return collect(req.op, req.force);
      })()
        .then(
          (result) =>
            send({ v: VERSION, id: req.id, result: sanitize(result) }),
          (e) =>
            send({
              v: VERSION,
              id: req.id,
              error: {
                code: e instanceof HttpError ? e.status : 503,
                message:
                  e instanceof HttpError
                    ? e.message
                    : "Target operation failed. Check runtime, configured root, and permissions.",
              },
            }),
        )
        .finally(() => active--);
    });
  } catch {
    process.exit(1);
  }
});
process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(1));
process.stdout.on("error", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
