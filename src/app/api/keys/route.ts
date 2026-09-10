import { NextResponse } from "next/server";
import { createApiKey, listApiKeys } from "@/lib/api-keys";
import { recordAuditEvent } from "@/lib/integration-store";
import { hasPermission, identityOrResponse, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "settings:read")) return NextResponse.json({ error: "You do not have permission to view API keys." }, { status: 403 });
  try {
    return NextResponse.json({ keys: await listApiKeys(identity.context.workspaceId) }, { headers: rateLimitHeaders(identity.context) });
  } catch {
    return NextResponse.json({ error: "API key storage is not ready. Apply the platform database migration." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "settings:write")) return NextResponse.json({ error: "You do not have permission to create API keys." }, { status: 403 });
  try {
    const body = await request.json() as { name?: string; scopes?: unknown };
    const name = String(body.name || "").trim();
    if (!name || name.length > 80) return NextResponse.json({ error: "A key name between 1 and 80 characters is required." }, { status: 400 });
    const scopes = Array.isArray(body.scopes)
      ? body.scopes.filter((scope): scope is string => typeof scope === "string" && /^[a-z]+:[a-z]+$/.test(scope)).slice(0, 30)
      : ["workspace:read"];
    const key = await createApiKey({ workspaceId: identity.context.workspaceId, createdBy: identity.context.userId, name, scopes });
    await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "api_key.created", resourceType: "api_key", resourceId: key.id, metadata: { name, scopes } });
    return NextResponse.json({ ...key, warning: "Copy this key now. It will never be shown again." }, { status: 201, headers: rateLimitHeaders(identity.context) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create API key." }, { status: 503 });
  }
}
