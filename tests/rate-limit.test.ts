import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { consumeApiKeyRateLimit, resetRateLimiterForTests } from "../src/lib/rate-limit";

test("API key limits apply to both the key and its workspace", () => {
  const previous = process.env.API_KEY_RATE_LIMIT_PER_MINUTE;
  process.env.API_KEY_RATE_LIMIT_PER_MINUTE = "2";
  resetRateLimiterForTests();
  const first = consumeApiKeyRateLimit("hash-a", "workspace-a", 1000);
  const second = consumeApiKeyRateLimit("hash-a", "workspace-a", 1001);
  const blocked = consumeApiKeyRateLimit("hash-a", "workspace-a", 1002);
  assert.equal(first.allowed, true);
  assert.equal(second.remaining, 0);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal(consumeApiKeyRateLimit("hash-b", "workspace-a", 1003).allowed, false);
  assert.equal(consumeApiKeyRateLimit("hash-a", "workspace-a", 61_001).allowed, true);
  resetRateLimiterForTests();
  if (previous === undefined) delete process.env.API_KEY_RATE_LIMIT_PER_MINUTE;
  else process.env.API_KEY_RATE_LIMIT_PER_MINUTE = previous;
});

test("the production limiter has a durable Postgres migration and keeps an outage fallback", () => {
  const migration = readFileSync(join(process.cwd(), "db/006_rate_limits.sql"), "utf8");
  const implementation = readFileSync(join(process.cwd(), "src/lib/rate-limit.ts"), "utf8");
  assert.match(migration, /perpendicular_rate_limits/);
  assert.match(migration, /bucket_key text primary key/);
  assert.match(implementation, /consumeApiKeyRateLimitPersistent/);
  assert.match(implementation, /transaction/);
  assert.match(implementation, /consumeApiKeyRateLimit\(/);
});
