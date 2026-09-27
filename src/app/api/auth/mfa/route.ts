import { proxyIdentityRequest } from "@/lib/auth-proxy";
import { corsHeadersFor } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  const googleMfaToken = cookie.match(/(?:^|;\s*)perpendicular_google_mfa=([^;]+)/)?.[1];
  let input: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
  } catch {
    input = {};
  }
  if (!input.mfaToken && googleMfaToken) input.mfaToken = decodeURIComponent(googleMfaToken);
  const proxied = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(input),
  });
  const response = await proxyIdentityRequest(proxied, "/auth-mfa", ["mfaToken", "code", "type"]);
  if (!googleMfaToken || !response.ok) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", "perpendicular_google_mfa=; Path=/api/auth; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
