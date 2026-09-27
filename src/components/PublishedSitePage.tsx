"use client";

import { useEffect, useState } from "react";
import SiteChat from "@/components/SiteChat";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || (process.env.NODE_ENV === "production" ? "https://perpendicular-api.bluebloodstudio.com" : "")).replace(/\/$/, "");

type PublicSitePayload = {
  workspaceId: string;
  workspaceName: string;
  site: { name: string; kind: "website" | "landing_page"; slug: string; headline: string; body: string };
  agent: { name: string; greeting: string } | null;
  booking: { slug: string; title: string } | null;
};

export default function PublishedSitePage({ slug, initialAttribution }: { slug: string; initialAttribution: Record<string, string> }) {
  const [payload, setPayload] = useState<PublicSitePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    fetch(`${apiBase}/api/site/${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as PublicSitePayload & { error?: string };
        if (!response.ok) throw new Error(body.error || "Published site not found.");
        if (active) setPayload(body);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Published site not found."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  if (loading) return <main className="public-site"><div className="public-site-inner"><div className="eyebrow">Perpendicular</div><p className="public-site-note">Loading published site…</p></div></main>;
  if (error || !payload) return <main className="public-site"><div className="public-site-inner"><div className="eyebrow">Perpendicular</div><h1>Site unavailable</h1><p className="public-site-note">{error || "Published site not found."}</p></div></main>;
  return <main className="public-site"><div className="public-site-inner"><div className="eyebrow">{payload.workspaceName}</div><h1>{payload.site.headline}</h1>{payload.site.body ? <p className="public-site-body">{payload.site.body}</p> : null}<div className="public-site-meta">{payload.site.kind === "landing_page" ? "Landing page" : "Website"} · open source runtime</div>{payload.booking ? <div className="public-site-actions"><a className="button-primary" href={`/book/${payload.booking.slug}`}>Book a conversation <span aria-hidden="true">→</span></a></div> : null}{payload.agent ? <SiteChat slug={payload.site.slug} workspaceId={payload.workspaceId} agentName={payload.agent.name} greeting={payload.agent.greeting} initialAttribution={initialAttribution} /> : <div className="public-site-note">This page is published. Attach a live inbound agent to open conversations.</div>}</div></main>;
}
