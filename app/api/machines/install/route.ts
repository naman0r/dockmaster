import fs from "node:fs/promises";
import path from "node:path";
import { guard } from "@/lib/guard";
import { backend, invalidateMachine } from "@/lib/machines/backend";
import { readMachines } from "@/lib/machines/config";
import { COMPANION_VERSION } from "@/lib/machines/protocol";
import { installCompanion } from "@/lib/machines/ssh";
import { readJsonBody } from "@/lib/http";
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await readJsonBody(req)) as { id?: unknown };
    if (typeof body.id !== "string") throw new Error("Select a saved machine.");
    const machine = (await readMachines()).find((m) => m.id === body.id);
    if (!machine) throw new Error("Unknown machine. Add it in Settings first.");
    const bundle = await fs
      .readFile(path.join(process.cwd(), "dist", "companion.cjs"))
      .catch(() => null);
    // The bundle embeds its version string, so a stale build is caught before it ships.
    if (!bundle || !bundle.includes(JSON.stringify(COMPANION_VERSION)))
      throw new Error(
        `No companion ${COMPANION_VERSION} bundle in dist/. Run npm run companion:build, then retry.`,
      );
    await installCompanion(machine, bundle);
    invalidateMachine(machine.id);
    const { connection } = await backend(machine.id);
    return Response.json({
      machineId: machine.id,
      ...(await connection.request("hello")),
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
