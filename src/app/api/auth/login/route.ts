import { proxyIdentityRequest } from "@/lib/auth-proxy";
import { corsHeadersFor } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return proxyIdentityRequest(request, "/auth-login", ["email", "password"]);
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
