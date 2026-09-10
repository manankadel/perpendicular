import { revokeApiKey } from "@/lib/api-keys";
import { recordAuditEvent } from "@/lib/integration-store";
import { hasPermission, identityOrResponse, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";
import { corsHeadersFor, corsJson } from "@/lib/cors";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "settings:write")) return corsJson({ error: "You do not have permission to revoke API keys." }, { status: 403 }, request);
  const { id } = await params;
  const revoked = await revokeApiKey(identity.context.workspaceId, id);
  if (!revoked) return corsJson({ error: "API key not found." }, { status: 404 }, request);
  await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "api_key.revoked", resourceType: "api_key", resourceId: id });
  return corsJson({ ok: true }, { headers: rateLimitHeaders(identity.context) }, request);
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
