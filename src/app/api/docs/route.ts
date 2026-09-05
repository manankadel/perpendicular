import { NextResponse } from "next/server";

export const dynamic = "force-static";

const document = {
  openapi: "3.1.0",
  info: {
    title: "Perpendicular API",
    version: "1.0.0",
    description: "Open API surface for workspace reads, employee runs, Gmail, and API-key management.",
  },
  servers: [{ url: "https://perpendicular-api.bluebloodstudio.com" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "Blueblood ID JWT or a Perpendicular API key beginning with pp_live_." },
    },
  },
  paths: {
    "/api/health": { get: { security: [], responses: { "200": { description: "Service and database health." } } } },
    "/api/auth/login": { post: { security: [], description: "Authenticate through the product-owned sign-in form. The server validates the credentials with Blueblood ID and forwards HttpOnly session cookies; identity tokens are never returned to browser JavaScript.", responses: { "200": { description: "Signed in or an MFA challenge was issued." }, "401": { description: "Credentials are invalid." } } } },
    "/api/auth/mfa": { post: { security: [], description: "Complete the MFA challenge created by the product-owned sign-in form.", responses: { "200": { description: "Signed in and session cookies issued." }, "401": { description: "The challenge or code is invalid." } } } },
    "/api/auth/logout": { post: { security: [], description: "Clear the Perpendicular and Blueblood ID session cookies for the Blueblood Studio domain.", responses: { "200": { description: "Session cleared." } } } },
    "/api/workspace": {
      get: { responses: { "200": { description: "Workspace state scoped to the authenticated organization." }, "401": { description: "Authentication required." } } },
      post: { description: "Execute a workspace command. Current actions: chat, create-employee, create-document, run-employee, evaluate-employee, schedule-employee, enrich-row, enroll-row, create-ticket, resolve-ticket, rate-ticket.", responses: { "200": { description: "Updated workspace state." } } },
    },
    "/api/integrations": { get: { responses: { "200": { description: "Connected integration summaries without secrets." } } } },
    "/api/integrations/google/start": { get: { description: "Start Google Gmail OAuth with PKCE. Browser session required.", responses: { "302": { description: "Redirect to Google consent." } } } },
    "/api/integrations/gmail/test": { post: { description: "Send an explicit test message through the connected Gmail mailbox.", responses: { "200": { description: "Message accepted by Gmail." } } } },
    "/api/integrations/gmail/sync": { post: { description: "Pull recent Gmail messages, persist them, and pause matching enrolled rows on replies.", responses: { "200": { description: "Inbox synchronized." } } } },
    "/api/keys": { get: { responses: { "200": { description: "List active API key metadata." } } }, post: { responses: { "201": { description: "Created key; plaintext is returned once." } } } },
    "/api/keys/{id}": { delete: { responses: { "200": { description: "Key revoked." } } } },
    "/api/mcp": { post: { description: "MCP JSON-RPC endpoint exposing workspace_get, employee_chat, employee_run, and integrations_list.", responses: { "200": { description: "JSON-RPC response." } } } },
    "/api/pricing": { get: { security: [], responses: { "200": { description: "Truthful self-hosted pricing metadata." } } } },
  },
};

export async function GET() {
  return NextResponse.json(document, { headers: { "cache-control": "public, max-age=300" } });
}
