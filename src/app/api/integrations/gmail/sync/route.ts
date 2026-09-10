import { recordAuditEvent } from "@/lib/integration-store";
import { syncGmailWorkspace } from "@/lib/gmail-sync";
import { hasPermission, identityOrResponse, rejectCrossOrigin } from "@/lib/route-auth";
import { corsHeadersFor, corsJson } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "settings:write")) return corsJson({ error: "You do not have permission to sync Gmail." }, { status: 403 }, request);
  try {
    const synced = await syncGmailWorkspace(identity.context.workspaceId);
    let warning: string | undefined;
    try {
      await recordAuditEvent({ workspaceId: identity.context.workspaceId, actorId: identity.context.userId, action: "gmail.synced", resourceType: "gmail", metadata: { count: synced.count, insertedCount: synced.insertedCount, historyId: synced.historyId } });
    } catch (error) {
      warning = error instanceof Error ? `Inbox sync completed, but its audit record failed: ${error.message}` : "Inbox sync completed, but audit storage is unavailable.";
    }
    return corsJson({ ok: true, count: synced.count, state: synced.state, ...(warning ? { auditRecorded: false, warning } : { auditRecorded: true }) }, undefined, request);
  } catch (error) {
    return corsJson({ error: error instanceof Error ? error.message : "Gmail sync failed." }, { status: 400 }, request);
  }
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
