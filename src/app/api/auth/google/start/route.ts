import { NextResponse } from "next/server";
import { safeReturnPath } from "@/lib/auth-proxy";
import { corsHeadersFor } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function identityOrigin() {
  return new URL(process.env.BLUEBLOOD_ID_API_ORIGIN || process.env.BLUEBLOOD_ID_ISSUER || "https://id.bluebloodstudio.com");
}

function canonicalOrigin(request: Request) {
  return new URL(process.env.PERPENDICULAR_WEB_ORIGIN || process.env.NEXT_PUBLIC_CANONICAL_URL || new URL(request.url).origin);
}

export function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const destination = canonicalOrigin(request);
  const returnPath = safeReturnPath(requestUrl.searchParams.get("next"));
  const next = new URL(returnPath, destination);
  const start = new URL("/api/oauth/google/start", identityOrigin());
  start.searchParams.set("next", next.toString());
  return NextResponse.redirect(start, { headers: corsHeadersFor(request) });
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
