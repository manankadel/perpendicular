-- Additive usage accounting for credits, forecasts, and workspace exports.

create table if not exists perpendicular_usage_ledger (
  id text primary key,
  workspace_id text not null,
  actor_id text not null,
  feature text not null,
  unit text not null check (unit in ('ai', 'data')),
  units integer not null check (units > 0),
  provider text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists perpendicular_usage_ledger_workspace_created_idx
  on perpendicular_usage_ledger (workspace_id, created_at desc);

create index if not exists perpendicular_usage_ledger_workspace_unit_feature_idx
  on perpendicular_usage_ledger (workspace_id, unit, feature, created_at desc);
