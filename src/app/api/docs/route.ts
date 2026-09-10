import { NextResponse } from "next/server";

export const dynamic = "force-static";

const document = {
  openapi: "3.1.0",
  info: {
    title: "Perpendicular API",
    version: "1.0.0",
    description: "Open API surface for workspace reads, employee runs, Gmail, usage, privacy, and API-key management. All durable state is workspace-scoped.",
  },
  servers: [{ url: "https://perpendicular-api.bluebloodstudio.com" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "Blueblood ID JWT or a Perpendicular API key beginning with pp_live_." },
    },
    schemas: {
      Error: { type: "object", required: ["error"], properties: { error: { type: "string" }, loginUrl: { type: "string", format: "uri" } } },
      UsageSummary: { type: "object", required: ["periodStart", "periodEnd", "aiUnits", "dataUnits", "byFeature"], properties: { periodStart: { type: "string", format: "date-time" }, periodEnd: { type: "string", format: "date-time" }, aiUnits: { type: "integer" }, dataUnits: { type: "integer" }, byFeature: { type: "array", items: { type: "object", required: ["feature", "units"], properties: { feature: { type: "string" }, units: { type: "integer" } } } } } },
    },
  },
  paths: {
    "/api/health": { get: { security: [], responses: { "200": { description: "Service, database, dead-letter, webhook, and degraded-integration health." }, "503": { description: "Production database is unavailable." } } } },
    "/api/auth/login": { post: { security: [], description: "Authenticate through the product-owned sign-in form. The server validates the credentials with Blueblood ID and forwards HttpOnly session cookies; identity tokens are never returned to browser JavaScript.", responses: { "200": { description: "Signed in or an MFA challenge was issued." }, "401": { description: "Credentials are invalid." } } } },
    "/api/auth/mfa": { post: { security: [], description: "Complete the MFA challenge created by the product-owned sign-in form.", responses: { "200": { description: "Signed in and session cookies issued." }, "401": { description: "The challenge or code is invalid." } } } },
    "/api/auth/logout": { post: { security: [], description: "Clear the Perpendicular and Blueblood ID session cookies for the Blueblood Studio domain.", responses: { "200": { description: "Session cleared." } } } },
    "/api/workspace": {
      get: { description: "Read workspace state. Requires workspace:read for API keys.", responses: { "200": { description: "Workspace state scoped to the authenticated organization." }, "401": { description: "Authentication required." }, "403": { description: "Workspace read permission required." } } },
      post: { description: "Execute a workspace command. Actions: bootstrap-workspace, run-onboarding-brief, enable-onboarding-schedule, chat, create-employee, create-document, create-list, import-row, run-employee, evaluate-employee, activate-prompt-version, schedule-employee, enrich-row, enroll-row, create-sequence, create-ticket, resolve-ticket, rate-ticket.", responses: { "200": { description: "Updated workspace state." }, "403": { description: "Workspace permission required." } } },
    },
    "/api/workspace/export": { get: { description: "Download the authenticated workspace state, integration summaries, and usage ledger. Secrets are never included. Add format=csv for a Smart List row export.", parameters: [{ name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"] } }], responses: { "200": { description: "Portable JSON or Smart List CSV export." }, "401": { description: "Authentication required." } } } },
    "/api/workspace/privacy": { delete: { description: "Permanently delete all data for the authenticated workspace. Owner role and exact workspace ID confirmation are required.", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["confirmation"], properties: { confirmation: { type: "string" } } } } } }, responses: { "200": { description: "Workspace data deleted." }, "400": { description: "Confirmation did not match." }, "403": { description: "Owner permission required." } } } },
    "/api/usage": { get: { description: "Return persisted AI and data credit usage grouped by feature. Requires settings:read for API keys. The default period is 30 days; days may be 1–90.", parameters: [{ name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 90 } }], responses: { "200": { description: "Usage summary.", content: { "application/json": { schema: { $ref: "#/components/schemas/UsageSummary" } } } }, "403": { description: "Settings read permission required." }, "503": { description: "Usage migration is not available." } } } },
    "/api/ops": { get: { description: "List workspace-scoped provider webhook events and dead-letter jobs for operators.", responses: { "200": { description: "Operations catalog." }, "403": { description: "Settings read permission required." } } }, post: { description: "Replay a failed or processed Gmail webhook, or retry a dead-letter job. Actions are audited.", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["action", "id"], properties: { action: { type: "string", enum: ["replay-webhook", "retry-job"] }, id: { type: "string" } } } } } }, responses: { "200": { description: "Operation replayed or requeued." }, "403": { description: "Settings write permission required." } } } },
    "/api/integrations": { get: { description: "List connected integration summaries without secrets. Requires workspace:read for API keys.", responses: { "200": { description: "Connected integration summaries without secrets." }, "403": { description: "Workspace read permission required." } } } },
    "/api/integrations/google/start": { get: { description: "Start Google Gmail OAuth with PKCE. Requires settings:write for API keys.", responses: { "302": { description: "Redirect to Google consent." }, "403": { description: "Settings write permission required." } } } },
    "/api/integrations/gmail/test": { post: { description: "Send an explicit test message through the connected Gmail mailbox. Requires settings:write for API keys.", responses: { "200": { description: "Message accepted by Gmail." }, "403": { description: "Settings write permission required." } } } },
    "/api/integrations/gmail/sync": { post: { description: "Pull Gmail messages using the persisted history cursor, persist them, and pause matching enrolled rows on replies. Requires workspace:read for API keys.", responses: { "200": { description: "Inbox synchronized." }, "403": { description: "Workspace read permission required." } } } },
    "/api/integrations/gmail/watch": { post: { description: "Register or renew the Gmail Pub/Sub watch. Requires settings:write for API keys and GMAIL_PUBSUB_TOPIC on the Dell.", responses: { "200": { description: "Watch registered." }, "403": { description: "Settings write permission required." } } } },
    "/api/integrations/gmail/disconnect": { post: { description: "Disconnect the encrypted Gmail mailbox. Requires settings:write for API keys.", responses: { "200": { description: "Mailbox disconnected." }, "403": { description: "Settings write permission required." } } } },
    "/api/webhooks/gmail": { post: { security: [], description: "Authenticated Google Pub/Sub Gmail history webhook. Requires the configured shared webhook token, persists and deduplicates the provider event, then synchronizes the mailbox.", responses: { "200": { description: "Webhook processed." }, "401": { description: "Webhook authentication failed." }, "503": { description: "Webhook secret is not configured." } } } },
    "/api/keys": { get: { description: "List active API key metadata. Requires settings:read.", responses: { "200": { description: "List active API key metadata." }, "403": { description: "Settings read permission required." } } }, post: { description: "Scopes: workspace:read, workspace:write, settings:read, settings:write. Requires settings:write.", responses: { "201": { description: "Created key; plaintext is returned once." }, "400": { description: "Name or scope is invalid." }, "403": { description: "Settings write permission required." } } } },
    "/api/keys/{id}": { delete: { responses: { "200": { description: "Key revoked." } } } },
    "/api/mcp": { post: { description: "MCP JSON-RPC endpoint exposing workspace_get, employee_chat, employee_run, and integrations_list.", responses: { "200": { description: "JSON-RPC response." } } } },
    "/api/pricing": { get: { security: [], responses: { "200": { description: "Truthful self-hosted pricing metadata." } } } },
  },
};

export async function GET() {
  return NextResponse.json(document, { headers: { "cache-control": "public, max-age=300" } });
}
