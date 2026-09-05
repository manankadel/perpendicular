import "server-only";

import { query } from "@/lib/database";
import { randomToken } from "@/lib/security";

export async function upsertGmailMessage(args: {
  workspaceId: string;
  providerThreadId: string;
  providerMessageId: string;
  direction: "inbound" | "outbound";
  sender: string;
  recipients: string[];
  subject: string;
  bodyText: string;
  receivedAt: string;
  metadata?: Record<string, unknown>;
}) {
  const thread = await query<{ id: string }>(
    `insert into perpendicular_inbox_threads
      (id, workspace_id, provider, provider_thread_id, subject, participants, last_message_at, metadata, updated_at)
     values ($1, $2, 'gmail', $3, $4, $5::jsonb, $6, $7::jsonb, now())
     on conflict (workspace_id, provider, provider_thread_id) do update set
       subject = excluded.subject, participants = excluded.participants,
       last_message_at = greatest(perpendicular_inbox_threads.last_message_at, excluded.last_message_at),
       metadata = excluded.metadata, updated_at = now()
     returning id`,
    [randomToken(18), args.workspaceId, args.providerThreadId, args.subject, JSON.stringify([args.sender, ...args.recipients]), args.receivedAt, JSON.stringify(args.metadata || {})],
  );
  const threadId = thread.rows[0]?.id;
  if (!threadId) throw new Error("Could not persist Gmail thread.");
  const message = await query<{ id: string }>(
    `insert into perpendicular_inbox_messages
      (id, workspace_id, thread_id, provider_message_id, direction, sender, recipients, subject, body_text, received_at, metadata)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::jsonb)
     on conflict (workspace_id, provider_message_id) do nothing
     returning id`,
    [randomToken(18), args.workspaceId, threadId, args.providerMessageId, args.direction, args.sender, JSON.stringify(args.recipients), args.subject, args.bodyText.slice(0, 100000), args.receivedAt, JSON.stringify(args.metadata || {})],
  );
  return { threadId, inserted: Boolean(message.rows[0]) };
}

export async function listInboxMessages(workspaceId: string, limit = 50) {
  const result = await query<{
    id: string;
    provider_message_id: string;
    provider_thread_id: string;
    direction: "inbound" | "outbound";
    sender: string;
    recipients: string[];
    subject: string;
    body_text: string;
    received_at: Date;
  }>(
    `select m.id, m.provider_message_id, t.provider_thread_id, m.direction, m.sender, m.recipients, m.subject, m.body_text, m.received_at
     from perpendicular_inbox_messages m join perpendicular_inbox_threads t on t.id = m.thread_id
     where m.workspace_id = $1 order by m.received_at desc limit $2`,
    [workspaceId, Math.min(limit, 100)],
  );
  return result.rows.map((row) => ({ ...row, receivedAt: row.received_at.toISOString() }));
}

