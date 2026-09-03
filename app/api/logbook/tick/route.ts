import { guard } from "@/lib/guard";
import { errorJson } from "@/lib/http";
import { moduleEnabled } from "@/lib/settings";
import { sampleFrontmost, recordSample } from "@/lib/logbook/store";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    if (!(await moduleEnabled("logbook"))) {
      return Response.json({ error: "Logbook module is off." }, { status: 409 });
    }
    const sample = await sampleFrontmost();
    if (!sample) return Response.json({ ok: true, idle: true });
    const recorded = await recordSample(sample);
    return Response.json({ ok: true, ...recorded });
  } catch (err) {
    return errorJson(err);
  }
}
