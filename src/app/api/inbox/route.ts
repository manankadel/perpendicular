import { listInboxMessages } from "@/lib/inbox-store";
import { hasPermission, identityOrResponse } from "@/lib/route-auth";
import { corsHeadersFor, corsJson } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "workspace:read")) return corsJson({ error: "You do not have permission to view the inbox." }, { status: 403 }, request);
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") || 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 50;
  try {
    return corsJson({ messages: await listInboxMessages(identity.context.workspaceId, limit) }, undefined, request);
  } catch {
    return corsJson({ error: "Inbox storage is not ready. Apply the platform database migrations." }, { status: 503 }, request);
  }
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
