import "server-only";

import { addActivity, timestamp, type Ticket, type WorkspaceState } from "@/lib/domain";
import { listIntegrationSummaries } from "@/lib/integration-store";
import { GmailSendError, sendGmailMessage } from "@/lib/gmail";
import { upsertGmailMessage } from "@/lib/inbox-store";
import { claimOutboundMessage, markOutboundFailed, markOutboundSent, markOutboundUnknown } from "@/lib/outbound-store";
import { normalizeEmail, outboundSafetyDecision, startOfLocalDay } from "@/lib/outbound-safety";
import { getWorkspace, updateWorkspace } from "@/lib/server-store";

export type TicketReplySendExecution = {
  state: WorkspaceState;
  ticket: Ticket;
  delivery: {
    status: "sent";
    messageId: string | null;
    threadId: string | null;
    inboxRecorded: boolean;
    idempotent?: boolean;
  };
};

function ticketFrom(state: WorkspaceState, ticketId: string) {
  const ticket = state.tickets.find((candidate) => candidate.id === ticketId);
  if (!ticket) throw new Error("Ticket not found.");
  return ticket;
}

function errorWithCode(message: string, code: string) {
  const error = new Error(message) as Error & { code?: string; status?: number };
  error.code = code;
  return error;
}

export async function executeTicketReplySend(args: {
  workspaceId: string;
  ticketId: string;
  body?: string;
  senderEmail?: string;
}): Promise<TicketReplySendExecution> {
  const current = await getWorkspace(args.workspaceId);
  const ticket = ticketFrom(current, args.ticketId);
  if (ticket.replyProviderMessageId) {
    return {
      state: current,
      ticket,
      delivery: { status: "sent", messageId: ticket.replyProviderMessageId, threadId: null, inboxRecorded: false, idempotent: true },
    };
  }

  const recipient = normalizeEmail(String(ticket.requesterEmail || ""));
  const bodyText = String(args.body || ticket.replyDraft || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) throw errorWithCode("Add a valid requester email before sending this reply.", "invalid_recipient");
  if (!bodyText) throw errorWithCode("Draft a reply before sending it.", "missing_draft");
  if (current.suppressedEmails.includes(recipient)) throw errorWithCode("This address is suppressed and cannot receive a ticket reply.", "suppressed_email");
  const safety = outboundSafetyDecision({ settings: current.outboundSafety, email: recipient });
  if (!safety.allowed) throw errorWithCode(safety.reason, safety.code);

  let integrations;
  try {
    integrations = await listIntegrationSummaries(args.workspaceId);
  } catch {
    throw errorWithCode("Gmail connection status is unavailable. Apply the platform database migration.", "integration_unavailable");
  }
  const gmail = integrations.find((integration) => integration.provider === "gmail");
  if (gmail?.status !== "connected") throw errorWithCode("Connect Gmail before sending a ticket reply.", "gmail_required");

  const subject = `Re: ${ticket.subject}`;
  let claimed;
  try {
    claimed = await claimOutboundMessage({
      workspaceId: args.workspaceId,
      idempotencyKey: `ticket-reply:${args.workspaceId}:${args.ticketId}`,
      recipient,
      sequenceId: `ticket-${args.ticketId}`,
      rowId: args.ticketId,
      stepIndex: 0,
      subject,
      bodyText,
      dailyLimit: current.outboundSafety.dailySendLimit,
      dailySince: startOfLocalDay(new Date(), current.outboundSafety.timezone).toISOString(),
    });
  } catch {
    throw errorWithCode("Outbound safety could not be checked because the durable send store is unavailable.", "outbound_store_unavailable");
  }
  if (claimed.kind === "limit") throw errorWithCode(`The workspace daily send limit of ${claimed.limit} has been reached. Try again after the local day resets.`, "daily_limit");
  if (claimed.kind === "blocked") throw errorWithCode(claimed.record.status === "unknown" ? "This reply has an unknown provider outcome. Reconcile it before retrying." : "This reply is already in progress. Refresh before retrying.", "send_in_progress");

  let sent: { id?: string; threadId?: string } = {
    id: claimed.kind === "sent" ? claimed.record.providerMessageId || undefined : undefined,
    threadId: claimed.kind === "sent" ? claimed.record.providerThreadId || undefined : undefined,
  };
  const idempotent = claimed.kind === "sent";
  if (claimed.kind === "claimed") {
    try {
      sent = await sendGmailMessage(args.workspaceId, { to: recipient, subject, body: bodyText });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gmail send failed.";
      if (error instanceof GmailSendError && !error.safeToRetry) await markOutboundUnknown(claimed.record.id, message);
      else await markOutboundFailed(claimed.record.id, message);
      throw error;
    }
    if (!sent.id) {
      await markOutboundUnknown(claimed.record.id, "Gmail returned no message id.");
      throw errorWithCode("Gmail returned no message id. Do not retry until the mailbox is reconciled.", "provider_unknown");
    }
    try {
      await markOutboundSent(claimed.record.id, sent.id, sent.threadId || null);
    } catch (error) {
      await markOutboundUnknown(claimed.record.id, error instanceof Error ? error.message : "The send record could not be completed.").catch(() => undefined);
      throw errorWithCode("Gmail accepted the reply, but Perpendicular could not persist its send record. Do not retry until the mailbox is reconciled.", "send_record_unknown");
    }
  }

  const sentAt = claimed.kind === "sent" ? claimed.record.updatedAt : timestamp();
  const state = await updateWorkspace(args.workspaceId, (workspace) => {
    const liveTicket = ticketFrom(workspace, args.ticketId);
    liveTicket.replyProviderMessageId = sent.id || null;
    liveTicket.replySentAt = sentAt;
    liveTicket.status = "pending";
    if (!idempotent) addActivity(workspace, { type: "ticket", title: `${liveTicket.id} received a Gmail reply`, detail: `${recipient} · human-approved provider send` });
    return workspace;
  });

  let inboxRecorded = false;
  if (sent.threadId && sent.id) {
    try {
      await upsertGmailMessage({
        workspaceId: args.workspaceId,
        providerThreadId: sent.threadId,
        providerMessageId: sent.id,
        direction: "outbound",
        sender: gmail.accountEmail || args.senderEmail || "",
        recipients: [recipient],
        subject,
        bodyText,
        receivedAt: sentAt,
        metadata: { ticketId: args.ticketId },
      });
      inboxRecorded = true;
    } catch {
      // Provider delivery and the durable outbound record remain authoritative when indexing is unavailable.
    }
  }
  return {
    state,
    ticket: ticketFrom(state, args.ticketId),
    delivery: { status: "sent", messageId: sent.id || null, threadId: sent.threadId || null, inboxRecorded, ...(idempotent ? { idempotent: true } : {}) },
  };
}
