import { NextResponse } from "next/server";

const defaultWebOrigins = [
  "https://perpendicular.bluebloodstudio.com",
  "https://perpendicular-nine.vercel.app",
];

function configuredWebOrigins() {
  const configured = [
    ...(process.env.PERPENDICULAR_WEB_ORIGINS || "").split(","),
    process.env.PERPENDICULAR_WEB_ORIGIN || "",
  ].map((origin) => origin.trim().replace(/\/$/, "")).filter(Boolean);
  return [...new Set([...configured, ...defaultWebOrigins])];
}

export function isAllowedWebOrigin(origin: string | null) {
  if (!origin || configuredWebOrigins().includes(origin)) return true;
  if (process.env.NODE_ENV === "production") return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function corsHeadersFor(request?: Request) {
  const requestOrigin = request?.headers.get("origin") || null;
  const allowOrigin = requestOrigin && isAllowedWebOrigin(requestOrigin)
    ? requestOrigin
    : configuredWebOrigins()[0];
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, content-type, x-company-id, x-organization-slug, x-api-key",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    vary: "Origin",
  };
}

export const corsHeaders = corsHeadersFor();

export function corsJson(body: unknown, init?: ResponseInit, request?: Request) {
  return NextResponse.json(body, { ...init, headers: { ...corsHeadersFor(request), ...init?.headers } });
}
