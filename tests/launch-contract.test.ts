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
