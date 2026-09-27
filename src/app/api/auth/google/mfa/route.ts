import { safeReturnPath } from "@/lib/auth-proxy";
import { corsHeadersFor } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MFA_COOKIE = "perpendicular_google_mfa";

function webOrigin(request: Request) {
  return new URL(process.env.PERPENDICULAR_WEB_ORIGIN || process.env.NEXT_PUBLIC_CANONICAL_URL || new URL(request.url).origin);
}

function safeProductPath(value: string | null, request: Request) {
  const relative = safeReturnPath(value);
  if (relative !== "/" || value === "/") return relative;
  if (!value) return "/";
  try {
    const candidate = new URL(value);
    if (candidate.origin !== webOrigin(request).origin) return "/";
    return safeReturnPath(`${candidate.pathname}${candidate.search}${candidate.hash}`);
  } catch {
    return "/";
  }
}

function redirectToLogin(request: Request, next: string, error?: string) {
  const login = new URL("/login", webOrigin(request));
  login.searchParams.set("next", next);
  if (error) login.searchParams.set("error", error);
  const headers = new Headers(corsHeadersFor(request));
  headers.set("location", login.toString());
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 303, headers });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mfaToken = url.searchParams.get("mfa")?.trim();
  const next = safeProductPath(url.searchParams.get("next"), request);
  if (!mfaToken) return redirectToLogin(request, next, "The Google sign-in challenge was missing. Start again.");

  const headers = new Headers(corsHeadersFor(request));
  headers.append(
    "set-cookie",
    `${MFA_COOKIE}=${encodeURIComponent(mfaToken)}; Path=/api/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
  );
  const login = new URL("/login", webOrigin(request));
  login.searchParams.set("next", next);
  login.searchParams.set("google_mfa", "1");
  headers.set("location", login.toString());
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 303, headers });
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
