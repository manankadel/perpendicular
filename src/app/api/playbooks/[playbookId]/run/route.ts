import { executeWorkspacePlaybook } from "@/lib/playbook-runtime";
import { corsHeadersFor, corsJson } from "@/lib/cors";
import { recordAuditEvent } from "@/lib/integration-store";
import { hasPermission, identityOrResponse, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";
import { recordUsage } from "@/lib/usage";
import { workspaceStateForClient } from "@/lib/workspace-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ playbookId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "workspace:write")) return corsJson({ error: "workspace:write permission is required." }, { status: 403 }, request);
  let body: { employeeId?: unknown; input?: unknown } = {};
  try { body = await request.json() as typeof body; } catch { return corsJson({ error: "Request body must be valid JSON." }, { status: 400 }, request); }
  const { playbookId } = await context.params;
  try {
    const execution = await executeWorkspacePlaybook({
      workspaceId: identity.context.workspaceId,
      playbookId,
      employeeId: String(body.employeeId || "").trim() || undefined,
      input: String(body.input || ""),
      source: "api",
    });
    try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "api.playbook_run", resourceType: "playbook", resourceId: playbookId, metadata: { runId: execution.run.id, missionId: execution.mission.id } }); } catch { if (process.env.NODE_ENV === "production") return corsJson({ error: "The playbook run was saved, but its audit record could not be stored.", persisted: true, runId: execution.run.id }, { status: 503 }, request); }
    try { await recordUsage({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, feature: "playbook_run", unit: "ai", units: 2, provider: execution.result.provider }); } catch { if (process.env.NODE_ENV === "production") return corsJson({ error: "The playbook run was saved, but its usage record could not be stored.", persisted: true, runId: execution.run.id }, { status: 503 }, request); }
    return corsJson({ playbook: execution.playbook, employee: { id: execution.employee.id, name: execution.employee.name }, mission: execution.mission, run: execution.run, output: execution.run.output, provider: execution.result.provider, state: workspaceStateForClient(execution.state) }, { headers: rateLimitHeaders(identity.context) }, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Playbook execution failed.";
    const status = message === "Playbook not found." ? 404 : message.includes("AI Credits") ? 402 : 400;
    return corsJson({ error: message }, { status }, request);
  }
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
