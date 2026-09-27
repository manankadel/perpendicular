import "server-only";

import { getGmailMessage, listGmailHistory, listRecentGmailMessages } from "@/lib/gmail";
import { getIntegrationMetadata, listIntegrationSummaries, markIntegrationSynced, updateIntegrationMetadata } from "@/lib/integration-store";
import { upsertGmailMessage } from "@/lib/inbox-store";
import { addActivity, createId, ticketSlaMinutes, timestamp, type Ticket } from "@/lib/domain";
import { updateWorkspace } from "@/lib/server-store";
import { containsUnsubscribeRequest } from "@/lib/compliance";

function emailAddress(value: string) {
  return value.match(/<([^>]+)>/)?.[1]?.toLowerCase() || value.trim().toLowerCase();
}

function latestHistoryId(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => typeof value === "string" && /^\d+$/.test(value)).sort((a, b) => Number(b) - Number(a))[0] || null;
}

export async function syncGmailWorkspace(workspaceId: string, requestedHistoryId?: string | null) {
  const metadata = await getIntegrationMetadata(workspaceId, "gmail");
  let messageIds: string[];
  let historyId = requestedHistoryId || null;
  if (metadata.historyId && requestedHistoryId) {
    try {
      const history = await listGmailHistory(workspaceId, String(metadata.historyId));
      messageIds = history.messageIds;
      historyId = history.historyId || requestedHistoryId;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("history cursor expired")) throw error;
      messageIds = [];
    }
  } else {
    messageIds = [];
  }

  const fullListing = messageIds.length === 0;
  if (fullListing) {
    const listed = await listRecentGmailMessages(workspaceId, 50);
    messageIds = (listed.messages || []).map((message) => message.id);
  }

  const summaries = await listIntegrationSummaries(workspaceId);
  const gmail = summaries.find((integration) => integration.provider === "gmail");
  const repliedEmails = new Set<string>();
  const unsubscribeEmails = new Set<string>();
  const messageHistoryIds: string[] = [];
  const inboundMessages: Array<{ id: string; sender: string; subject: string; bodyText: string; receivedAt: string }> = [];
  let insertedCount = 0;
  for (const messageId of [...new Set(messageIds)]) {
    const message = await getGmailMessage(workspaceId, messageId);
    const sender = emailAddress(message.from);
    const isInbound = sender !== (gmail?.accountEmail || "").toLowerCase();
    const persisted = await upsertGmailMessage({
      workspaceId,
      providerThreadId: message.threadId,
      providerMessageId: message.id,
      direction: isInbound ? "inbound" : "outbound",
      sender,
      recipients: message.to,
      subject: message.subject,
      bodyText: message.bodyText,
      receivedAt: message.date,
      metadata: { messageIdHeader: message.messageIdHeader, historyId: message.historyId },
    });
    if (persisted.inserted) insertedCount += 1;
    if (isInbound) {
      repliedEmails.add(sender);
      if (containsUnsubscribeRequest(message.subject, message.bodyText)) unsubscribeEmails.add(sender);
      if (persisted.inserted) inboundMessages.push({ id: message.id, sender, subject: message.subject, bodyText: message.bodyText, receivedAt: message.date });
    }
    if (message.historyId) messageHistoryIds.push(message.historyId);
  }

  const updated = await updateWorkspace(workspaceId, (workspace) => {
    const existingInboundIds = new Set(workspace.tickets.map((ticket) => ticket.sourceProviderMessageId).filter((id): id is string => Boolean(id)));
    for (const message of inboundMessages) {
      if (existingInboundIds.has(message.id)) continue;
      const priority: Ticket["priority"] = /\b(urgent|outage|down|security)\b/i.test(`${message.subject} ${message.bodyText}`)
        ? "urgent"
        : /\b(blocked|cannot|can't|error|failed|failure)\b/i.test(`${message.subject} ${message.bodyText}`)
          ? "high"
          : "normal";
      const createdAt = message.receivedAt || timestamp();
      const slaDueAt = new Date(Date.now() + 1000 * 60 * ticketSlaMinutes(priority)).toISOString();
      workspace.tickets.unshift({
        id: createId("ticket"),
        subject: message.subject || `Inbound message from ${message.sender}`,
        requester: message.sender,
        message: message.bodyText,
        priority,
        status: "open",
        createdAt,
        slaDueAt,
        assignee: workspace.employees.find((employee) => employee.department === "Support" && employee.status === "live")?.name || "Rhea",
        csat: null,
        requesterEmail: message.sender,
        sourceProviderMessageId: message.id,
        replyDraft: null,
        replyCitations: [],
        replyProviderMessageId: null,
        replySentAt: null,
      });
      addActivity(workspace, { type: "ticket", title: "Inbound Gmail message opened a ticket", detail: `${message.sender} · ${priority} priority · SLA running` });
    }
    for (const list of workspace.lists) for (const row of list.rows) {
      const email = row.email.toLowerCase();
      if (unsubscribeEmails.has(email)) {
        if (!workspace.suppressedEmails.includes(email)) {
          workspace.suppressedEmails.push(email);
          addActivity(workspace, { type: "lead", title: `${row.name} was automatically suppressed`, detail: "Unsubscribe request detected in Gmail · future outbound sends blocked" });
        }
        if (row.enrollmentStatus === "enrolled") {
          row.enrollmentStatus = "replied";
          row.sequenceStatus = "paused";
          row.lastAction = "Unsubscribe request detected in Gmail · sequence paused";
          const sequence = row.sequenceId ? workspace.sequences.find((item) => item.id === row.sequenceId) : undefined;
          if (sequence) sequence.replied += 1;
          addActivity(workspace, { type: "sequence", title: `${row.name} unsubscribed`, detail: "Gmail event persisted · enrollment paused and address suppressed" });
        }
        continue;
      }
      if (!repliedEmails.has(email) || row.enrollmentStatus !== "enrolled") continue;
      row.enrollmentStatus = "replied";
      row.sequenceStatus = "paused";
      row.lastAction = "Reply detected in Gmail · sequence paused";
      const sequence = row.sequenceId ? workspace.sequences.find((item) => item.id === row.sequenceId) : undefined;
      if (sequence) sequence.replied += 1;
      addActivity(workspace, { type: "sequence", title: `${row.name} replied`, detail: "Gmail event persisted · enrollment paused" });
    }
    return workspace;
  });
  const finalHistoryId = latestHistoryId([historyId, ...messageHistoryIds]);
  if (finalHistoryId) await updateIntegrationMetadata(workspaceId, "gmail", { historyId: finalHistoryId });
  await markIntegrationSynced(workspaceId, "gmail");
  return { count: messageIds.length, insertedCount, historyId: finalHistoryId, state: updated };
}
