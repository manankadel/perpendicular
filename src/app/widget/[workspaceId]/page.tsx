import PerpendicularWidget from "@/components/PerpendicularWidget";

export const dynamic = "force-dynamic";

export default async function WidgetPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ key?: string | string[] }> }) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const publicKey = Array.isArray(query.key) ? query.key[0] || "" : query.key || "";
  return <PerpendicularWidget workspaceId={workspaceId} publicKey={publicKey} />;
}

