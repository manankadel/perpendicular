import PublishedSitePage from "@/components/PublishedSitePage";

export const dynamic = "force-dynamic";

export default async function PublicSite({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const query = await searchParams;
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] || "" : value || "";
  const initialAttribution = { source: first(query.utm_source), medium: first(query.utm_medium), campaign: first(query.utm_campaign), content: first(query.utm_content), term: first(query.utm_term) };
  return <PublishedSitePage slug={slug} initialAttribution={initialAttribution} />;
}
