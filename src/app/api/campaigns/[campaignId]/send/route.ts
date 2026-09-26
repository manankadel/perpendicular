import { executeCampaignBroadcast } from "@/lib/campaign-send-runtime";
import { corsHeadersFor, corsJson } from "@/lib/cors";
import { recordAuditEvent } from "@/lib/integration-store";
import { hasPermission, identityOrResponse, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";
import { workspaceStateForClient } from "@/lib/workspace-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ campaignId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "workspace:write")) return corsJson({ error: "workspace:write permission is required." }, { status: 403 }, request);
  const { campaignId } = await context.params;
  try {
    const execution = await executeCampaignBroadcast({ workspaceId: identity.context.workspaceId, campaignId, senderEmail: identity.context.email });
    let auditRecorded = true;
    try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "api.campaign_broadcast_sent", resourceType: "campaign", resourceId: campaignId, metadata: execution.delivery }); } catch { auditRecorded = false; }
    return corsJson({ campaign: execution.campaign, delivery: { ...execution.delivery, auditRecorded }, state: workspaceStateForClient(execution.state) }, { headers: rateLimitHeaders(identity.context) }, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Campaign broadcast failed.";
    const status = message === "Campaign not found." ? 404 : message.includes("already") ? 409 : message.includes("daily send limit") ? 429 : message.includes("unavailable") ? 503 : 400;
    return corsJson({ error: message }, { status }, request);
  }
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
