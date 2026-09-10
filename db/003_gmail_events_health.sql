-- Gmail provider events and integration health history.

create table if not exists perpendicular_webhook_events (
  id text primary key,
  workspace_id text not null,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('received', 'processed', 'failed')) default 'received',
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create index if not exists perpendicular_webhook_events_workspace_created_idx
  on perpendicular_webhook_events (workspace_id, created_at desc);

create table if not exists perpendicular_integration_health (
  id text primary key,
  workspace_id text not null,
  provider text not null,
  status text not null check (status in ('not_configured', 'connected', 'degraded', 'disconnected')),
  event_type text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists perpendicular_integration_health_workspace_provider_created_idx
  on perpendicular_integration_health (workspace_id, provider, created_at desc);
