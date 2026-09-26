import { notFound } from "next/navigation";
import { listWorkspaceIds, findWorkspace } from "@/lib/server-store";
import SiteChat from "@/components/SiteChat";

export const dynamic = "force-dynamic";

async function findPublishedSite(slug: string) {
  const ids = await listWorkspaceIds();
  for (const workspaceId of ids) {
    const state = await findWorkspace(workspaceId);
    const site = state?.sites.find((candidate) => candidate.slug === slug && candidate.status === "published");
    if (state && site) return { workspaceId, state, site };
  }
  return null;
}

export default async function PublicSite({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await findPublishedSite(slug);
  if (!result) notFound();
  const { state, site, workspaceId } = result;
  const agent = site.agentId ? state.inboundAgents.find((candidate) => candidate.id === site.agentId && candidate.status === "live") : null;
  return <main className="public-site"><div className="public-site-inner"><div className="eyebrow">{state.workspace.name}</div><h1>{site.headline}</h1>{site.body ? <p className="public-site-body">{site.body}</p> : null}<div className="public-site-meta">{site.kind === "landing_page" ? "Landing page" : "Website"} · open source runtime</div>{agent ? <SiteChat slug={site.slug} workspaceId={workspaceId} agentName={state.employees.find((employee) => employee.id === agent.employeeId)?.name || agent.name} greeting={agent.greeting} /> : <div className="public-site-note">This page is published. Attach a live inbound agent to open conversations.</div>}</div></main>;
}
