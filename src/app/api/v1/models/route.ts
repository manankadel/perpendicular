import { corsHeadersFor, corsJson } from "@/lib/cors";
import { identityOrResponse } from "@/lib/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  return corsJson({ object: "list", data: [{ id: "perpendicular-local", object: "model", created: 0, owned_by: "perpendicular", capabilities: ["chat", "citations", "workspace-context"] }] }, undefined, request);
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
