import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("the launch database contract includes additive usage accounting", () => {
  const migration = readFileSync(join(root, "db/004_usage_ledger.sql"), "utf8");
  assert.match(migration, /create table if not exists perpendicular_usage_ledger/);
  assert.match(migration, /unit in \('ai', 'data'\)/);
  assert.match(readFileSync(join(root, "README.md"), "utf8"), /db\/004_usage_ledger\.sql/);
});

test("the launch database contract includes distributed API-key rate limiting", () => {
  const migration = readFileSync(join(root, "db/006_rate_limits.sql"), "utf8");
  const health = readFileSync(join(root, "src/app/api/health/route.ts"), "utf8");
  assert.match(migration, /create table if not exists perpendicular_rate_limits/);
  assert.match(migration, /bucket_key text primary key/);
  assert.match(health, /perpendicular_rate_limits/);
});

test("the launch database contract persists idempotent outbound sequence sends", () => {
  const migration = readFileSync(join(root, "db/005_outbound_messages.sql"), "utf8");
  const health = readFileSync(join(root, "src/app/api/health/route.ts"), "utf8");
  const docs = readFileSync(join(root, "src/app/api/docs/route.ts"), "utf8");
  assert.match(migration, /create table if not exists perpendicular_outbound_messages/);
  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(migration, /status in \('sending', 'sent', 'failed', 'unknown'\)/);
  assert.match(health, /perpendicular_outbound_messages/);
  assert.match(docs, /send-sequence-step/);
});

test("knowledge sources support real file ingestion", () => {
  const ingest = readFileSync(join(root, "src/lib/document-ingest.ts"), "utf8");
  const route = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
  const console = readFileSync(join(root, "src/components/PerpendicularConsole.tsx"), "utf8");
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
  assert.match(ingest, /pdftotext/);
  assert.match(route, /body\.fileData/);
  assert.match(console, /type="file"/);
  assert.match(console, /\.pdf/);
  assert.match(dockerfile, /poppler-utils/);
});

test("the public API contract exposes usage and privacy controls", () => {
  const docs = readFileSync(join(root, "src/app/api/docs/route.ts"), "utf8");
  assert.match(docs, /\/api\/usage/);
  assert.match(docs, /\/api\/workspace\/export/);
  assert.match(docs, /\/api\/workspace\/privacy/);
  assert.match(docs, /\/api\/integrations\/google\/callback/);
  assert.match(docs, /\/api\/cron\/heartbeat/);
  assert.match(docs, /\/api\/keys\/\{id\}/);
});

test("workspace deletion requires owner confirmation in the route contract", () => {
  const route = readFileSync(join(root, "src/app/api/workspace/privacy/route.ts"), "utf8");
  assert.match(route, /Only a workspace owner/);
  assert.match(route, /body\.confirmation !== identity\.workspaceId/);
  assert.match(route, /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/);
  assert.match(route, /delete from perpendicular_workspace_state where company_id = \$1/);
});

test("workspace exports neutralize spreadsheet formulas and unsafe filenames", () => {
  const route = readFileSync(join(root, "src/app/api/workspace/export/route.ts"), "utf8");
  assert.match(route, /filenameWorkspaceId = identity\.workspaceId\.replace/);
  assert.match(route, /\^\[=\+\\-@\]/);
});

test("operator controls expose webhook and dead-letter replay paths", () => {
  const route = readFileSync(join(root, "src/app/api/ops/route.ts"), "utf8");
  assert.match(route, /replay-webhook/);
  assert.match(route, /retry-job/);
  assert.match(route, /listWebhookEvents/);
  assert.match(route, /listDeadLetterJobs/);
});

