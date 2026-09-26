import "server-only";

import { query, transaction } from "@/lib/database";
import { randomToken } from "@/lib/security";

export type OutboundMessageStatus = "sending" | "sent" | "failed" | "unknown";

export type OutboundMessageRecord = {
  id: string;
  workspaceId: string;
  idempotencyKey: string;
  provider: string;
  recipient: string;
  sequenceId: string;
  rowId: string;
  stepIndex: number;
  subject: string;
  bodyText: string;
  status: OutboundMessageStatus;
  providerMessageId: string | null;
  providerThreadId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type OutboundRow = {
  id: string;
  workspace_id: string;
  idempotency_key: string;
  provider: string;
  recipient: string;
  sequence_id: string;
  row_id: string;
  step_index: number;
  subject: string;
  body_text: string;
  status: OutboundMessageStatus;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

function mapOutbound(row: OutboundRow): OutboundMessageRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    recipient: row.recipient,
    sequenceId: row.sequence_id,
    rowId: row.row_id,
    stepIndex: row.step_index,
    subject: row.subject,
    bodyText: row.body_text,
    status: row.status,
    providerMessageId: row.provider_message_id,
    providerThreadId: row.provider_thread_id,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export type ClaimOutboundResult =
  | { kind: "claimed"; record: OutboundMessageRecord }
  | { kind: "sent"; record: OutboundMessageRecord }
  | { kind: "blocked"; record: OutboundMessageRecord }
  | { kind: "limit"; count: number; limit: number };

export async function claimOutboundMessage(args: {
  workspaceId: string;
  idempotencyKey: string;
  recipient: string;
  sequenceId: string;
  rowId: string;
  stepIndex: number;
  subject: string;
  bodyText: string;
  dailyLimit?: number;
  dailySince?: string;
}): Promise<ClaimOutboundResult> {
  return transaction(async (client) => {
    if (args.dailyLimit && args.dailySince) {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 5))", [args.workspaceId]);
    }
    const existing = await client.query<OutboundRow>(
      `select id, workspace_id, idempotency_key, provider, recipient, sequence_id, row_id, step_index, subject, body_text, status, provider_message_id, provider_thread_id, error, created_at, updated_at
       from perpendicular_outbound_messages where idempotency_key = $1 for update`,
      [args.idempotencyKey],
    );
    const existingRow = existing.rows[0];
    if (existingRow) {
      const record = mapOutbound(existingRow);
      if (record.status === "sent") return { kind: "sent", record };
      if (record.status === "failed") {
        if (args.dailyLimit && args.dailySince) {
          const countResult = await client.query<{ count: string }>(
            `select count(*)::text as count from perpendicular_outbound_messages
             where workspace_id = $1 and status = 'sent' and updated_at >= $2`,
            [args.workspaceId, args.dailySince],
          );
          const count = Number(countResult.rows[0]?.count || 0);
          if (count >= args.dailyLimit) return { kind: "limit", count, limit: args.dailyLimit };
        }
        const retried = await client.query<OutboundRow>(
          `update perpendicular_outbound_messages
           set status = 'sending', error = null, updated_at = now()
           where id = $1
           returning id, workspace_id, idempotency_key, provider, recipient, sequence_id, row_id, step_index, subject, body_text, status, provider_message_id, provider_thread_id, error, created_at, updated_at`,
          [record.id],
        );
        if (retried.rows[0]) return { kind: "claimed", record: mapOutbound(retried.rows[0]) };
      }
      return { kind: "blocked", record };
    }
    if (args.dailyLimit && args.dailySince) {
      const countResult = await client.query<{ count: string }>(
        `select count(*)::text as count from perpendicular_outbound_messages
         where workspace_id = $1 and status = 'sent' and updated_at >= $2`,
        [args.workspaceId, args.dailySince],
      );
      const count = Number(countResult.rows[0]?.count || 0);
      if (count >= args.dailyLimit) return { kind: "limit", count, limit: args.dailyLimit };
    }
    const inserted = await client.query<OutboundRow>(
      `insert into perpendicular_outbound_messages
        (id, workspace_id, idempotency_key, provider, recipient, sequence_id, row_id, step_index, subject, body_text, status)
       values ($1, $2, $3, 'gmail', $4, $5, $6, $7, $8, $9, 'sending')
       on conflict (idempotency_key) do nothing
       returning id, workspace_id, idempotency_key, provider, recipient, sequence_id, row_id, step_index, subject, body_text, status, provider_message_id, provider_thread_id, error, created_at, updated_at`,
      [randomToken(18), args.workspaceId, args.idempotencyKey, args.recipient, args.sequenceId, args.rowId, args.stepIndex, args.subject, args.bodyText],
    );
    if (inserted.rows[0]) return { kind: "claimed", record: mapOutbound(inserted.rows[0]) };
    const row = (await client.query<OutboundRow>(
      `select id, workspace_id, idempotency_key, provider, recipient, sequence_id, row_id, step_index, subject, body_text, status, provider_message_id, provider_thread_id, error, created_at, updated_at
       from perpendicular_outbound_messages where idempotency_key = $1 for update`,
      [args.idempotencyKey],
    )).rows[0];
    if (!row) throw new Error("The outbound send record disappeared. Refresh and try again.");
    const record = mapOutbound(row);
    if (record.status === "sent") return { kind: "sent", record };
    if (record.status === "failed") {
      if (args.dailyLimit && args.dailySince) {
        const countResult = await client.query<{ count: string }>(
          `select count(*)::text as count from perpendicular_outbound_messages
           where workspace_id = $1 and status = 'sent' and updated_at >= $2`,
          [args.workspaceId, args.dailySince],
        );
        const count = Number(countResult.rows[0]?.count || 0);
        if (count >= args.dailyLimit) return { kind: "limit", count, limit: args.dailyLimit };
      }
      const retried = await client.query<OutboundRow>(
        `update perpendicular_outbound_messages
         set status = 'sending', error = null, updated_at = now()
         where id = $1
         returning id, workspace_id, idempotency_key, provider, recipient, sequence_id, row_id, step_index, subject, body_text, status, provider_message_id, provider_thread_id, error, created_at, updated_at`,
        [record.id],
      );
      if (retried.rows[0]) return { kind: "claimed", record: mapOutbound(retried.rows[0]) };
    }
    return { kind: "blocked", record };
  });
}

