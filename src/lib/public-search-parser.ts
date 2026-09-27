export type PublicKeywordMatch = { title: string; url: string; snippet: string };

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function resultUrl(value: string) {
  const href = decodeHtml(value);
  const absolute = href.startsWith("//") ? `https:${href}` : href;
  try {
    const parsed = new URL(absolute);
    if (parsed.hostname === "duckduckgo.com" && parsed.pathname === "/l/") {
      const destination = parsed.searchParams.get("uddg");
      if (destination) return decodeURIComponent(destination);
    }
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function parsePublicKeywordResults(html: string): PublicKeywordMatch[] {
  const matches: PublicKeywordMatch[] = [];
  const resultPattern = /<a[^>]+class=["']result__a["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class=["']result__snippet["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(resultPattern)) {
    const url = resultUrl(match[1]);
    if (!url) continue;
    matches.push({ title: decodeHtml(match[2].replace(/<[^>]+>/g, " ")).slice(0, 240), url, snippet: decodeHtml(match[3].replace(/<[^>]+>/g, " ")).slice(0, 500) });
    if (matches.length >= 10) break;
  }
  return matches;
}
