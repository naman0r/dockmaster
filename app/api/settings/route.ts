import { guard } from "@/lib/guard";
import { errorJson, readJsonBody } from "@/lib/http";
import { patchSettings, readSettings, MODULES, type ModuleId } from "@/lib/settings";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(await readSettings());
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await readJsonBody(req)) as { modules?: Record<string, unknown> };
    const patch: Partial<Record<ModuleId, boolean>> = {};
    if (body && typeof body.modules === "object" && body.modules !== null) {
      for (const id of MODULES) {
        if (typeof body.modules[id] === "boolean") {
          patch[id] = body.modules[id] as boolean;
        }
      }
    }
    return Response.json(await patchSettings(patch));
  } catch (err) {
    return errorJson(err);
  }
}
