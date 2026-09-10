import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { completeWebhookEvent, claimWebhookEvent, findWorkspaceByGmailAccount, markIntegrationStatus, recordAuditEvent } from "@/lib/integration-store";
import { syncGmailWorkspace } from "@/lib/gmail-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function webhookError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function authorized(request: Request) {
  const expected = process.env.GMAIL_WEBHOOK_SECRET;
  if (!expected) return process.env.NODE_ENV === "production" ? false : true;
  const url = new URL(request.url);
  const provided = request.headers.get("x-gmail-webhook-token") || url.searchParams.get("token") || (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function decodePayload(body: unknown) {
  if (!body || typeof body !== "object") throw new Error("Gmail webhook payload is invalid.");
  const envelope = body as { message?: { data?: string; messageId?: string }; emailAddress?: string; historyId?: string };
  const data = envelope.message?.data;
  if (!data) return { event: envelope, providerEventId: crypto.createHash("sha256").update(JSON.stringify(envelope)).digest("hex") };
  let event: { emailAddress?: string; historyId?: string };
  try {
    event = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as { emailAddress?: string; historyId?: string };
  } catch {
    throw new Error("Gmail webhook data is not valid base64 JSON.");
  }
  return { event, providerEventId: envelope.message?.messageId || crypto.createHash("sha256").update(data).digest("hex") };
}

export async function POST(request: Request) {
  if (!authorized(request)) return webhookError("Gmail webhook authentication failed.", process.env.GMAIL_WEBHOOK_SECRET ? 401 : 503);
  let body: unknown;
  try { body = await request.json(); } catch { return webhookError("Gmail webhook body must be valid JSON.", 400); }
  try {
    const { event, providerEventId } = decodePayload(body);
    const emailAddress = String(event.emailAddress || "").trim().toLowerCase();
    const historyId = String(event.historyId || "").trim();
    if (!emailAddress || !/^\d+$/.test(historyId)) return webhookError("Gmail webhook is missing emailAddress or historyId.", 400);
    const workspaceId = await findWorkspaceByGmailAccount(emailAddress);
    if (!workspaceId) return new NextResponse(null, { status: 204 });
    const eventId = await claimWebhookEvent({ workspaceId, provider: "gmail", providerEventId, eventType: "history", payload: { emailAddress, historyId } });
    if (!eventId) return NextResponse.json({ ok: true, duplicate: true });
    try {
      const synced = await syncGmailWorkspace(workspaceId, historyId);
      await completeWebhookEvent(eventId, "processed");
      await recordAuditEvent({ workspaceId, actorId: "gmail-pubsub", action: "gmail.webhook_processed", resourceType: "gmail", metadata: { historyId, count: synced.count, insertedCount: synced.insertedCount } });
      return NextResponse.json({ ok: true, count: synced.count });
    } catch (error) {
      await completeWebhookEvent(eventId, "failed", error instanceof Error ? error.message : "Gmail webhook processing failed.");
      await markIntegrationStatus(workspaceId, "gmail", "degraded").catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return webhookError(error instanceof Error ? error.message : "Gmail webhook processing failed.", 500);
  }
}
