import { executeTicketReplySend } from "@/lib/ticket-send-runtime";
import { corsHeadersFor, corsJson } from "@/lib/cors";
import { recordAuditEvent } from "@/lib/integration-store";
import { hasPermission, identityOrResponse, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";
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
  let body: { body?: unknown } = {};
  try { body = await request.json() as typeof body; } catch { return corsJson({ error: "Request body must be valid JSON." }, { status: 400 }, request); }
  const { ticketId } = await context.params;
  try {
    const execution = await executeTicketReplySend({ workspaceId: identity.context.workspaceId, ticketId, body: String(body.body || "").trim() || undefined, senderEmail: identity.context.email });
    let auditRecorded = true;
    try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "api.gmail_ticket_reply_sent", resourceType: "ticket", resourceId: ticketId, metadata: { providerMessageId: execution.delivery.messageId, recipient: execution.ticket.requesterEmail } }); } catch { auditRecorded = false; }
    return corsJson({ ticket: execution.ticket, delivery: { ...execution.delivery, auditRecorded }, state: workspaceStateForClient(execution.state) }, { headers: rateLimitHeaders(identity.context) }, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail ticket reply failed.";
    const status = message === "Ticket not found." ? 404 : message.includes("daily send limit") ? 429 : message.includes("unknown provider outcome") || message.includes("already in progress") ? 409 : message.includes("could not be checked") || message.includes("could not persist") ? 503 : 400;
    return corsJson({ error: message }, { status }, request);
  }
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
