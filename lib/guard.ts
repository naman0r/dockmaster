import crypto from "crypto";
import { getToken } from "./token";

const AUTH_HEADER = "x-dockmaster-token";

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Origin check blocks cross-site fetches (the custom header already forces a
// preflight that we never answer); the token is defense in depth. The Host
// check lives in middleware.ts and covers DNS rebinding for every route.
export function guard(req: Request): Response | null {
  const host = (req.headers.get("host") || "").toLowerCase();
  const origin = req.headers.get("origin");
  if (origin && origin.toLowerCase() !== `http://${host}`) {
    return Response.json({ error: "Untrusted Origin." }, { status: 403 });
  }
  const supplied = req.headers.get(AUTH_HEADER) || "";
  if (!supplied || !safeEqual(supplied, getToken())) {
    return Response.json(
      { error: "Missing or invalid local request token." },
      { status: 403 },
    );
  }
  return null;
}
