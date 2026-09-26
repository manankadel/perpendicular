-- Durable API-key rate-limit buckets. The application keeps the in-memory
-- limiter as a development/outage fallback, but production requests share
-- these counters across every API container.

create table if not exists perpendicular_rate_limits (
  bucket_key text primary key,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists perpendicular_rate_limits_updated_idx
  on perpendicular_rate_limits (updated_at);
