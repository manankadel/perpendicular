import { NextResponse } from "next/server";
import { databaseConfigured, getDatabase } from "@/lib/database";

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
] as const;

export async function GET() {
  const database = await getDatabase();
  const production = process.env.NODE_ENV === "production";
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
  const ok = databaseOk && (schema?.ok ?? false);
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
    model: process.env.DISABLE_OLLAMA === "true" ? "disabled" : "ollama",
    version: process.env.PERPENDICULAR_BUILD_SHA || process.env.npm_package_version || "unknown",
    operations,
  }, { status: production && !ok ? 503 : 200 });
}
