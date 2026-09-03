import { guard } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { sampleVitals } from "@/lib/vitals";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { data, cachedAt } = await sampleVitals();
    return Response.json({ enabled: true, cachedAt, data });
  } catch (err) {
    return errorJson(err);
  }
}
