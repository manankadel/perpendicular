import { executeWorkspaceApp } from "@/lib/app-runtime";
import { corsHeadersFor, corsJson } from "@/lib/cors";
import { recordAuditEvent } from "@/lib/integration-store";
import { hasPermission, identityOrResponse, rejectCrossOrigin, rateLimitHeaders } from "@/lib/route-auth";
import { recordUsage } from "@/lib/usage";
import { workspaceStateForClient } from "@/lib/workspace-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ appId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "workspace:write")) return corsJson({ error: "workspace:write permission is required." }, { status: 403 }, request);
  let body: { input?: unknown } = {};
  try { body = await request.json() as { input?: unknown }; } catch { return corsJson({ error: "Request body must be valid JSON." }, { status: 400 }, request); }
  const { appId } = await context.params;
  try {
    const execution = await executeWorkspaceApp({ workspaceId: identity.context.workspaceId, appId, input: String(body.input || ""), source: "api" });
    try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "api.app_run", resourceType: "app", resourceId: appId, metadata: { runId: execution.run.id } }); } catch { if (process.env.NODE_ENV === "production") return corsJson({ error: "The app run was saved, but its audit record could not be stored.", persisted: true, runId: execution.run.id }, { status: 503 }, request); }
    try { await recordUsage({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, feature: "app_run", unit: "ai", units: 2, provider: execution.result.provider }); } catch { if (process.env.NODE_ENV === "production") return corsJson({ error: "The app run was saved, but its usage record could not be stored.", persisted: true, runId: execution.run.id }, { status: 503 }, request); }
    return corsJson({ app: execution.app, employee: { id: execution.employee.id, name: execution.employee.name }, run: execution.run, output: execution.run.output, provider: execution.result.provider, state: workspaceStateForClient(execution.state) }, { headers: rateLimitHeaders(identity.context) }, request);
  } catch (error) {
    return corsJson({ error: error instanceof Error ? error.message : "App execution failed." }, { status: 400 }, request);
  }
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}

