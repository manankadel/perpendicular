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
});

test("workspace deletion requires owner confirmation in the route contract", () => {
  const route = readFileSync(join(root, "src/app/api/workspace/privacy/route.ts"), "utf8");
  assert.match(route, /Only a workspace owner/);
  assert.match(route, /body\.confirmation !== identity\.workspaceId/);
  assert.match(route, /perpendicular_workspace_state/);
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
