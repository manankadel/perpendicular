import { NextResponse } from "next/server";
import { databaseConfigured, getDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const database = await getDatabase();
  const production = process.env.NODE_ENV === "production";
  const ok = Boolean(database) && databaseConfigured();
  return NextResponse.json({
    ok: production ? ok : true,
    service: "perpendicular-api",
    database: ok ? "connected" : databaseConfigured() ? "unavailable" : "not_configured",
    model: process.env.DISABLE_OLLAMA === "true" ? "disabled" : "ollama",
    version: process.env.npm_package_version || "unknown",
  }, { status: production && !ok ? 503 : 200 });
}

