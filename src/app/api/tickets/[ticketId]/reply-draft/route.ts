import { executeTicketReplyDraft } from "@/lib/ticket-runtime";
import { corsHeadersFor, corsJson } from "@/lib/cors";
import { recordAuditEvent } from "@/lib/integration-store";
import { hasPermission, identityOrResponse, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";
import { recordUsage } from "@/lib/usage";
import { workspaceStateForClient } from "@/lib/workspace-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "workspace:write")) return corsJson({ error: "workspace:write permission is required." }, { status: 403 }, request);
  let body: { employeeId?: unknown } = {};
  try { body = await request.json() as typeof body; } catch { return corsJson({ error: "Request body must be valid JSON." }, { status: 400 }, request); }
  const { ticketId } = await context.params;
  try {
    const execution = await executeTicketReplyDraft({ workspaceId: identity.context.workspaceId, ticketId, employeeId: String(body.employeeId || "").trim() || undefined, source: "api" });
    try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "api.ticket_reply_draft", resourceType: "ticket", resourceId: ticketId, metadata: { employeeId: execution.employee.id } }); } catch { if (process.env.NODE_ENV === "production") return corsJson({ error: "The reply draft was saved, but its audit record could not be stored.", persisted: true, ticketId }, { status: 503 }, request); }
    try { await recordUsage({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, feature: "ticket_reply_draft", unit: "ai", units: 2, provider: execution.result.provider }); } catch { if (process.env.NODE_ENV === "production") return corsJson({ error: "The reply draft was saved, but its usage record could not be stored.", persisted: true, ticketId }, { status: 503 }, request); }
    return corsJson({ ticket: execution.ticket, employee: { id: execution.employee.id, name: execution.employee.name }, output: execution.result.content, provider: execution.result.provider, state: workspaceStateForClient(execution.state) }, { headers: rateLimitHeaders(identity.context) }, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Support reply drafting failed.";
    const status = message === "Ticket not found." ? 404 : message.includes("AI Credits") ? 402 : 400;
    return corsJson({ error: message }, { status }, request);
  }
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
