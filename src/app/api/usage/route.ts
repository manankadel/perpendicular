import { corsJson } from "@/lib/cors";
import { authenticateRequest, IdentityError } from "@/lib/identity";
import { hasPermission } from "@/lib/route-auth";
import { getUsageSummary } from "@/lib/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const identity = await authenticateRequest(request);
    if (!hasPermission(identity, "settings:read")) return corsJson({ error: "You do not have permission to view usage." }, { status: 403 }, request);
    const url = new URL(request.url);
    const requestedDays = Number(url.searchParams.get("days") || 30);
    const days = Number.isFinite(requestedDays) ? Math.min(90, Math.max(1, Math.floor(requestedDays))) : 30;
    const usage = await getUsageSummary(identity.workspaceId, new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    return corsJson(usage, { headers: { "cache-control": "no-store" } }, request);
  } catch (error) {
    if (error instanceof IdentityError) return corsJson({ error: error.message }, { status: error.status }, request);
    return corsJson({ error: error instanceof Error ? error.message : "Usage data is unavailable. Apply db/004_usage_ledger.sql." }, { status: 503 }, request);
  }
}
