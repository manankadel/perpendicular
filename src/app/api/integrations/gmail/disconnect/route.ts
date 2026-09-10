import { disconnectIntegration, recordAuditEvent } from "@/lib/integration-store";
import { hasPermission, identityOrResponse, rejectCrossOrigin } from "@/lib/route-auth";
import { corsHeadersFor, corsJson } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "settings:write")) return corsJson({ error: "You do not have permission to disconnect Gmail." }, { status: 403 }, request);
  await disconnectIntegration(identity.context.workspaceId, "gmail");
  let warning: string | undefined;
  try {
    await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "integration.disconnected", resourceType: "integration", resourceId: "gmail" });
  } catch {
    warning = "Gmail was disconnected, but its audit record could not be stored.";
  }
  return corsJson({ ok: true, ...(warning ? { auditRecorded: false, warning } : { auditRecorded: true }) }, undefined, request);
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
