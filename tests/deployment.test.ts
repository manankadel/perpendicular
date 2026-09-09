import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const overlay = readFileSync(join(root, "deploy/dell/perpendicular.image.compose.yml"), "utf8");
const deployScript = readFileSync(join(root, "deploy/dell/deploy-image.sh"), "utf8");

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
