import { corsHeadersFor, corsJson } from "@/lib/cors";
import { completeWebhookEvent, claimWebhookReplay, listWebhookEvents, recordAuditEvent } from "@/lib/integration-store";
import { syncGmailWorkspace } from "@/lib/gmail-sync";
import { listDeadLetterJobs, retryDeadLetterJob } from "@/lib/job-store";
import { hasPermission, identityOrResponse, rejectCrossOrigin } from "@/lib/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "settings:read")) return corsJson({ error: "You do not have permission to view operations." }, { status: 403 }, request);
  try {
    const [webhooks, deadLetterJobs] = await Promise.all([
      listWebhookEvents(identity.context.workspaceId),
      listDeadLetterJobs(identity.context.workspaceId),
    ]);
    return corsJson({ webhooks, deadLetterJobs }, undefined, request);
  } catch {
    return corsJson({ error: "Operations storage is not ready. Apply the platform database migrations." }, { status: 503 }, request);
  }
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "settings:write")) return corsJson({ error: "You do not have permission to replay operations." }, { status: 403 }, request);
  let body: { action?: string; id?: string };
  try {
    body = await request.json() as { action?: string; id?: string };
  } catch {
    return corsJson({ error: "Request body must be valid JSON." }, { status: 400 }, request);
  }
  const id = String(body.id || "").trim();
  if (!id) return corsJson({ error: "An operation ID is required." }, { status: 400 }, request);

  if (body.action === "retry-job") {
    const retried = await retryDeadLetterJob(identity.context.workspaceId, id);
    if (!retried) return corsJson({ error: "Dead-letter job not found." }, { status: 404 }, request);
    await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "job.retried", resourceType: "job", resourceId: id });
    return corsJson({ ok: true, action: "retry-job", id }, undefined, request);
  }

  if (body.action !== "replay-webhook") return corsJson({ error: "Unknown operations action." }, { status: 400 }, request);
  const event = await claimWebhookReplay(identity.context.workspaceId, id);
  if (!event) return corsJson({ error: "Webhook not found, already in progress, or not replayable." }, { status: 409 }, request);
  if (event.provider !== "gmail" || event.event_type !== "history") {
    await completeWebhookEvent(event.id, "failed", "This provider event has no replay adapter.");
    return corsJson({ error: "This provider event has no replay adapter." }, { status: 400 }, request);
  }
  const historyId = String(event.payload.historyId || "");
  if (!/^\d+$/.test(historyId)) {
    await completeWebhookEvent(event.id, "failed", "Webhook payload has no valid Gmail historyId.");
    return corsJson({ error: "Webhook payload has no valid Gmail historyId." }, { status: 400 }, request);
  }
  try {
    const synced = await syncGmailWorkspace(identity.context.workspaceId, historyId);
    await completeWebhookEvent(event.id, "processed");
    await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "webhook.replayed", resourceType: "webhook", resourceId: id, metadata: { provider: event.provider, historyId, insertedCount: synced.insertedCount } });
    return corsJson({ ok: true, action: "replay-webhook", id, count: synced.count, insertedCount: synced.insertedCount }, undefined, request);
  } catch (error) {
    await completeWebhookEvent(event.id, "failed", error instanceof Error ? error.message : "Webhook replay failed.");
    return corsJson({ error: error instanceof Error ? error.message : "Webhook replay failed." }, { status: 400 }, request);
  }
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
