import { listIntegrationSummaries } from "@/lib/integration-store";
import { identityOrResponse } from "@/lib/route-auth";
import { corsJson, corsHeadersFor } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  try {
    return corsJson({ integrations: await listIntegrationSummaries(identity.context.workspaceId) }, undefined, request);
  } catch {
    return corsJson({ error: "Integration storage is not ready. Apply the platform database migration." }, { status: 503 }, request);
  }
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
