import { NextResponse, type NextRequest } from "next/server";
import { hostIsLoopback } from "@/lib/loopback";

// DNS rebinding defense for every route. The API token + Origin check in
// lib/guard.ts is the second layer on top of this.
export function middleware(req: NextRequest) {
  if (!hostIsLoopback(req.headers.get("host") || "")) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
