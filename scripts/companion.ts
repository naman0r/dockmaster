import { collect } from "../lib/machines/collector";
import {
  Lines,
  MAX_MESSAGE,
  VERSION,
  validRequest,
} from "../lib/machines/protocol";
if (process.argv[2]) process.env.DOCKMASTER_DEV_ROOT = process.argv[2];
const lines = new Lines();
let active = 0;
function send(value: unknown) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > MAX_MESSAGE) process.exit(1);
  process.stdout.write(json + "\n");
}
process.stdin.on("data", (chunk: Buffer) => {
  try {
    lines.push(chunk, (line) => {
      const req: unknown = JSON.parse(line);
      if (!validRequest(req)) {
        send({
          v: VERSION,
          error:
            "Incompatible or malformed request. Rebuild and install matching companion.",
        });
        process.exit(1);
      }
      if (++active > 8) process.exit(1);
      void collect(req.op)
        .then(
          (result) => {
            if (req.op === "ports" && "services" in result.data)
              result = {
                ...result,
                data: {
                  services: result.data.services.map((s) => ({
                    ...s,
                    argv: "",
                    isStoppable: false,
                  })),
                },
              };
            send({ v: VERSION, id: req.id, result });
          },
          () =>
            send({
              v: VERSION,
              id: req.id,
              error:
                "Collection failed on target. Check companion runtime and macOS permissions.",
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
