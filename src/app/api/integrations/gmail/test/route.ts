import { recordAuditEvent } from "@/lib/integration-store";
import { sendGmailMessage } from "@/lib/gmail";
import { hasPermission, identityOrResponse, rejectCrossOrigin } from "@/lib/route-auth";
import { corsHeadersFor, corsJson } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "settings:write")) return corsJson({ error: "You do not have permission to send a Gmail test." }, { status: 403 }, request);
  try {
    const body = await request.json() as { to?: string; subject?: string; body?: string };
    const result = await sendGmailMessage(identity.context.workspaceId, {
      to: String(body.to || ""),
      subject: String(body.subject || "Perpendicular Gmail connection test"),
      body: String(body.body || "Perpendicular sent this message through the connected Gmail mailbox."),
    });
    let warning: string | undefined;
    try {
      await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "gmail.message_sent", resourceType: "gmail_message", resourceId: result.id, metadata: { to: body.to } });
    } catch {
      warning = "The email was sent, but its audit record could not be stored.";
    }
    return corsJson({ ok: true, messageId: result.id, threadId: result.threadId, ...(warning ? { auditRecorded: false, warning } : { auditRecorded: true }) }, undefined, request);
  } catch (error) {
    return corsJson({ error: error instanceof Error ? error.message : "Gmail send failed." }, { status: 400 }, request);
  }
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
