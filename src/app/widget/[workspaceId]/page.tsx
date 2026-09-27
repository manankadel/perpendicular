import PerpendicularWidget from "@/components/PerpendicularWidget";

export const dynamic = "force-dynamic";

export default async function WidgetPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const publicKey = Array.isArray(query.key) ? query.key[0] || "" : query.key || "";
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] || "" : value || "";
  const initialAttribution = { source: first(query.utm_source), medium: first(query.utm_medium), campaign: first(query.utm_campaign), content: first(query.utm_content), term: first(query.utm_term) };
  return <PerpendicularWidget workspaceId={workspaceId} publicKey={publicKey} initialAttribution={initialAttribution} />;
}
