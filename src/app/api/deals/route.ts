import { createWorkspaceDeal, getWorkspaceDeals } from "@/lib/deal-runtime";
import { corsHeadersFor, corsJson } from "@/lib/cors";
import { recordAuditEvent } from "@/lib/integration-store";
import { hasPermission, identityOrResponse, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";
import { workspaceStateForClient } from "@/lib/workspace-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "workspace:read")) return corsJson({ error: "workspace:read permission is required." }, { status: 403 }, request);
  try { return corsJson({ deals: await getWorkspaceDeals(identity.context.workspaceId) }, { headers: rateLimitHeaders(identity.context) }, request); } catch (error) { return corsJson({ error: error instanceof Error ? error.message : "Deals could not be loaded." }, { status: 503 }, request); }
}

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "workspace:write")) return corsJson({ error: "workspace:write permission is required." }, { status: 403 }, request);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return corsJson({ error: "Request body must be valid JSON." }, { status: 400 }, request); }
  try {
    const execution = await createWorkspaceDeal({ workspaceId: identity.context.workspaceId, input: { name: String(body.name || ""), company: String(body.company || ""), amount: Number(body.amount || 0), currency: String(body.currency || "USD"), stage: body.stage as never, personId: String(body.personId || "").trim() || null, ownerEmployeeId: String(body.ownerEmployeeId || "").trim() || null, source: String(body.source || "manual"), nextAction: String(body.nextAction || ""), closeDate: body.closeDate ? String(body.closeDate) : null, notes: String(body.notes || "") } });
    try { await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "api.deal_create", resourceType: "deal", resourceId: execution.deal.id }); } catch { if (process.env.NODE_ENV === "production") return corsJson({ error: "The deal was saved, but its audit record could not be stored.", persisted: true, deal: execution.deal }, { status: 503 }, request); }
    return corsJson({ deal: execution.deal, state: workspaceStateForClient(execution.state) }, { status: 201, headers: rateLimitHeaders(identity.context) }, request);
  } catch (error) { return corsJson({ error: error instanceof Error ? error.message : "Deal could not be created." }, { status: 400 }, request); }
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
