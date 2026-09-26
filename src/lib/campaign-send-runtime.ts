import "server-only";

import { addActivity, timestamp, type Campaign, type SmartRow, type WorkspaceState } from "@/lib/domain";
import { listIntegrationSummaries } from "@/lib/integration-store";
import { GmailSendError, sendGmailMessage } from "@/lib/gmail";
import { upsertGmailMessage } from "@/lib/inbox-store";
import { claimOutboundMessage, markOutboundFailed, markOutboundSent, markOutboundUnknown } from "@/lib/outbound-store";
import { normalizeEmail, outboundSafetyDecision, startOfLocalDay } from "@/lib/outbound-safety";
import { getWorkspace, updateWorkspace } from "@/lib/server-store";

export type CampaignBroadcastExecution = {
  state: WorkspaceState;
  campaign: Campaign;
  delivery: {
    status: "completed";
    total: number;
    sent: number;
    skipped: number;
    failed: number;
    idempotent: boolean;
  };
};

function campaignFrom(state: WorkspaceState, campaignId: string) {
  const campaign = state.campaigns.find((candidate) => candidate.id === campaignId);
  if (!campaign) throw new Error("Campaign not found.");
  return campaign;
}

function listRows(state: WorkspaceState, campaign: Campaign) {
  if (!campaign.listId) throw new Error("Choose a Smart List before sending a broadcast.");
  const list = state.lists.find((candidate) => candidate.id === campaign.listId);
  if (!list) throw new Error("Campaign Smart List not found.");
  const rows = list.rows.filter((row) => row.status === "enriched" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizeEmail(row.email)));
  if (!rows.length) throw new Error("The selected Smart List has no enriched rows with valid email addresses.");
  return rows;
}

function render(value: string, row: SmartRow) {
  return value
    .replaceAll("{{name}}", row.name)
    .replaceAll("{{firstName}}", row.name.split(/\s+/)[0] || row.name)
    .replaceAll("{{company}}", row.company)
    .replaceAll("{{companyName}}", row.company)
    .replaceAll("{{role}}", row.role || "")
    .replaceAll("{{email}}", row.email);
}

function errorWithCode(message: string, code: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

export async function executeCampaignBroadcast(args: {
  workspaceId: string;
  campaignId: string;
  senderEmail?: string;
}): Promise<CampaignBroadcastExecution> {
  const current = await getWorkspace(args.workspaceId);
  const campaign = campaignFrom(current, args.campaignId);
  if (campaign.type !== "broadcast") throw new Error("Only broadcast campaigns can send through Gmail.");
  if (campaign.status === "scheduled" || campaign.status === "running") throw errorWithCode("This campaign is scheduled for native publication and cannot be sent as a broadcast.", "campaign_in_progress");
  const subject = String(campaign.subject || "").trim();
  const body = String(campaign.body || "").trim();
  if (!subject || !body) throw new Error("Add a subject and body before sending this broadcast.");
  const rows = listRows(current, campaign);
  let integrations;
  try {
    integrations = await listIntegrationSummaries(args.workspaceId);
  } catch {
    throw errorWithCode("Gmail connection status is unavailable. Apply the platform database migration.", "integration_unavailable");
  }
  const gmail = integrations.find((integration) => integration.provider === "gmail");
  if (gmail?.status !== "connected") throw errorWithCode("Connect Gmail before sending a broadcast.", "gmail_required");

  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let idempotent = true;
  for (const row of rows) {
    const recipient = normalizeEmail(row.email);
    if (current.suppressedEmails.includes(recipient)) { skippedCount += 1; continue; }
    const safety = outboundSafetyDecision({ settings: current.outboundSafety, email: recipient });
    if (!safety.allowed) { skippedCount += 1; continue; }
    const renderedSubject = render(subject, row);
    const renderedBody = render(body, row);
    let claimed;
    try {
      claimed = await claimOutboundMessage({
        workspaceId: args.workspaceId,
        idempotencyKey: `campaign-broadcast:${args.workspaceId}:${campaign.id}:${row.id}`,
        recipient,
        sequenceId: campaign.id,
        rowId: row.id,
        stepIndex: 0,
        subject: renderedSubject,
        bodyText: renderedBody,
        dailyLimit: current.outboundSafety.dailySendLimit,
        dailySince: startOfLocalDay(new Date(), current.outboundSafety.timezone).toISOString(),
      });
    } catch {
      failedCount += 1;
      continue;
    }
    if (claimed.kind === "limit") {
      skippedCount += rows.length - sentCount - skippedCount - failedCount;
      break;
    }
    if (claimed.kind === "blocked") {
      if (claimed.record.status === "unknown") failedCount += 1;
      else skippedCount += 1;
      continue;
    }
    if (claimed.kind === "sent") {
      sentCount += 1;
      continue;
    }
    idempotent = false;
    let sent: { id?: string; threadId?: string };
    try {
      sent = await sendGmailMessage(args.workspaceId, { to: recipient, subject: renderedSubject, body: renderedBody });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gmail send failed.";
      if (error instanceof GmailSendError && !error.safeToRetry) await markOutboundUnknown(claimed.record.id, message);
      else await markOutboundFailed(claimed.record.id, message);
      failedCount += 1;
      continue;
    }
    if (!sent.id) {
      await markOutboundUnknown(claimed.record.id, "Gmail returned no message id.");
      failedCount += 1;
      continue;
    }
    try {
      await markOutboundSent(claimed.record.id, sent.id, sent.threadId || null);
    } catch {
      await markOutboundUnknown(claimed.record.id, "The send record could not be completed.").catch(() => undefined);
      failedCount += 1;
      continue;
    }
    sentCount += 1;
    if (sent.threadId) {
      try {
        await upsertGmailMessage({ workspaceId: args.workspaceId, providerThreadId: sent.threadId, providerMessageId: sent.id, direction: "outbound", sender: gmail.accountEmail || args.senderEmail || "", recipients: [recipient], subject: renderedSubject, bodyText: renderedBody, receivedAt: timestamp(), metadata: { campaignId: campaign.id, rowId: row.id } });
      } catch {
        // Provider delivery and the outbound record remain authoritative if inbox indexing is unavailable.
      }
    }
  }

  const result = `${sentCount} sent · ${skippedCount} skipped · ${failedCount} failed`;
  const state = await updateWorkspace(args.workspaceId, (workspace) => {
    const liveCampaign = campaignFrom(workspace, campaign.id);
    liveCampaign.status = "completed";
    liveCampaign.lastRunAt = timestamp();
    liveCampaign.lastResult = result;
    liveCampaign.updatedAt = timestamp();
    addActivity(workspace, { type: "content", title: `${liveCampaign.name} broadcast completed`, detail: `${result} · Gmail human-triggered send` });
    return workspace;
  });
  return { state, campaign: campaignFrom(state, campaign.id), delivery: { status: "completed", total: rows.length, sent: sentCount, skipped: skippedCount, failed: failedCount, idempotent } };
}
