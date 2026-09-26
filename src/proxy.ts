import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0].toLowerCase();
  const canonicalOrigin = process.env.NEXT_PUBLIC_CANONICAL_URL;
  if (!host?.endsWith(".vercel.app") || !canonicalOrigin) return NextResponse.next();

  const destination = new URL(canonicalOrigin);
  if (destination.host === host) return NextResponse.next();
  destination.pathname = request.nextUrl.pathname;
  destination.search = request.nextUrl.search;
  return NextResponse.redirect(destination, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
