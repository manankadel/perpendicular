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

export default async function PublicSite({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const query = await searchParams;
  const result = await findPublishedSite(slug);
  if (!result) notFound();
  const { state, site, workspaceId } = result;
  const agent = site.agentId ? state.inboundAgents.find((candidate) => candidate.id === site.agentId && candidate.status === "live") : null;
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] || "" : value || "";
  const initialAttribution = { source: first(query.utm_source), medium: first(query.utm_medium), campaign: first(query.utm_campaign), content: first(query.utm_content), term: first(query.utm_term) };
  return <main className="public-site"><div className="public-site-inner"><div className="eyebrow">{state.workspace.name}</div><h1>{site.headline}</h1>{site.body ? <p className="public-site-body">{site.body}</p> : null}<div className="public-site-meta">{site.kind === "landing_page" ? "Landing page" : "Website"} · open source runtime</div>{state.bookingSettings?.enabled ? <div className="public-site-actions"><a className="button-primary" href={`/book/${state.bookingSettings.slug}`}>Book a conversation <span aria-hidden="true">→</span></a></div> : null}{agent ? <SiteChat slug={site.slug} workspaceId={workspaceId} agentName={state.employees.find((employee) => employee.id === agent.employeeId)?.name || agent.name} greeting={agent.greeting} initialAttribution={initialAttribution} /> : <div className="public-site-note">This page is published. Attach a live inbound agent to open conversations.</div>}</div></main>;
}
