import { NextResponse } from "next/server";
import { findWorkspace, listWorkspaceIds } from "@/lib/server-store";
import { corsHeadersFor } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, init: ResponseInit | undefined, request: Request) {
  return NextResponse.json(body, { ...init, headers: { ...corsHeadersFor(request), ...init?.headers } });
}

async function locate(slug: string) {
  const normalizedSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 90);
  for (const workspaceId of await listWorkspaceIds()) {
    const state = await findWorkspace(workspaceId);
    const site = state?.sites.find((candidate) => candidate.slug === normalizedSlug && candidate.status === "published");
    if (state && site) return { workspaceId, state, site };
  }
  return null;
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(request) });
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await locate(slug);
  if (!result) return json({ error: "Published site not found." }, { status: 404 }, request);
  const agent = result.site.agentId ? result.state.inboundAgents.find((candidate) => candidate.id === result.site.agentId && candidate.status === "live") : null;
  const employee = agent ? result.state.employees.find((candidate) => candidate.id === agent.employeeId && candidate.status === "live") : null;
  return json({
    workspaceId: result.workspaceId,
    workspaceName: result.state.workspace.name,
    site: { name: result.site.name, kind: result.site.kind, slug: result.site.slug, headline: result.site.headline, body: result.site.body },
    agent: agent ? { name: employee?.name || agent.name, greeting: agent.greeting } : null,
    booking: result.state.bookingSettings?.enabled ? { slug: result.state.bookingSettings.slug, title: result.state.bookingSettings.title } : null,
  }, undefined, request);
}
