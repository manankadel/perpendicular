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
  return !origin || configuredWebOrigins().includes(origin);
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
