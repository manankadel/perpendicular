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
  assert.match(route, /delete from perpendicular_workspace_state where company_id = \$1/);
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
  assert.match(workspace, /hasPermission\(identity\.context, "workspace:read"\)/);
  assert.match(integrations, /hasPermission\(identity\.context, "workspace:read"\)/);
  assert.match(usage, /hasPermission\(identity, "settings:read"\)/);
  assert.match(exportRoute, /hasPermission\(identity, "workspace:read"\)/);
  assert.match(gmailTest, /hasPermission\(identity\.context, "settings:write"\)/);
  assert.match(gmailDisconnect, /hasPermission\(identity\.context, "settings:write"\)/);
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

test("Gmail sync has a workspace-scoped inbox read surface", () => {
  const route = readFileSync(join(root, "src/app/api/inbox/route.ts"), "utf8");
  const inbox = readFileSync(join(root, "src/components/PerpendicularConsole.tsx"), "utf8");
  assert.match(route, /listInboxMessages/);
  assert.match(route, /workspace:read/);
  assert.match(inbox, /Gmail inbox/);
  assert.match(inbox, /apiPath\("\/api\/inbox"\)/);
});

test("unconfigured Gmail is represented honestly instead of opening a dead OAuth link", () => {
  const store = readFileSync(join(root, "src/lib/integration-store.ts"), "utf8");
  const console = readFileSync(join(root, "src/components/PerpendicularConsole.tsx"), "utf8");
  assert.match(store, /status: "not_configured"/);
  assert.match(console, /Gmail OAuth is not configured on the Dell/);
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

test("sequence enrollment is blocked until Gmail is connected", () => {
  const route = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
  const console = readFileSync(join(root, "src/components/PerpendicularConsole.tsx"), "utf8");
  assert.match(route, /Connect Gmail before enrolling a lead in a sequence/);
  assert.match(console, /Connect Gmail to enroll/);
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
  assert.match(route, /state: updated/);
  assert.match(route, /state: next/);
  assert.match(console, /if \(nextState\) \{/);
});

test("MCP mutations expose persisted state when audit or usage logging fails", () => {
  const mcp = readFileSync(join(root, "src/app/api/mcp/route.ts"), "utf8");
  assert.match(mcp, /persistedFailure/);
  assert.match(mcp, /persisted: true/);
  assert.match(mcp, /mcp\.employee_chat/);
  assert.match(mcp, /mcp\.employee_run/);
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
