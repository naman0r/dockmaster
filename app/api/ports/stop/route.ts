import { guard } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { stopService } from "@/lib/ports/stop";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    return Response.json(await stopService(body));
  } catch (err) {
    return errorJson(err);
  }
}
