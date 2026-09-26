import { corsHeadersFor, corsJson } from "@/lib/cors";
import { hasPermission, identityOrResponse } from "@/lib/route-auth";
import { getWorkspace } from "@/lib/server-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "workspace:read")) return corsJson({ error: "workspace:read permission is required." }, { status: 403 }, request);
  const state = await getWorkspace(identity.context.workspaceId);
  return corsJson({ items: state.employees.map((employee) => ({ id: employee.id, name: employee.name, title: employee.title, model: employee.model, status: employee.status, channels: ["api", "mcp"] })), total: state.employees.length, pages: 1, hasNext: false }, undefined, request);
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
