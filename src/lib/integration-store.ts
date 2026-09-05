import "server-only";

import { query, transaction } from "@/lib/database";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "@/lib/security";

export type IntegrationStatus = "not_configured" | "connected" | "degraded" | "disconnected";

export type IntegrationSummary = {
  provider: string;
  status: IntegrationStatus;
  accountEmail: string | null;
  scopes: string[];
  lastSyncAt: string | null;
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
  return result.rows.map((row) => ({
    provider: row.provider,
    status: row.status,
    accountEmail: row.account_email,
    scopes: row.scopes || [],
    lastSyncAt: row.last_sync_at?.toISOString() || null,
  }));
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
     from perpendicular_integrations where workspace_id = $1 and provider = 'gmail' and status = 'connected'`,
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
}

export async function markIntegrationSynced(workspaceId: string, provider: string) {
  await query(
    `update perpendicular_integrations set last_sync_at = now(), updated_at = now()
     where workspace_id = $1 and provider = $2`,
    [workspaceId, provider],
  );
}

export async function disconnectIntegration(workspaceId: string, provider: string) {
  await query(
    `update perpendicular_integrations
     set status = 'disconnected', encrypted_refresh_token = null, updated_at = now()
     where workspace_id = $1 and provider = $2`,
    [workspaceId, provider],
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
      JSON.stringify(args.metadata || {}),
    ],
  );
}

