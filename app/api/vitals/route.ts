import { errorJson } from "@/lib/http";
import { machineSnapshot } from "@/lib/machines/backend";
import { guard } from "@/lib/guard";
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const machine =
    url.searchParams.get("machine") ||
    req.headers.get("x-dockmaster-machine") ||
    "local";
  try {
    return Response.json(
      await machineSnapshot(
        machine,
        "vitals",
        url.searchParams.get("force") === "1",
      ),
    );
  } catch (e) {
    if (machine === "local") return errorJson(e);
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
