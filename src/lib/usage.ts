import "server-only";

import { query } from "@/lib/database";
import type { UsageSummary } from "@/lib/domain";
import { randomToken } from "@/lib/security";

export type UsageUnit = "ai" | "data";

export async function recordUsage(args: {
  workspaceId: string;
  actorId: string;
  feature: string;
  unit: UsageUnit;
  units: number;
  provider?: string;
  metadata?: Record<string, unknown>;
}) {
  if (!Number.isFinite(args.units) || args.units <= 0) return false;
  try {
    await query(
      `insert into perpendicular_usage_ledger
        (id, workspace_id, actor_id, feature, unit, units, provider, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        randomToken(18),
        args.workspaceId,
        args.actorId,
        args.feature,
        args.unit,
        Math.ceil(args.units),
        args.provider || null,
        JSON.stringify(args.metadata || {}),
      ],
    );
    return true;
  } catch {
    // Usage accounting must not turn a successful product action into a failed action
    // while an older deployment is waiting for the additive ledger migration.
    return false;
  }
}

export async function getUsageSummary(workspaceId: string, periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), periodEnd = new Date()): Promise<UsageSummary> {
  const result = await query<{
    unit: UsageUnit;
    feature: string;
    units: string;
  }>(
    `select unit, feature, coalesce(sum(units), 0)::text as units
     from perpendicular_usage_ledger
     where workspace_id = $1 and created_at >= $2 and created_at < $3
     group by unit, feature
     order by sum(units) desc, feature asc`,
    [workspaceId, periodStart, periodEnd],
  );
  const aiUnits = result.rows.filter((row) => row.unit === "ai").reduce((total, row) => total + Number(row.units), 0);
  const dataUnits = result.rows.filter((row) => row.unit === "data").reduce((total, row) => total + Number(row.units), 0);
  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    aiUnits,
    dataUnits,
    byFeature: result.rows.map((row) => ({ feature: `${row.unit}:${row.feature}`, units: Number(row.units) })),
  };
}
