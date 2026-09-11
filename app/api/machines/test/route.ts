import { guard } from "@/lib/guard";
import { backend, invalidateMachine } from "@/lib/machines/backend";
import { readJsonBody } from "@/lib/http";
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await readJsonBody(req)) as { id?: unknown };
    if (typeof body.id !== "string") throw new Error("Select a saved machine.");
    invalidateMachine(body.id);
    const { connection } = await backend(body.id);
    return Response.json({
      machineId: body.id,
      ...(await connection.request("hello")),
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
