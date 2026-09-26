import { NextResponse } from "next/server";
import { databaseConfigured, getDatabase } from "@/lib/database";
import { corsHeadersFor } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requiredTables = [
  "perpendicular_workspace_state",
  "perpendicular_integrations",
  "perpendicular_oauth_states",
  "perpendicular_api_keys",
  "perpendicular_audit_events",
  "perpendicular_jobs",
  "perpendicular_inbox_threads",
  "perpendicular_inbox_messages",
  "perpendicular_webhook_events",
  "perpendicular_integration_health",
  "perpendicular_usage_ledger",
  "perpendicular_outbound_messages",
  "perpendicular_rate_limits",
] as const;

type OllamaReadiness = {
  ok: boolean;
  model: string;
  reason?: string;
};

async function checkOllamaReadiness(): Promise<OllamaReadiness> {
  if (process.env.DISABLE_OLLAMA === "true") return { ok: false, model: "disabled", reason: "ollama_disabled" };
  const baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL || "qwen2.5:3b";
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    if (!response.ok) return { ok: false, model, reason: `ollama_http_${response.status}` };
    const payload = await response.json() as { models?: Array<{ name?: string }> };
    const available = (payload.models || []).map((entry) => entry.name || "").filter(Boolean);
    if (!available.some((candidate) => candidate === model || candidate.startsWith(`${model}:`))) {
      return { ok: false, model, reason: "ollama_model_missing" };
    }
    return { ok: true, model };
  } catch {
    return { ok: false, model, reason: "ollama_unreachable" };
  }
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}

export async function GET(request: Request) {
  const database = await getDatabase();
  const production = process.env.NODE_ENV === "production";
  const ollama = await checkOllamaReadiness();
  const gmailOAuthConfigured = Boolean(
    (process.env.GOOGLE_GMAIL_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID)
      && (process.env.GOOGLE_GMAIL_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET),
  );
  const gmailPushConfigured = Boolean(!process.env.GMAIL_PUBSUB_TOPIC || process.env.GMAIL_WEBHOOK_SECRET);
  const integrationEncryptionConfigured = Boolean(process.env.INTEGRATION_ENCRYPTION_KEY);
  const backupOffsiteConfigured = Boolean(process.env.PERPENDICULAR_BACKUP_REMOTE);
  const configurationGaps = [
    !gmailOAuthConfigured ? "gmail_oauth" : null,
    !gmailPushConfigured ? "gmail_webhook_secret" : null,
    !integrationEncryptionConfigured ? "integration_encryption_key" : null,
    production && !ollama.ok ? ollama.reason : null,
  ].filter((gap): gap is string => Boolean(gap));
  let schema: { ok: boolean; missingTables: string[] } | null = null;
  if (database) {
    try {
      const result = await database.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])",
        [requiredTables],
      );
      const present = new Set(result.rows.map((row) => row.table_name));
      const missingTables = requiredTables.filter((table) => !present.has(table));
      schema = { ok: missingTables.length === 0, missingTables };
    } catch {
      schema = { ok: false, missingTables: [...requiredTables] };
    }
  }
  const databaseOk = Boolean(database) && databaseConfigured();
  const ok = databaseOk && (schema?.ok ?? false) && ollama.ok;
  let operations: { deadLetterJobs: number; failedWebhooks: number; degradedIntegrations: number } | null = null;
  if (database) {
    try {
      const result = await database.query<{ dead_letter_jobs: string; failed_webhooks: string; degraded_integrations: string }>(
        `select
           (select count(*) from perpendicular_jobs where status = 'dead_letter')::text as dead_letter_jobs,
           (select count(*) from perpendicular_webhook_events where status = 'failed')::text as failed_webhooks,
           (select count(*) from perpendicular_integrations where status = 'degraded')::text as degraded_integrations`,
      );
      const row = result.rows[0];
      operations = row ? {
        deadLetterJobs: Number(row.dead_letter_jobs),
        failedWebhooks: Number(row.failed_webhooks),
        degradedIntegrations: Number(row.degraded_integrations),
      } : null;
    } catch {
      operations = null;
    }
  }
  return NextResponse.json({
    ok: production ? ok : true,
    service: "perpendicular-api",
    database: databaseOk ? "connected" : databaseConfigured() ? "unavailable" : "not_configured",
    schema,
    model: ollama.ok ? `ollama:${ollama.model}` : `ollama:${ollama.model} · ${ollama.reason}`,
    version: process.env.PERPENDICULAR_BUILD_SHA || process.env.npm_package_version || "unknown",
    configuration: {
      ok: configurationGaps.length === 0,
      gaps: configurationGaps,
      warnings: backupOffsiteConfigured ? [] : ["offsite_backup_remote"],
      gmailOAuth: gmailOAuthConfigured,
      gmailPush: gmailPushConfigured,
      integrationEncryption: integrationEncryptionConfigured,
      backupOffsiteConfigured,
    },
    operations,
  }, { status: production && !ok ? 503 : 200, headers: corsHeadersFor(request) });
}
