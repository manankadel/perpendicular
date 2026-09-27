"use client";

import { useParams, useSearchParams } from "next/navigation";
import PublishedSitePage from "@/components/PublishedSitePage";

function first(value: string | null) {
  return value || "";
}

export default function PublicSite() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const initialAttribution = {
    source: first(searchParams.get("utm_source")),
    medium: first(searchParams.get("utm_medium")),
    campaign: first(searchParams.get("utm_campaign")),
    content: first(searchParams.get("utm_content")),
    term: first(searchParams.get("utm_term")),
  };
  return <PublishedSitePage slug={params.slug} initialAttribution={initialAttribution} />;
}
