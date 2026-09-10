import { NextResponse } from "next/server";
import { authenticateRequest, IdentityError } from "@/lib/identity";
import { corsHeadersFor, corsJson } from "@/lib/cors";
import { rejectCrossOrigin } from "@/lib/route-auth";
import { transaction } from "@/lib/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function identityOrError(request: Request) {
  try {
    return { identity: await authenticateRequest(request) };
  } catch (error) {
    if (error instanceof IdentityError) return { response: corsJson({ error: error.message }, { status: error.status }, request) };
    throw error;
  }
}

export async function DELETE(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const result = await identityOrError(request);
  if ("response" in result) return result.response;
  const { identity } = result;
  if (!(["owner", "super_admin"].includes(identity.role))) return corsJson({ error: "Only a workspace owner can delete workspace data." }, { status: 403 }, request);

  let body: { confirmation?: string };
  try {
    body = await request.json() as { confirmation?: string };
  } catch {
    return corsJson({ error: "Type the workspace ID in confirmation to continue." }, { status: 400 }, request);
  }
  if (body.confirmation !== identity.workspaceId) return corsJson({ error: "Workspace ID confirmation does not match." }, { status: 400 }, request);

  try {
    await transaction(async (client) => {
      for (const table of [
        "perpendicular_inbox_messages",
        "perpendicular_inbox_threads",
        "perpendicular_webhook_events",
        "perpendicular_integration_health",
        "perpendicular_integrations",
        "perpendicular_oauth_states",
        "perpendicular_api_keys",
        "perpendicular_usage_ledger",
        "perpendicular_jobs",
        "perpendicular_audit_events",
      ]) {
        await client.query(`delete from ${table} where workspace_id = $1`, [identity.workspaceId]);
      }
      await client.query("delete from perpendicular_workspace_state where company_id = $1", [identity.workspaceId]);
    });
    return corsJson({ ok: true, deleted: true, workspaceId: identity.workspaceId }, { status: 200 }, request);
  } catch (error) {
    return corsJson({ error: error instanceof Error ? error.message : "Workspace deletion failed." }, { status: 503 }, request);
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(request) });
}
