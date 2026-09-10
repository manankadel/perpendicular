import { apiKeyScopes, createApiKey, listApiKeys, type ApiKeyScope } from "@/lib/api-keys";
import { recordAuditEvent } from "@/lib/integration-store";
import { hasPermission, identityOrResponse, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";
import { corsHeadersFor, corsJson } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "settings:read")) return corsJson({ error: "You do not have permission to view API keys." }, { status: 403 }, request);
  try {
    return corsJson({ keys: await listApiKeys(identity.context.workspaceId) }, { headers: rateLimitHeaders(identity.context) }, request);
  } catch {
    return corsJson({ error: "API key storage is not ready. Apply the platform database migration." }, { status: 503 }, request);
  }
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "settings:write")) return corsJson({ error: "You do not have permission to create API keys." }, { status: 403 }, request);
  try {
    const body = await request.json() as { name?: string; scopes?: unknown };
    const name = String(body.name || "").trim();
    if (!name || name.length > 80) return corsJson({ error: "A key name between 1 and 80 characters is required." }, { status: 400 }, request);
    const requestedScopes = Array.isArray(body.scopes) ? body.scopes : ["workspace:read"];
    const scopes = [...new Set(requestedScopes.filter((scope): scope is ApiKeyScope => typeof scope === "string" && (apiKeyScopes as readonly string[]).includes(scope)))] as ApiKeyScope[];
    if (!scopes.length) return corsJson({ error: `Choose at least one supported scope: ${apiKeyScopes.join(", ")}.` }, { status: 400 }, request);
    const key = await createApiKey({ workspaceId: identity.context.workspaceId, createdBy: identity.context.userId, name, scopes });
    let auditWarning: string | undefined;
    try {
      await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "api_key.created", resourceType: "api_key", resourceId: key.id, metadata: { name, scopes } });
    } catch (error) {
      auditWarning = error instanceof Error ? `The key was created, but its audit record failed: ${error.message}` : "The key was created, but audit storage is unavailable.";
    }
    return corsJson({ ...key, warning: ["Copy this key now. It will never be shown again.", auditWarning].filter(Boolean).join(" "), auditRecorded: !auditWarning }, { status: 201, headers: rateLimitHeaders(identity.context) }, request);
  } catch (error) {
    return corsJson({ error: error instanceof Error ? error.message : "Could not create API key." }, { status: 503 }, request);
  }
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
