import { guard } from "@/lib/guard";
import { readJsonBody } from "@/lib/http";
import { LOCAL, readMachines, changeMachine } from "@/lib/machines/config";
import { invalidateMachine } from "@/lib/machines/backend";
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json({ machines: [LOCAL, ...(await readMachines())] });
  } catch {
    return Response.json(
      { error: "Could not read machine configuration." },
      { status: 500 },
    );
  }
}
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = await readJsonBody(req);
    const next = await changeMachine(body);
    if (
      body &&
      typeof body === "object" &&
      "id" in body &&
      typeof body.id === "string"
    )
      invalidateMachine(body.id);
    return Response.json({ machines: [LOCAL, ...next] });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const id = new URL(req.url).searchParams.get("id") || "";
    const next = await changeMachine(id, true);
    invalidateMachine(id);
    return Response.json({ machines: [LOCAL, ...next] });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