test("REST surfaces enforce API-key scopes for reads and Gmail mutations", () => {
  const workspace = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
  const integrations = readFileSync(join(root, "src/app/api/integrations/route.ts"), "utf8");
  const usage = readFileSync(join(root, "src/app/api/usage/route.ts"), "utf8");
  const exportRoute = readFileSync(join(root, "src/app/api/workspace/export/route.ts"), "utf8");
  const gmailTest = readFileSync(join(root, "src/app/api/integrations/gmail/test/route.ts"), "utf8");
  const gmailDisconnect = readFileSync(join(root, "src/app/api/integrations/gmail/disconnect/route.ts"), "utf8");
  assert.match(workspace, /const requiredPermission = "workspace:write"/);
  assert.match(workspace, /hasPermission\(identity\.context, "workspace:read"\)/);
  assert.match(integrations, /hasPermission\(identity\.context, "workspace:read"\)/);
  assert.match(usage, /hasPermission\(identity, "settings:read"\)/);
  assert.match(exportRoute, /hasPermission\(identity, "workspace:read"\)/);
  assert.match(gmailTest, /hasPermission\(identity\.context, "settings:write"\)/);
  assert.match(gmailDisconnect, /hasPermission\(identity\.context, "settings:write"\)/);
});

test("credit-consuming enrichment requires workspace write permission", () => {
  const workspace = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
  assert.match(workspace, /const requiredPermission = "workspace:write"/);
  assert.match(workspace, /if \(action === "enrich-row"\)/);
});

test("API key creation only accepts supported scopes", () => {
  const route = readFileSync(join(root, "src/app/api/keys/route.ts"), "utf8");
  const scopes = readFileSync(join(root, "src/lib/api-keys.ts"), "utf8");
  assert.match(scopes, /workspace:read/);
  assert.match(scopes, /workspace:write/);
  assert.match(scopes, /settings:read/);
  assert.match(scopes, /settings:write/);
  assert.match(route, /Choose at least one supported scope/);
});

test("Google sign-in stays product-owned and uses a safe return path", () => {
  const route = readFileSync(join(root, "src/app/api/auth/google/start/route.ts"), "utf8");
  const login = readFileSync(join(root, "src/components/PerpendicularLogin.tsx"), "utf8");
  assert.match(route, /safeReturnPath/);
  assert.match(route, /api\/oauth\/google\/start/);
  assert.match(route, /PERPENDICULAR_WEB_ORIGIN/);
  assert.match(login, /api\/auth\/google\/start/);
});

test("the product-owned auth surface supports self-serve account creation", () => {
  const signup = readFileSync(join(root, "src/app/api/auth/signup/route.ts"), "utf8");
  const authProxy = readFileSync(join(root, "src/lib/auth-proxy.ts"), "utf8");
  const login = readFileSync(join(root, "src/components/PerpendicularLogin.tsx"), "utf8");
  const identity = readFileSync(join(root, "src/lib/identity.ts"), "utf8");
  assert.match(signup, /proxyIdentitySignupRequest/);
  assert.match(authProxy, /identityApiUrl\("\/auth\/signup"\)/);
  assert.match(authProxy, /productSlug: "perpendicular"/);
  assert.match(authProxy, /bb_session/);
  assert.match(login, /Create your workspace/);
  assert.match(login, /api\/auth\/signup/);
  assert.match(identity, /personalWorkspaceId/);
});

test("the known Vercel alias hands sessions to the canonical cookie origin in the browser", () => {
  const login = readFileSync(join(root, "src/components/PerpendicularLogin.tsx"), "utf8");
  const console = readFileSync(join(root, "src/components/PerpendicularConsole.tsx"), "utf8");
  assert.match(login, /perpendicular-nine\.vercel\.app/);
  assert.match(login, /NEXT_PUBLIC_CANONICAL_URL/);
  assert.match(console, /window\.location\.replace/);
});

test("Gmail sync has a workspace-scoped inbox read surface", () => {
  const route = readFileSync(join(root, "src/app/api/inbox/route.ts"), "utf8");
  const sync = readFileSync(join(root, "src/app/api/integrations/gmail/sync/route.ts"), "utf8");
  const inbox = readFileSync(join(root, "src/components/PerpendicularConsole.tsx"), "utf8");
  assert.match(route, /listInboxMessages/);
  assert.match(route, /workspace:read/);
  assert.match(sync, /hasPermission\(identity\.context, "settings:write"\)/);
  assert.match(inbox, /Gmail inbox/);
  assert.match(inbox, /apiPath\("\/api\/inbox"\)/);
});

