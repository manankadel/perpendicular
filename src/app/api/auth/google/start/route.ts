import { getSetCookieHeaders, safeReturnPath } from "@/lib/auth-proxy";
import { corsHeadersFor } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function identityOrigin() {
  return new URL(process.env.BLUEBLOOD_ID_API_ORIGIN || process.env.BLUEBLOOD_ID_ISSUER || "https://id.bluebloodstudio.com");
}

function canonicalOrigin(request: Request) {
  return new URL(process.env.PERPENDICULAR_WEB_ORIGIN || process.env.NEXT_PUBLIC_CANONICAL_URL || new URL(request.url).origin);
}

function sharedIdentityCookie(cookie: string) {
  if (/^__Host-/i.test(cookie) || /(?:^|;)\s*domain=/i.test(cookie)) return cookie;
  return `${cookie}; Domain=.bluebloodstudio.com`;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const destination = canonicalOrigin(request);
  const returnPath = safeReturnPath(requestUrl.searchParams.get("next"));
  const next = new URL(returnPath, destination);
  const start = new URL("/api/oauth/google/start", identityOrigin());
  start.searchParams.set("next", next.toString());
  start.searchParams.set("product", "perpendicular");
  const upstream = await fetch(start, { redirect: "manual", cache: "no-store" });
  const headers = new Headers(corsHeadersFor(request));
  headers.set("cache-control", "no-store");
  for (const cookie of getSetCookieHeaders(upstream.headers)) headers.append("set-cookie", sharedIdentityCookie(cookie));
  const location = upstream.headers.get("location");
  if (location) headers.set("location", location);
  return new Response(location ? null : await upstream.text(), { status: upstream.status, headers });
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
