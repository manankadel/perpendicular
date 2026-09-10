import "server-only";

import { query, transaction } from "@/lib/database";
import { decryptSecret, encryptSecret, randomToken, redactAuditMetadata, sha256 } from "@/lib/security";

export type IntegrationStatus = "not_configured" | "connected" | "degraded" | "disconnected";

export type IntegrationSummary = {
  provider: string;
  status: IntegrationStatus;
  accountEmail: string | null;
  scopes: string[];
  lastSyncAt: string | null;
  health: IntegrationHealthEvent[];
};

export type IntegrationHealthEvent = {
  status: IntegrationStatus;
  eventType: string;
  detail: string;
  createdAt: string;
};

type OAuthState = {
  workspaceId: string;
  userId: string;
  provider: string;
  codeVerifier: string;
};

type GmailConnection = {
  id: string;
  workspaceId: string;
  accountEmail: string;
  providerAccountId: string;
  encryptedRefreshToken: string;
  scopes: string[];
};

export async function listIntegrationSummaries(workspaceId: string): Promise<IntegrationSummary[]> {
  const result = await query<{
    provider: string;
    status: IntegrationStatus;
    account_email: string | null;
    scopes: string[];
    last_sync_at: Date | null;
  }>(
    `select provider, status, account_email, scopes, last_sync_at
     from perpendicular_integrations where workspace_id = $1 order by provider`,
    [workspaceId],
  );
  return Promise.all(result.rows.map(async (row) => ({
    provider: row.provider,
    status: row.status,
    accountEmail: row.account_email,
    scopes: row.scopes || [],
    lastSyncAt: row.last_sync_at?.toISOString() || null,
    health: await listIntegrationHealth(workspaceId, row.provider),
  })));
}

export async function createOAuthState(workspaceId: string, userId: string, provider: string, codeVerifier: string) {
  const state = randomToken(32);
  await query(
    `insert into perpendicular_oauth_states
      (state_hash, workspace_id, user_id, provider, code_verifier, expires_at)
     values ($1, $2, $3, $4, $5, now() + interval '10 minutes')`,
    [sha256(state), workspaceId, userId, provider, codeVerifier],
  );
  return state;
}

export async function consumeOAuthState(state: string, provider: string): Promise<OAuthState> {
  const result = await transaction(async (client) => {
    const found = await client.query<{
      workspace_id: string;
      user_id: string;
      provider: string;
      code_verifier: string;
    }>(
      `delete from perpendicular_oauth_states
       where state_hash = $1 and provider = $2 and expires_at > now() and consumed_at is null
       returning workspace_id, user_id, provider, code_verifier`,
      [sha256(state), provider],
    );
    return found.rows[0] || null;
  });
  if (!result) throw new Error("OAuth state is invalid or expired.");
  return {
    workspaceId: result.workspace_id,
    userId: result.user_id,
    provider: result.provider,
    codeVerifier: result.code_verifier,
  };
}

export async function saveGmailConnection(args: {
  workspaceId: string;
  accountEmail: string;
  providerAccountId: string;
  refreshToken: string;
  scopes: string[];
}) {
  const encrypted = encryptSecret(args.refreshToken);
  await query(
    `insert into perpendicular_integrations
      (id, workspace_id, provider, status, account_email, provider_account_id, encrypted_refresh_token, scopes, metadata, updated_at)
     values ($1, $2, 'gmail', 'connected', $3, $4, $5, $6, '{}'::jsonb, now())
     on conflict (workspace_id, provider) do update set
       status = 'connected', account_email = excluded.account_email,
       provider_account_id = excluded.provider_account_id,
       encrypted_refresh_token = excluded.encrypted_refresh_token,
       scopes = excluded.scopes, updated_at = now()`,
    [randomToken(18), args.workspaceId, args.accountEmail, args.providerAccountId, encrypted, args.scopes],
  );
  await recordIntegrationHealth(args.workspaceId, "gmail", "connected", "oauth_connected", "Gmail OAuth connection persisted.");
}

export async function getGmailConnection(workspaceId: string): Promise<GmailConnection | null> {
  const result = await query<{
    id: string;
    workspace_id: string;
    account_email: string | null;
    provider_account_id: string | null;
    encrypted_refresh_token: string | null;
    scopes: string[];
  }>(
    `select id, workspace_id, account_email, provider_account_id, encrypted_refresh_token, scopes
     from perpendicular_integrations where workspace_id = $1 and provider = 'gmail' and status in ('connected', 'degraded')`,
    [workspaceId],
  );
  const row = result.rows[0];
  if (!row?.account_email || !row.provider_account_id || !row.encrypted_refresh_token) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountEmail: row.account_email,
    providerAccountId: row.provider_account_id,
    encryptedRefreshToken: decryptSecret(row.encrypted_refresh_token),
    scopes: row.scopes || [],
  };
}

export async function markIntegrationStatus(workspaceId: string, provider: string, status: IntegrationStatus) {
  await query(
    `update perpendicular_integrations set status = $1, updated_at = now()
     where workspace_id = $2 and provider = $3`,
    [status, workspaceId, provider],
  );
  await recordIntegrationHealth(workspaceId, provider, status, "status_changed", `Integration status changed to ${status}.`);
}

