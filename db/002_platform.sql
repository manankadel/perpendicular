-- Perpendicular platform tables. Apply this file to the dedicated `perpendicular` database.

create table if not exists perpendicular_integrations (
  id text primary key,
  workspace_id text not null,
  provider text not null,
  status text not null check (status in ('not_configured', 'connected', 'degraded', 'disconnected')),
  account_email text,
  provider_account_id text,
  encrypted_refresh_token text,
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create index if not exists perpendicular_integrations_workspace_idx
  on perpendicular_integrations (workspace_id, provider);

create table if not exists perpendicular_oauth_states (
  state_hash text primary key,
  workspace_id text not null,
  user_id text not null,
  provider text not null,
  code_verifier text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists perpendicular_oauth_states_expiry_idx
  on perpendicular_oauth_states (expires_at);

create table if not exists perpendicular_api_keys (
  id text primary key,
  workspace_id text not null,
  created_by text not null,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists perpendicular_api_keys_workspace_idx
  on perpendicular_api_keys (workspace_id, revoked_at);

create table if not exists perpendicular_audit_events (
  id text primary key,
  workspace_id text not null,
  actor_id text not null,
  action text not null,
  resource_type text,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists perpendicular_audit_events_workspace_created_idx
  on perpendicular_audit_events (workspace_id, created_at desc);

create table if not exists perpendicular_jobs (
  id text primary key,
  workspace_id text not null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'dead_letter')) default 'queued',
  idempotency_key text not null unique,
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists perpendicular_jobs_claim_idx
  on perpendicular_jobs (status, run_at, created_at);

create table if not exists perpendicular_inbox_threads (
  id text primary key,
  workspace_id text not null,
  provider text not null,
  provider_thread_id text not null,
  subject text not null default '',
  participants jsonb not null default '[]'::jsonb,
  last_message_at timestamptz,
  paused_sequence_ids text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, provider_thread_id)
);

create table if not exists perpendicular_inbox_messages (
  id text primary key,
  workspace_id text not null,
  thread_id text not null references perpendicular_inbox_threads(id) on delete cascade,
  provider_message_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender text not null default '',
  recipients jsonb not null default '[]'::jsonb,
  subject text not null default '',
  body_text text not null default '',
  received_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider_message_id)
);

create index if not exists perpendicular_inbox_messages_workspace_received_idx
  on perpendicular_inbox_messages (workspace_id, received_at desc);
