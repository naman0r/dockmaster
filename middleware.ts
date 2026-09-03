import { NextResponse, type NextRequest } from "next/server";

// DNS rebinding defense: every request must claim a loopback Host. The API
// token + Origin check in lib/guard.ts adds the second layer on top of this.
export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase();
  const port = process.env.PORT || "3000";
  const allowed = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]);
  if (!allowed.has(host)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
