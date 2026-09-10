import { NextResponse } from "next/server";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({
    product: "Perpendicular",
    openSource: true,
    currency: "USD",
    plans: [{ id: "open-source", name: "Open Source", price: 0, interval: "forever", description: "Run on your own Dell or Linux host with open-source services and your own provider credentials.", features: ["Unlimited workspaces on your own infrastructure", "Ollama local inference", "Postgres persistence", "API and MCP access", "Google/Gmail connection when configured"] }],
    billing: { provider: "self-hosted", checkout: false, note: "No paid checkout is enabled. Stripe should not be implied until a billing provider and webhook contract are configured." },
  });
}
