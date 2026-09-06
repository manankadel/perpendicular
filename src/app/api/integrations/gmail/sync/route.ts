import { NextResponse } from "next/server";
import { getGmailMessage, listRecentGmailMessages } from "@/lib/gmail";
import { listIntegrationSummaries, markIntegrationSynced, recordAuditEvent } from "@/lib/integration-store";
import { upsertGmailMessage } from "@/lib/inbox-store";
import { hasPermission, identityOrResponse, rejectCrossOrigin } from "@/lib/route-auth";
import { updateWorkspace } from "@/lib/server-store";
import { addActivity } from "@/lib/domain";
import { corsHeadersFor, corsJson } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function emailAddress(value: string) {
  return value.match(/<([^>]+)>/)?.[1]?.toLowerCase() || value.trim().toLowerCase();
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "workspace:read")) return NextResponse.json({ error: "You do not have permission to sync Gmail." }, { status: 403 });
  try {
    const listed = await listRecentGmailMessages(identity.context.workspaceId, 50);
    const messages = [];
    for (const item of listed.messages || []) messages.push(await getGmailMessage(identity.context.workspaceId, item.id));
    const gmail = (await listIntegrationSummaries(identity.context.workspaceId)).find((integration) => integration.provider === "gmail");
    const repliedEmails = new Set<string>();
    for (const message of messages) {
      const sender = emailAddress(message.from);
      const isInbound = sender !== (gmail?.accountEmail || "").toLowerCase();
      await upsertGmailMessage({ workspaceId: identity.context.workspaceId, providerThreadId: message.threadId, providerMessageId: message.id, direction: isInbound ? "inbound" : "outbound", sender, recipients: message.to, subject: message.subject, bodyText: message.bodyText, receivedAt: message.date, metadata: { messageIdHeader: message.messageIdHeader } });
      if (isInbound) repliedEmails.add(sender);
    }
    const updated = await updateWorkspace(identity.context.workspaceId, (workspace) => {
      for (const list of workspace.lists) for (const row of list.rows) {
        if (!repliedEmails.has(row.email.toLowerCase()) || row.enrollmentStatus !== "enrolled") continue;
        const sequenceName = row.lastAction?.startsWith("Enrolled in ") ? row.lastAction.slice("Enrolled in ".length) : null;
        row.enrollmentStatus = "replied";
        row.lastAction = "Reply detected in Gmail · sequence paused";
        const sequence = workspace.sequences.find((item) => sequenceName && item.name === sequenceName);
        if (sequence) sequence.replied += 1;
        addActivity(workspace, { type: "sequence", title: `${row.name} replied`, detail: "Gmail event persisted · enrollment paused", });
      }
      return workspace;
    });
    await markIntegrationSynced(identity.context.workspaceId, "gmail");
    await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "gmail.synced", resourceType: "gmail", metadata: { count: messages.length } });
    return corsJson({ ok: true, count: messages.length, state: updated }, undefined, request);
  } catch (error) {
    return corsJson({ error: error instanceof Error ? error.message : "Gmail sync failed." }, { status: 400 }, request);
  }
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
