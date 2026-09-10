import "server-only";

import { getGmailMessage, listGmailHistory, listRecentGmailMessages } from "@/lib/gmail";
import { getIntegrationMetadata, listIntegrationSummaries, markIntegrationSynced, updateIntegrationMetadata } from "@/lib/integration-store";
import { upsertGmailMessage } from "@/lib/inbox-store";
import { addActivity } from "@/lib/domain";
import { updateWorkspace } from "@/lib/server-store";

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
  const messageHistoryIds: string[] = [];
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
    if (isInbound) repliedEmails.add(sender);
    if (message.historyId) messageHistoryIds.push(message.historyId);
  }

  const updated = await updateWorkspace(workspaceId, (workspace) => {
    for (const list of workspace.lists) for (const row of list.rows) {
      if (!repliedEmails.has(row.email.toLowerCase()) || row.enrollmentStatus !== "enrolled") continue;
      const sequenceName = row.lastAction?.startsWith("Enrolled in ") ? row.lastAction.slice("Enrolled in ".length) : null;
      row.enrollmentStatus = "replied";
      row.lastAction = "Reply detected in Gmail · sequence paused";
      const sequence = workspace.sequences.find((item) => sequenceName && item.name === sequenceName);
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
