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
