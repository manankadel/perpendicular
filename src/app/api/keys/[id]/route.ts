import { NextResponse } from "next/server";
import { revokeApiKey } from "@/lib/api-keys";
import { recordAuditEvent } from "@/lib/integration-store";
import { hasPermission, identityOrResponse, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "settings:write")) return NextResponse.json({ error: "You do not have permission to revoke API keys." }, { status: 403 });
  const { id } = await params;
  const revoked = await revokeApiKey(identity.context.workspaceId, id);
  if (!revoked) return NextResponse.json({ error: "API key not found." }, { status: 404 });
  await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "api_key.revoked", resourceType: "api_key", resourceId: id });
  return NextResponse.json({ ok: true }, { headers: rateLimitHeaders(identity.context) });
}
