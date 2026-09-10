import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const overlay = readFileSync(join(root, "deploy/dell/perpendicular.image.compose.yml"), "utf8");
const deployScript = readFileSync(join(root, "deploy/dell/deploy-image.sh"), "utf8");
const workflow = readFileSync(join(root, ".github/workflows/perpendicular-image.yml"), "utf8");
const serverStore = readFileSync(join(root, "src/lib/server-store.ts"), "utf8");
const healthRoute = readFileSync(join(root, "src/app/api/health/route.ts"), "utf8");
const database = readFileSync(join(root, "src/lib/database.ts"), "utf8");
const productionSmoke = readFileSync(join(root, "scripts/production-smoke.mjs"), "utf8");

test("Dell image overlay cannot fall back to a production source build", () => {
  assert.match(overlay, /image: \$\{PERPENDICULAR_IMAGE:\?/);
  assert.doesNotMatch(overlay, /build:/);
  assert.match(overlay, /pull_policy:/);
});

test("Dell rollout is digest-pinned and scoped to the API service", () => {
  assert.ok(deployScript.includes("ghcr.io/manankadel/perpendicular-api@sha256:"));
  assert.match(deployScript, /--no-deps/);
  assert.ok(deployScript.includes('"${compose[@]}" pull "$service"'));
  assert.doesNotMatch(deployScript, /docker compose[^\n]+down/);
  assert.doesNotMatch(deployScript, /--remove-orphans/);
});

test("image publication is gated by the product verification suite", () => {
  assert.match(workflow, /verify:/);
  assert.match(workflow, /run: npm run check/);
  assert.match(workflow, /run: npm audit --omit=dev --audit-level=high/);
  assert.match(workflow, /needs: verify/);
});

test("production startup does not mutate the database schema", () => {
  assert.match(serverStore, /if \(process\.env\.NODE_ENV === "production"\) return database;/);
});

test("database-backed workspace writes are serialized per workspace", () => {
  assert.match(serverStore, /pg_advisory_lock\(hashtextextended\(\$1, 0\)\)/);
  assert.match(serverStore, /pg_advisory_unlock\(hashtextextended\(\$1, 0\)\)/);
});

test("production health fails closed when required migrations are missing", () => {
  assert.match(healthRoute, /perpendicular_usage_ledger/);
  assert.match(healthRoute, /information_schema\.tables/);
  assert.match(healthRoute, /status: production && !ok \? 503 : 200/);
});

test("health reports provider configuration gaps without exposing secrets", () => {
  assert.match(healthRoute, /gmailOAuth/);
  assert.match(healthRoute, /gmailPush/);
  assert.match(healthRoute, /integrationEncryption/);
  assert.match(healthRoute, /configurationGaps/);
});

test("database connections retry after a transient outage", () => {
  assert.match(database, /unavailableUntil/);
  assert.match(database, /databaseRetryBackoffMs/);
  assert.match(database, /Date\.now\(\) < unavailableUntil/);
});

test("production smoke checks cover public launch gates", () => {
  assert.match(productionSmoke, /API health and launch configuration/);
  assert.match(productionSmoke, /credentialed CORS preflight/);
  assert.match(productionSmoke, /unauthenticated workspace rejection/);
  assert.match(productionSmoke, /OpenAPI documentation/);
  assert.match(productionSmoke, /truthful pricing endpoint/);
});
