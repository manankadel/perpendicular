import { corsHeadersFor } from "@/lib/cors";
import { executeHeadlessChat, normalizeHeadlessMessages } from "@/lib/headless-chat";
import { anthropicResponse, apiError } from "@/lib/headless-http";
import { hasPermission, identityOrResponse, rateLimitHeaders, rejectCrossOrigin } from "@/lib/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "workspace:write")) return apiError("workspace:write permission is required.", 403, request);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return apiError("Request body must be valid JSON.", 400, request); }
  const messages = normalizeHeadlessMessages(body.messages);
  if (!messages.length) return apiError("messages must contain at least one user message.", 400, request);
  if (body.stream === true) return apiError("Streaming Anthropic responses is not supported yet; use stream: false.", 400, request);
  try {
    const result = await executeHeadlessChat({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, employeeId: typeof body.employee_id === "string" ? body.employee_id : typeof body.agent_id === "string" ? body.agent_id : undefined, messages, model: typeof body.model === "string" && body.model.trim() ? body.model.trim() : "perpendicular-local" });
    const response = anthropicResponse(result, request);
    for (const [name, value] of Object.entries(rateLimitHeaders(identity.context))) response.headers.set(name, value);
    return response;
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Message generation failed.", 400, request);
  }
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
