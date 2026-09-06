import { disconnectIntegration, recordAuditEvent } from "@/lib/integration-store";
import { identityOrResponse, rejectCrossOrigin } from "@/lib/route-auth";
import { corsHeadersFor, corsJson } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  await disconnectIntegration(identity.context.workspaceId, "gmail");
  await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "integration.disconnected", resourceType: "integration", resourceId: "gmail" });
  return corsJson({ ok: true }, undefined, request);
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
