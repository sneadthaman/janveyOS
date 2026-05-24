create extension if not exists pgcrypto;

create table if not exists public.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  requested_by text,
  source text,
  tool_name text not null,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb,
  status text not null check (status in ('completed', 'failed')),
  error_message text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_tool_calls_created_at
  on public.agent_tool_calls (created_at desc);

create index if not exists idx_agent_tool_calls_tool_name_created_at
  on public.agent_tool_calls (tool_name, created_at desc);

create table if not exists public.agent_action_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  requested_by text,
  source text,
  action_type text not null,
  requires_approval boolean not null default true,
  approval_status_target text not null default 'Pending Approval',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'running', 'executed', 'completed', 'failed', 'rejected', 'cancelled')),
  input_json jsonb not null default '{}'::jsonb,
  preview_json jsonb,
  output_json jsonb,
  approved_by text,
  approved_at timestamptz,
  executed_at timestamptz,
  claimed_by text,
  claimed_at timestamptz,
  retry_count integer not null default 0,
  last_attempted_at timestamptz,
  error_message text
);

create index if not exists idx_agent_action_requests_created_at
  on public.agent_action_requests (created_at desc);

create index if not exists idx_agent_action_requests_status
  on public.agent_action_requests (status);

create index if not exists idx_agent_action_requests_action_type
  on public.agent_action_requests (action_type);

create index if not exists idx_agent_action_requests_status_claimable
  on public.agent_action_requests (status, claimed_at, executed_at, retry_count, created_at)
  where status = 'approved';

create index if not exists idx_agent_action_requests_action_type_created_at
  on public.agent_action_requests (action_type, created_at desc);

create table if not exists public.agent_action_execution_logs (
  id uuid primary key default gen_random_uuid(),
  action_request_id uuid not null references public.agent_action_requests(id) on delete cascade,
  attempt_number integer not null,
  worker_id text not null,
  status text not null check (status in ('started', 'completed', 'failed')),
  handler_name text not null,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb,
  error_message text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_action_execution_logs_action_request_id
  on public.agent_action_execution_logs (action_request_id);

create index if not exists idx_agent_action_execution_logs_action_attempt
  on public.agent_action_execution_logs (action_request_id, attempt_number, created_at);