test("unconfigured Gmail is represented honestly instead of opening a dead OAuth link", () => {
  const store = readFileSync(join(root, "src/lib/integration-store.ts"), "utf8");
  const console = readFileSync(join(root, "src/components/PerpendicularConsole.tsx"), "utf8");
  assert.match(store, /status: "not_configured"/);
  assert.match(console, /gmailNotConfigured = rawGmail\?\.status === "not_configured"/);
  assert.match(console, /gmailNotConfigured \?/);
  assert.match(console, /Gmail OAuth is not configured on the Dell/);
});

test("Gmail mailbox ownership cannot cross workspace boundaries", () => {
  const store = readFileSync(join(root, "src/lib/integration-store.ts"), "utf8");
  assert.match(store, /pg_advisory_xact_lock\(hashtextextended\(\$1, 1\)\)/);
  assert.match(store, /workspace_id <> \$2/);
  assert.match(store, /already connected to another workspace/);
  assert.match(store, /result\.rows\.length === 1/);
});

test("pricing explicitly identifies the open-source launch", () => {
  const pricing = readFileSync(join(root, "src/app/api/pricing/route.ts"), "utf8");
  assert.match(pricing, /openSource: true/);
  assert.match(pricing, /checkout: false/);
});

test("sequence enrollment has a persisted suppression guard", () => {
  const domain = readFileSync(join(root, "src/lib/domain.ts"), "utf8");
  const workspace = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
  const docs = readFileSync(join(root, "src/app/api/docs/route.ts"), "utf8");
  assert.match(domain, /suppressedEmails: string\[\]/);
  assert.match(workspace, /case "suppress-row"/);
  assert.match(workspace, /case "unsuppress-row"/);
  assert.match(workspace, /cannot enter a sequence/);
  assert.match(docs, /suppress-row/);
});

