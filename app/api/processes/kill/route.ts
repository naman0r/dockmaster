import { guard } from "@/lib/guard";
import { errorJson, readJsonBody } from "@/lib/http";
import { killByPid } from "@/lib/processes/kill";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await readJsonBody(req)) as { pid?: unknown; mode?: unknown };
    const pid = typeof body.pid === "number" ? body.pid : Number(body.pid);
    const mode = body.mode === "kill" ? "kill" : "term";
    return Response.json(await killByPid(pid, mode));
  } catch (err) {
    return errorJson(err);
  }
}
