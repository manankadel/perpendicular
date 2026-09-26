import { updateWorkspaceDeal } from "@/lib/deal-runtime";
import { corsHeadersFor, corsJson } from "@/lib/cors";
import { recordAuditEvent } from "@/lib/integration-store";
import { hasPermission, identityOrResponse, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";
import { workspaceStateForClient } from "@/lib/workspace-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type RouteContext = { params: Promise<{ dealId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "workspace:write")) return corsJson({ error: "workspace:write permission is required." }, { status: 403 }, request);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return corsJson({ error: "Request body must be valid JSON." }, { status: 400 }, request); }
  const { dealId } = await context.params;
  try {
    const execution = await updateWorkspaceDeal({ workspaceId: identity.context.workspaceId, dealId, input: { stage: body.stage as never, stageNote: String(body.stageNote || ""), amount: body.amount === undefined ? undefined : Number(body.amount), nextAction: body.nextAction === undefined ? undefined : String(body.nextAction || ""), closeDate: body.closeDate === undefined ? undefined : (body.closeDate ? String(body.closeDate) : null), notes: body.notes === undefined ? undefined : String(body.notes || ""), ownerEmployeeId: body.ownerEmployeeId === undefined ? undefined : (String(body.ownerEmployeeId || "").trim() || null) } });
    try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "api.deal_update", resourceType: "deal", resourceId: dealId, metadata: { stage: execution.deal.stage } }); } catch { if (process.env.NODE_ENV === "production") return corsJson({ error: "The deal was updated, but its audit record could not be stored.", persisted: true, deal: execution.deal }, { status: 503 }, request); }
    return corsJson({ deal: execution.deal, state: workspaceStateForClient(execution.state) }, { headers: rateLimitHeaders(identity.context) }, request);
  } catch (error) { const message = error instanceof Error ? error.message : "Deal could not be updated."; return corsJson({ error: message }, { status: message === "Deal not found." ? 404 : 400 }, request); }
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
