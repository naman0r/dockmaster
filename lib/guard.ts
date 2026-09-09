import crypto from "crypto";
import { getToken } from "./token";

const AUTH_HEADER = "x-dockmaster-token";

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Origin check blocks cross-site fetches (the custom header already forces a
// preflight, which is answered without CORS headers); the token is defense in
// depth. The Host check lives in middleware.ts and covers DNS rebinding for
// every route. A bad token is 401 so the client can tell "server restarted,
// reload for a fresh token" apart from the 403s the action guards return.
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
      { status: 401 },
    );
  }
  const url = new URL(req.url);
  const machine =
    url.searchParams.get("machine") ||
    req.headers.get("x-dockmaster-machine") ||
    "local";
  if (
    machine !== "local" &&
    !(
      req.method === "GET" &&
      ["/api/ports", "/api/vitals"].includes(url.pathname)
    )
  ) {
    return Response.json(
      { error: "This operation is local-only. Select This Mac." },
      { status: 403 },
    );
  }
  return null;
}
