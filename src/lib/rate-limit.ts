const windowMs = 60_000;
const defaultLimit = 120;
const buckets = new Map<string, { startedAt: number; count: number }>();

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

function configuredLimit() {
  const value = Number(process.env.API_KEY_RATE_LIMIT_PER_MINUTE || defaultLimit);
  return Number.isFinite(value) ? Math.max(1, Math.min(10_000, Math.floor(value))) : defaultLimit;
}

function prune(now: number) {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.startedAt >= windowMs) buckets.delete(key);
  }
}

export function consumeApiKeyRateLimit(keyHash: string, workspaceId: string, now = Date.now()): RateLimitDecision {
  const limit = configuredLimit();
  prune(now);
  const keys = [`key:${keyHash}`, `workspace:${workspaceId}`];
  const current = keys.flatMap((key) => {
    const bucket = buckets.get(key);
    return bucket && now - bucket.startedAt < windowMs ? [bucket] : [];
  });
  const count = current.length ? Math.max(...current.map((bucket) => bucket.count)) : 0;
  const resetAt = now + windowMs;
  if (count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - Math.max(...current.map((bucket) => now - bucket.startedAt))) / 1000));
    return { allowed: false, limit, remaining: 0, resetAt, retryAfterSeconds };
  }
  for (const key of keys) {
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) buckets.set(key, { startedAt: now, count: 1 });
    else bucket.count += 1;
  }
  return { allowed: true, limit, remaining: Math.max(0, limit - count - 1), resetAt, retryAfterSeconds: 0 };
}

export function resetRateLimiterForTests() {
  buckets.clear();
}
