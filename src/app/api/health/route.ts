import { NextResponse } from "next/server";
import { databaseConfigured, getDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const database = await getDatabase();
  const production = process.env.NODE_ENV === "production";
  const ok = Boolean(database) && databaseConfigured();
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
    database: ok ? "connected" : databaseConfigured() ? "unavailable" : "not_configured",
    model: process.env.DISABLE_OLLAMA === "true" ? "disabled" : "ollama",
    version: process.env.PERPENDICULAR_BUILD_SHA || process.env.npm_package_version || "unknown",
    operations,
  }, { status: production && !ok ? 503 : 200 });
}
