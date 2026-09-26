import { recordAuditEvent } from "@/lib/integration-store";
import { GmailSendError, sendGmailMessage } from "@/lib/gmail";
import { hasPermission, identityOrResponse, rejectCrossOrigin } from "@/lib/route-auth";
import { corsHeadersFor, corsJson } from "@/lib/cors";
import { getWorkspace } from "@/lib/server-store";
import { claimOutboundMessage, markOutboundFailed, markOutboundSent, markOutboundUnknown } from "@/lib/outbound-store";
import { normalizeEmail, outboundSafetyDecision, startOfLocalDay } from "@/lib/outbound-safety";
import { randomToken } from "@/lib/security";

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
    const to = normalizeEmail(String(body.to || ""));
    const subject = String(body.subject || "Perpendicular Gmail connection test");
    const messageBody = String(body.body || "Perpendicular sent this message through the connected Gmail mailbox.");
    const workspace = await getWorkspace(identity.context.workspaceId);
    if (workspace.suppressedEmails.includes(to)) return corsJson({ error: "This address is suppressed and cannot receive Gmail test mail.", code: "suppressed_email" }, { status: 400 }, request);
    const safety = outboundSafetyDecision({ settings: workspace.outboundSafety, email: to });
    if (!safety.allowed) return corsJson({ error: safety.reason, code: safety.code, localDate: safety.localDate }, { status: 400 }, request);
    let claimed;
    try {
      claimed = await claimOutboundMessage({
        workspaceId: identity.context.workspaceId,
        idempotencyKey: `gmail-test:${randomToken(18)}`,
        recipient: to,
        sequenceId: "gmail-test",
        rowId: "manual-test",
        stepIndex: 0,
        subject,
        bodyText: messageBody,
        dailyLimit: workspace.outboundSafety.dailySendLimit,
        dailySince: startOfLocalDay(new Date(), workspace.outboundSafety.timezone).toISOString(),
      });
    } catch {
      return corsJson({ error: "Outbound safety could not be checked because the durable send store is unavailable." }, { status: 503 }, request);
    }
    if (claimed.kind === "limit") return corsJson({ error: `The workspace daily send limit of ${claimed.limit} has been reached. Try again after the local day resets.`, code: "daily_limit", sent: claimed.count, limit: claimed.limit }, { status: 429 }, request);
    if (claimed.kind !== "claimed") return corsJson({ error: "This Gmail test is already in progress. Refresh before retrying." }, { status: 409 }, request);
    let result: { id?: string; threadId?: string };
    try {
      result = await sendGmailMessage(identity.context.workspaceId, { to, subject, body: messageBody });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gmail send failed.";
      if (error instanceof GmailSendError && !error.safeToRetry) await markOutboundUnknown(claimed.record.id, message);
      else await markOutboundFailed(claimed.record.id, message);
      throw error;
    }
    if (!result.id) {
      await markOutboundUnknown(claimed.record.id, "Gmail returned no message id.");
      throw new Error("Gmail returned no message id. Do not retry until the mailbox is reconciled.");
    }
    await markOutboundSent(claimed.record.id, result.id, result.threadId || null);
    let warning: string | undefined;
    try {
      await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "gmail.message_sent", resourceType: "gmail_message", resourceId: result.id, metadata: { to } });
    } catch {
      warning = "The email was sent, but its audit record could not be stored.";
    }
    return corsJson({ ok: true, messageId: result.id, threadId: result.threadId, ...(warning ? { auditRecorded: false, warning } : { auditRecorded: true }) }, undefined, request);
  } catch (error) {
    return corsJson({ error: error instanceof Error ? error.message : "Gmail send failed." }, { status: 400 }, request);
  }
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
