create table if not exists perpendicular_workspace_state (
  company_id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists perpendicular_workspace_state_updated_at_idx
  on perpendicular_workspace_state (updated_at desc);
