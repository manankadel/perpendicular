import "server-only";

import dns from "node:dns/promises";
import net from "node:net";

export type WebsiteResearch = {
  url: string;
  title: string | null;
  description: string | null;
  text: string;
};

const maxRedirects = 3;
const maxResponseBytes = 1_000_000;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function meta(html: string, name: string) {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i");
  return html.match(pattern)?.[1]?.trim() || null;
}

function privateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIPv4(normalized)) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0) || a >= 224;
  }
  if (normalized.startsWith("::ffff:")) {
    const suffix = normalized.slice(7);
    const groups = suffix.split(":");
    if (groups.length === 2 && groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
      const value = (Number.parseInt(groups[0], 16) * 0x10000) + Number.parseInt(groups[1], 16);
      return privateAddress(`${value >>> 24}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`);
    }
    if (net.isIPv4(suffix)) return privateAddress(suffix);
  }
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}

async function assertPublicHost(url: URL) {
  if (url.username || url.password || (url.port && url.port !== "80" && url.port !== "443")) throw new Error("Only standard public HTTP and HTTPS URLs can be researched.");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local") || net.isIP(url.hostname) && privateAddress(url.hostname)) throw new Error("Private network addresses cannot be researched.");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) throw new Error("The URL does not resolve to a public address.");
}

async function readResponseText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel();
        throw new Error("The source is too large to research safely.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export async function researchWebsite(input: string): Promise<WebsiteResearch> {
  let url = new URL(input);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only public HTTP and HTTPS URLs can be researched.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    let response: Response | undefined;
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      await assertPublicHost(url);
      response = await fetch(url, {
        redirect: "manual",
        headers: { accept: "text/html, text/plain;q=0.9", "user-agent": "PerpendicularBot/1.0 (+self-hosted)" },
        signal: controller.signal,
      });
      if (!redirectStatuses.has(response.status)) break;
      const location = response.headers.get("location");
      if (!location || redirectCount === maxRedirects) throw new Error("The source redirected too many times or omitted its destination.");
      url = new URL(location, url);
      if (!/^https?:$/.test(url.protocol)) throw new Error("The source redirected to an unsupported protocol.");
    }
    if (!response) throw new Error("The source could not be fetched.");
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/^(text\/html|application\/xhtml\+xml|text\/plain)(?:;|$)/i.test(contentType)) throw new Error("The source is not readable text or HTML.");
    const html = await readResponseText(response);
    const text = stripHtml(html).slice(0, 12000);
    if (!text) throw new Error("The source contained no readable text.");
    return { url: url.toString(), title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || null, description: meta(html, "description") || meta(html, "og:description"), text };
  } finally {
    clearTimeout(timeout);
  }
}

export async function researchPersonCompany(email: string, company: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || domain === "gmail.com" || domain === "outlook.com" || domain === "yahoo.com") throw new Error("A business-domain email is required for public company research.");
  const result = await researchWebsite(`https://${domain}`);
  const insight = [result.title, result.description, company].filter(Boolean).join(" · ").slice(0, 280);
  return { ...result, insight };
}