test("Smart List imports deduplicate across the workspace", () => {
  const route = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
  assert.match(route, /already exists in another Smart List in this workspace/);
  assert.match(route, /state\.lists\.some\(\(candidate\) => candidate\.id !== list\.id/);
});

test("Smart Lists expose a validated CSV import path", () => {
  const route = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
  const parser = readFileSync(join(root, "src/lib/lead-csv.ts"), "utf8");
  const console = readFileSync(join(root, "src/components/PerpendicularConsole.tsx"), "utf8");
  assert.match(route, /case "import-csv"/);
  assert.match(route, /duplicate email in this CSV/);
  assert.match(route, /email already exists in this workspace/);
  assert.match(parser, /unclosed quoted field/);
  assert.match(console, /Import CSV/);
  assert.match(console, /importSummary/);
});

test("Smart List scores expose their actual reasons", () => {
  const domain = readFileSync(join(root, "src/lib/domain.ts"), "utf8");
  const scoring = readFileSync(join(root, "src/lib/lead-scoring.ts"), "utf8");
  const route = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
  const console = readFileSync(join(root, "src/components/PerpendicularConsole.tsx"), "utf8");
  assert.match(domain, /scoreReasons\?: string\[\]/);
  assert.match(scoring, /Public\/company signals/);
  assert.match(route, /scoreLead/);
  assert.match(console, /scoreReasons/);
});

test("sequence enrollment is blocked until Gmail is connected", () => {
  const route = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
  const console = readFileSync(join(root, "src/components/PerpendicularConsole.tsx"), "utf8");
  assert.match(route, /Connect Gmail before enrolling a lead in a sequence/);
  assert.match(console, /Connect Gmail to enroll/);
});

test("sequence sends require activation and are explicit Gmail mutations", () => {
  const route = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
  const console = readFileSync(join(root, "src/components/PerpendicularConsole.tsx"), "utf8");
  assert.match(route, /action === "send-sequence-step"/);
  assert.match(route, /sequence\.status !== "live"/);
  assert.match(route, /claimOutboundMessage/);
  assert.match(route, /sendGmailMessage/);
  assert.match(route, /cannot receive sequence mail/);
  assert.match(console, /Send approved email/);
  assert.match(console, /Activate after review/);
});

test("outbound sends are guarded by persisted workspace safety settings", () => {
  const domain = readFileSync(join(root, "src/lib/domain.ts"), "utf8");
  const safety = readFileSync(join(root, "src/lib/outbound-safety.ts"), "utf8");
  const outbound = readFileSync(join(root, "src/lib/outbound-store.ts"), "utf8");
  const workspace = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
  const gmailTest = readFileSync(join(root, "src/app/api/integrations/gmail/test/route.ts"), "utf8");
  const console = readFileSync(join(root, "src/components/PerpendicularConsole.tsx"), "utf8");
  assert.match(domain, /outboundSafety: OutboundSafetySettings/);
  assert.match(safety, /sendWindowStart/);
  assert.match(safety, /skipWeekends/);
  assert.match(safety, /suppressedDomains/);
  assert.match(outbound, /pg_advisory_xact_lock/);
  assert.match(outbound, /status = 'sent'/);
  assert.match(workspace, /outboundSafetyDecision/);
  assert.match(workspace, /dailyLimit: current\.outboundSafety\.dailySendLimit/);
  assert.match(workspace, /case "update-outbound-safety"/);
  assert.match(workspace, /case "suppress-domain"/);
  assert.match(gmailTest, /outboundSafetyDecision/);
  assert.match(console, /Outbound safety/);
});

test("public research does not follow unvalidated redirects or unbounded bodies", () => {
  const research = readFileSync(join(root, "src/lib/public-research.ts"), "utf8");
  assert.match(research, /redirect: "manual"/);
  assert.match(research, /maxRedirects/);
  assert.match(research, /maxResponseBytes/);
  assert.match(research, /assertPublicHost\(url\)/);
});

test("persisted workspace actions return state when audit or usage logging fails", () => {
  const route = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
  const console = readFileSync(join(root, "src/components/PerpendicularConsole.tsx"), "utf8");
  assert.match(route, /persisted: true/);
  assert.match(route, /state: workspaceStateForClient\(updated\)/);
  assert.match(route, /state: workspaceStateForClient\(next\)/);
  assert.match(console, /if \(nextState\) \{/);
});

test("MCP mutations expose persisted state when audit or usage logging fails", () => {
  const mcp = readFileSync(join(root, "src/app/api/mcp/route.ts"), "utf8");
  assert.match(mcp, /persistedFailure/);
  assert.match(mcp, /persisted: true/);
  assert.match(mcp, /mcp\.employee_chat/);
  assert.match(mcp, /mcp\.employee_run/);
  assert.match(mcp, /name: "mission_run"/);
  assert.match(mcp, /name: "mission_approve"/);
  assert.match(mcp, /name: "content_generate"/);
  assert.match(mcp, /name: "content_approve"/);
  assert.match(mcp, /name === "employee_chat"\)[\s\S]*hasPermission\(identity\.context, "workspace:write"\)/);
});

test("onboarding keeps the proof step visible until the operator chooses a repeat mode", () => {
  const domain = readFileSync(join(root, "src/lib/domain.ts"), "utf8");
  const workspace = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
  const console = readFileSync(join(root, "src/components/PerpendicularConsole.tsx"), "utf8");
  assert.match(domain, /status: "not_started" \| "ready" \| "proved" \| "completed"/);
  assert.match(workspace, /state\.workspace\.onboarding\.status = "proved"/);
  assert.match(workspace, /action === "finish-onboarding"/);
  assert.match(console, /Open workbench/);
});

test("external side effects do not masquerade as failures when audit storage is down", () => {
  const gmail = readFileSync(join(root, "src/app/api/integrations/gmail/test/route.ts"), "utf8");
  const keys = readFileSync(join(root, "src/app/api/keys/route.ts"), "utf8");
  const bootstrap = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
  const callback = readFileSync(join(root, "src/app/api/integrations/google/callback/route.ts"), "utf8");
  assert.match(gmail, /The email was sent/);
  assert.match(keys, /The key was created/);
  assert.match(bootstrap, /The workspace was created/);
  assert.match(callback, /gmail=connected/);
  assert.match(callback, /audit=warning/);
});
