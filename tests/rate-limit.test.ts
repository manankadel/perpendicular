import test from "node:test";
import assert from "node:assert/strict";
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
