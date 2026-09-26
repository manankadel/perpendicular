import { databaseConfigured, transaction } from "@/lib/database";

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

export async function consumeApiKeyRateLimitPersistent(keyHash: string, workspaceId: string, now = Date.now()): Promise<RateLimitDecision> {
  if (!databaseConfigured()) return consumeApiKeyRateLimit(keyHash, workspaceId, now);
  const limit = configuredLimit();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  try {
    return await transaction(async (client) => {
      const bucketKeys = [`key:${keyHash}`, `workspace:${workspaceId}`];
      const decisions = await Promise.all(bucketKeys.map(async (bucketKey) => {
        const result = await client.query<{ window_start: Date; request_count: number }>(
          `insert into perpendicular_rate_limits (bucket_key, window_start, request_count, updated_at)
           values ($1, $2, 1, now())
           on conflict (bucket_key) do update set
             window_start = excluded.window_start,
             request_count = case
               when perpendicular_rate_limits.window_start = excluded.window_start
                 then perpendicular_rate_limits.request_count + 1
               else 1
             end,
             updated_at = now()
           returning window_start, request_count`,
          [bucketKey, windowStart],
        );
        return result.rows[0];
      }));
      const count = Math.max(...decisions.map((decision) => decision.request_count));
      const resetAt = Math.max(...decisions.map((decision) => new Date(decision.window_start).getTime() + windowMs));
      const allowed = count <= limit;
      return { allowed, limit, remaining: allowed ? Math.max(0, limit - count) : 0, resetAt, retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)) };
    });
  } catch {
    return consumeApiKeyRateLimit(keyHash, workspaceId, now);
  }
}

export function resetRateLimiterForTests() {
  buckets.clear();
}
