import { guard } from "@/lib/guard";
import { errorJson, readJsonBody, asString, asBool } from "@/lib/http";
import { removeWorktree, pruneWorktrees, deleteBranch } from "@/lib/worktrees/scan";

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { action } = await ctx.params;
    if (!["remove", "prune", "delete-branch"].includes(action)) {
      return Response.json({ error: "Not found." }, { status: 404 });
    }
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const repoPath = asString(body.repoPath, "repoPath");
    if (action === "remove") {
      await removeWorktree(
        repoPath,
        asString(body.worktreePath, "worktreePath"),
        asBool(body.force ?? false, "force"),
      );
      return Response.json({ ok: true });
    }
    if (action === "prune") {
      return Response.json({ ok: true, pruned: await pruneWorktrees(repoPath) });
    }
    return Response.json({
      ok: true,
      ...(await deleteBranch(
        repoPath,
        asString(body.branch, "branch"),
        asBool(body.force ?? false, "force"),
      )),
    });
  } catch (err) {
    return errorJson(err);
  }
}
