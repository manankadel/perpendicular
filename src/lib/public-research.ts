import "server-only";

import dns from "node:dns/promises";
import net from "node:net";

export type WebsiteResearch = {
  url: string;
  title: string | null;
  description: string | null;
  text: string;
};

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
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0;
  }
  return address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe8") || address.startsWith("fe9") || address.startsWith("fea") || address.startsWith("feb");
}

async function assertPublicHost(url: URL) {
  if (url.username || url.password || (url.port && url.port !== "80" && url.port !== "443")) throw new Error("Only standard public HTTP and HTTPS URLs can be researched.");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local") || net.isIP(url.hostname) && privateAddress(url.hostname)) throw new Error("Private network addresses cannot be researched.");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) throw new Error("The URL does not resolve to a public address.");
}

export async function researchWebsite(input: string): Promise<WebsiteResearch> {
  const url = new URL(input);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only public HTTP and HTTPS URLs can be researched.");
  await assertPublicHost(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      headers: { accept: "text/html, text/plain;q=0.9", "user-agent": "PerpendicularBot/1.0 (+self-hosted)" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
    const html = await response.text();
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
