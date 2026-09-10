import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/server-store";
import { getUsageSummary } from "@/lib/usage";
import { authenticateRequest, IdentityError } from "@/lib/identity";
import { corsHeadersFor, corsJson } from "@/lib/cors";
import { listIntegrationSummaries } from "@/lib/integration-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const identity = await authenticateRequest(request);
    const url = new URL(request.url);
    const [workspace, integrations] = await Promise.all([
      getWorkspace(identity.workspaceId),
      listIntegrationSummaries(identity.workspaceId),
    ]);
    const usage = await getUsageSummary(identity.workspaceId).catch(() => null);
    const exportPayload = {
      exportedAt: new Date().toISOString(),
      workspaceId: identity.workspaceId,
      viewer: { userId: identity.userId, email: identity.email },
      workspace,
      integrations,
      usage,
    };
    if (url.searchParams.get("format") === "csv") {
      const rows = workspace.lists.flatMap((list) => list.rows.map((row) => ({ list: list.name, ...row })));
      const columns = ["list", "id", "name", "email", "company", "role", "location", "score", "status", "emailStatus", "intent", "companyInsight", "enrollmentStatus", "lastAction"] as const;
      const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
      const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\n");
      return new Response(csv, {
        status: 200,
        headers: {
          ...corsHeadersFor(request),
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="perpendicular-${identity.workspaceId}-rows.csv"`,
          "cache-control": "no-store",
        },
      });
    }
    return NextResponse.json(exportPayload, {
      headers: {
        ...corsHeadersFor(request),
        "content-disposition": `attachment; filename="perpendicular-${identity.workspaceId}-export.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof IdentityError) {
      return corsJson({ error: error.message }, { status: error.status, headers: error.retryAfterSeconds ? { "retry-after": String(error.retryAfterSeconds) } : undefined }, request);
    }
    return corsJson({ error: error instanceof Error ? error.message : "Workspace export is unavailable." }, { status: 503 }, request);
  }
}
