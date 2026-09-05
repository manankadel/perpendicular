import { proxyIdentityRequest } from "@/lib/auth-proxy";
import { corsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return proxyIdentityRequest(request, "/auth-mfa", ["mfaToken", "code", "type"]);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
