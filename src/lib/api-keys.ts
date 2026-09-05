import { query } from "@/lib/database";
import { randomToken, sha256 } from "@/lib/security";

export type ApiKeyRecord = {
  id: string;
  workspaceId: string;
  createdBy: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

export async function createApiKey(args: { workspaceId: string; createdBy: string; name: string; scopes: string[] }) {
  const secret = `pp_live_${randomToken(32)}`;
  const id = `key_${randomToken(12)}`;
  await query(
    `insert into perpendicular_api_keys
      (id, workspace_id, created_by, name, key_prefix, key_hash, scopes)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, args.workspaceId, args.createdBy, args.name, secret.slice(0, 18), sha256(secret), args.scopes],
  );
  return { id, secret };
}

export async function listApiKeys(workspaceId: string): Promise<ApiKeyRecord[]> {
  const result = await query<{
    id: string;
    workspace_id: string;
    created_by: string;
    name: string;
    key_prefix: string;
    scopes: string[];
    created_at: Date;
    last_used_at: Date | null;
  }>(
    `select id, workspace_id, created_by, name, key_prefix, scopes, created_at, last_used_at
     from perpendicular_api_keys where workspace_id = $1 and revoked_at is null order by created_at desc`,
    [workspaceId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes || [],
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() || null,
  }));
}

export async function revokeApiKey(workspaceId: string, id: string) {
  const result = await query(
    `update perpendicular_api_keys set revoked_at = now()
     where id = $1 and workspace_id = $2 and revoked_at is null`,
    [id, workspaceId],
  );
  return result.rowCount === 1;
}

export async function authenticateApiKey(secret: string) {
  const result = await query<{
    id: string;
    workspace_id: string;
    scopes: string[];
  }>(
    `update perpendicular_api_keys set last_used_at = now()
     where key_hash = $1 and revoked_at is null
     returning id, workspace_id, scopes`,
    [sha256(secret)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, workspaceId: row.workspace_id, scopes: row.scopes || [] };
}