export async function countSentOutboundMessagesSince(workspaceId: string, since: string) {
  const result = await query<{ count: string }>(
    `select count(*)::text as count from perpendicular_outbound_messages
     where workspace_id = $1 and status = 'sent' and updated_at >= $2`,
    [workspaceId, since],
  );
  return Number(result.rows[0]?.count || 0);
}

export async function markOutboundSent(id: string, providerMessageId: string, providerThreadId: string | null) {
  const result = await query<OutboundRow>(
    `update perpendicular_outbound_messages
     set status = 'sent', provider_message_id = $2, provider_thread_id = $3, error = null, updated_at = now()
     where id = $1
     returning id, workspace_id, idempotency_key, provider, recipient, sequence_id, row_id, step_index, subject, body_text, status, provider_message_id, provider_thread_id, error, created_at, updated_at`,
    [id, providerMessageId, providerThreadId],
  );
  if (!result.rows[0]) throw new Error("The outbound send record could not be completed.");
  return mapOutbound(result.rows[0]);
}

export async function markOutboundFailed(id: string, error: string) {
  await query(
    `update perpendicular_outbound_messages set status = 'failed', error = $2, updated_at = now() where id = $1 and status = 'sending'`,
    [id, error.slice(0, 2000)],
  );
}

export async function markOutboundUnknown(id: string, error: string) {
  await query(
    `update perpendicular_outbound_messages set status = 'unknown', error = $2, updated_at = now() where id = $1 and status = 'sending'`,
    [id, error.slice(0, 2000)],
  );
}
