import { guard } from "@/lib/guard";
import { errorJson, readJsonBody, asString } from "@/lib/http";
import { applyProfile, deleteProfile, readProfiles, saveProfile } from "@/lib/hosts";

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { action } = await ctx.params;
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    if (action === "apply") {
      const profiles = await readProfiles();
      const profile = profiles.find((p) => p.id === asString(body.id, "id"));
      if (!profile) {
        return Response.json({ error: "No profile with that id." }, { status: 404 });
      }
      return Response.json({ ok: true, ...(await applyProfile(profile)) });
    }
    if (action === "profiles") {
      const content = typeof body.content === "string" ? body.content : undefined;
      return Response.json({ ok: true, profile: await saveProfile(asString(body.name, "name"), content) });
    }
    if (action === "delete") {
      await deleteProfile(asString(body.id, "id"));
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Not found." }, { status: 404 });
  } catch (err) {
    return errorJson(err);
  }
}
