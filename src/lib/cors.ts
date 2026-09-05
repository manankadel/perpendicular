import { NextResponse } from "next/server";

export const corsHeaders = {
  "access-control-allow-origin": process.env.PERPENDICULAR_WEB_ORIGIN || "https://perpendicular.bluebloodstudio.com",
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization, content-type, x-api-key",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  vary: "Origin",
};

export function corsJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...corsHeaders, ...init?.headers } });
}