export async function markIntegrationSynced(workspaceId: string, provider: string) {
  await query(
    `update perpendicular_integrations set status = 'connected', last_sync_at = now(), updated_at = now()
     where workspace_id = $1 and provider = $2`,
    [workspaceId, provider],
  );
  await recordIntegrationHealth(workspaceId, provider, "connected", "sync_succeeded", "Mailbox synchronization completed.");
}

export async function disconnectIntegration(workspaceId: string, provider: string) {
  await query(
    `update perpendicular_integrations
     set status = 'disconnected', encrypted_refresh_token = null, updated_at = now()
     where workspace_id = $1 and provider = $2`,
    [workspaceId, provider],
  );
  await recordIntegrationHealth(workspaceId, provider, "disconnected", "disconnected", "Integration disconnected by the workspace operator.");
}

export async function updateIntegrationMetadata(workspaceId: string, provider: string, metadata: Record<string, unknown>) {
  await query(
    `update perpendicular_integrations
     set metadata = coalesce(metadata, '{}'::jsonb) || $1::jsonb, updated_at = now()
     where workspace_id = $2 and provider = $3`,
    [JSON.stringify(metadata), workspaceId, provider],
  );
}

export async function getIntegrationMetadata(workspaceId: string, provider: string) {
  const result = await query<{ metadata: Record<string, unknown> | null }>(
    `select metadata from perpendicular_integrations where workspace_id = $1 and provider = $2`,
    [workspaceId, provider],
  );
  return result.rows[0]?.metadata || {};
}

export async function listIntegrationHealth(workspaceId: string, provider: string, limit = 12): Promise<IntegrationHealthEvent[]> {
  const result = await query<{
    status: IntegrationStatus;
    event_type: string;
    detail: string;
    created_at: Date;
  }>(
    `select status, event_type, detail, created_at
     from perpendicular_integration_health
     where workspace_id = $1 and provider = $2
     order by created_at desc limit $3`,
    [workspaceId, provider, Math.min(limit, 50)],
  );
  return result.rows.map((row) => ({ status: row.status, eventType: row.event_type, detail: row.detail, createdAt: row.created_at.toISOString() }));
}

export async function recordIntegrationHealth(workspaceId: string, provider: string, status: IntegrationStatus, eventType: string, detail: string) {
  await query(
    `insert into perpendicular_integration_health (id, workspace_id, provider, status, event_type, detail)
     values ($1, $2, $3, $4, $5, $6)`,
    [randomToken(18), workspaceId, provider, status, eventType, detail.slice(0, 500)],
  );
}

export async function findWorkspaceByGmailAccount(accountEmail: string) {
  const result = await query<{ workspace_id: string }>(
    `select workspace_id from perpendicular_integrations
     where provider = 'gmail' and lower(account_email) = lower($1) and status in ('connected', 'degraded')
     order by updated_at desc limit 1`,
    [accountEmail],
  );
  return result.rows[0]?.workspace_id || null;
}

export async function claimWebhookEvent(args: { workspaceId: string; provider: string; providerEventId: string; eventType: string; payload: Record<string, unknown> }) {
  return transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into perpendicular_webhook_events
        (id, workspace_id, provider, provider_event_id, event_type, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb)
       on conflict (provider, provider_event_id) do nothing
       returning id`,
      [randomToken(18), args.workspaceId, args.provider, args.providerEventId, args.eventType, JSON.stringify(args.payload)],
    );
    if (inserted.rows[0]?.id) return inserted.rows[0].id;
    const existing = await client.query<{ id: string; status: "received" | "processed" | "failed"; created_at: Date }>(
      `select id, status, created_at from perpendicular_webhook_events
       where provider = $1 and provider_event_id = $2 for update`,
      [args.provider, args.providerEventId],
    );
    const row = existing.rows[0];
    if (!row || row.status === "processed") return null;
    if (row.status === "received" && Date.now() - row.created_at.getTime() < 10 * 60_000) return null;
    const reclaimed = await client.query<{ id: string }>(
      `update perpendicular_webhook_events
       set status = 'received', error = null, processed_at = null, payload = $2::jsonb
       where id = $1 and (status = 'failed' or (status = 'received' and created_at < now() - interval '10 minutes'))
       returning id`,
      [row.id, JSON.stringify(args.payload)],
    );
    return reclaimed.rows[0]?.id || null;
  });
}

export async function completeWebhookEvent(id: string, status: "processed" | "failed", error?: string) {
  await query(
    `update perpendicular_webhook_events
     set status = $2, error = $3, processed_at = now()
     where id = $1`,
    [id, status, error ? error.slice(0, 2000) : null],
  );
}

export async function recordAuditEvent(args: {
  workspaceId: string;
  actorId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}) {
  await query(
    `insert into perpendicular_audit_events
      (id, workspace_id, actor_id, action, resource_type, resource_id, metadata)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      randomToken(18),
      args.workspaceId,
      args.actorId,
      args.action,
      args.resourceType || null,
      args.resourceId || null,
      JSON.stringify(redactAuditMetadata(args.metadata || {})),
    ],
  );
}
