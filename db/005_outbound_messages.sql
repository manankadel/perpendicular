-- Durable, human-approved outbound message state. This table prevents a retry from sending the same sequence step twice.

create table if not exists perpendicular_outbound_messages (
  id text primary key,
  workspace_id text not null,
  idempotency_key text not null unique,
  provider text not null,
  recipient text not null,
  sequence_id text not null,
  row_id text not null,
  step_index integer not null check (step_index >= 0),
  subject text not null,
  body_text text not null,
  status text not null check (status in ('sending', 'sent', 'failed', 'unknown')) default 'sending',
  provider_message_id text,
  provider_thread_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists perpendicular_outbound_messages_workspace_created_idx
  on perpendicular_outbound_messages (workspace_id, created_at desc);

create index if not exists perpendicular_outbound_messages_workspace_row_idx
  on perpendicular_outbound_messages (workspace_id, row_id, step_index);
