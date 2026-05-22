create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  vendor text not null check (vendor in ('Nilfisk', 'Taski', 'Triple-S')),
  product_name text not null,
  product_description text,
  product_type text not null default 'autoscrubber',
  approved_status text not null default 'pending' check (approved_status in ('pending', 'approved', 'rejected')),
  specs_json jsonb not null default '{}'::jsonb,
  knowledge_embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pricing_rules (
  id uuid primary key default gen_random_uuid(),
  sku text not null references products (sku) on delete cascade,
  floor_price numeric(12,2),
  target_price numeric(12,2),
  min_margin_pct numeric(5,2),
  contract_name text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists strategy_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule_text text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists vendor_priority (
  id uuid primary key default gen_random_uuid(),
  vendor text not null unique check (vendor in ('Nilfisk', 'Taski', 'Triple-S')),
  priority_rank int not null
);

create table if not exists recommendation_logs (
  id uuid primary key,
  source text not null check (source in ('slack', 'web')),
  rep_user_id text not null,
  request_text text not null,
  account_name text,
  recommendation_json jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null,
  user_id text not null,
  feedback_type text not null check (feedback_type in ('approve', 'edit', 'reject')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists recommendation_reviews (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null,
  source text not null check (source in ('manager_console', 'slack', 'api')),
  feedback text not null check (feedback in ('good', 'bad', 'needs_correction')),
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists ai_call_logs (
  id uuid primary key default gen_random_uuid(),
  task_type text not null,
  model text not null,
  reasoning_effort text,
  source_feature text,
  recommendation_log_id uuid,
  slack_user_id text,
  upload_document_id uuid,
  latency_ms int not null default 0,
  used_fallback boolean not null default false,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists sales_playbooks (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  segment text not null,
  required_questions jsonb not null default '[]'::jsonb,
  recommendation_rules jsonb not null default '[]'::jsonb,
  selling_points jsonb not null default '[]'::jsonb,
  objections jsonb not null default '[]'::jsonb,
  products_to_prioritize jsonb not null default '[]'::jsonb,
  products_to_avoid jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_playbooks_category_segment_unique on sales_playbooks (category, segment);

insert into sales_playbooks (
  category,
  segment,
  required_questions,
  recommendation_rules,
  selling_points,
  objections,
  products_to_prioritize,
  products_to_avoid
)
values (
  'autoscrubber',
  'school',
  '["What is the square footage?","What floor types are in scope?","How frequently is cleaning required?","What is the budget range?","What machine is currently used?","Battery preference?"]'::jsonb,
  '["Lead with practical mid-range battery units before premium ride-ons unless square footage is large.","Prioritize recommendations that are easy to train and operate.","Favor options with strong recovery and durability for daily school use.","Avoid overcomplicating recommendations for budget-sensitive schools."]'::jsonb,
  '["Ease of use for high operator turnover","Safety and predictable controls","Water recovery performance","Durability and serviceability"]'::jsonb,
  '["If premium options are challenged on price, offer mid-range battery alternatives and lifecycle value framing."]'::jsonb,
  '["Mid-range battery walk-behind units","Simple control layout machines"]'::jsonb,
  '["Overly complex premium ride-ons for small/medium schools","Units with training-heavy workflows"]'::jsonb
)
on conflict (category, segment) do nothing;

create table if not exists uploaded_documents (
  id uuid primary key default gen_random_uuid(),
  original_file_name text not null,
  stored_file_path text not null,
  mime_type text not null,
  file_extension text not null,
  source_type text not null default 'file' check (source_type in ('file', 'url')),
  source_url text,
  notes text,
  vendor text not null,
  document_type text not null default 'price_sheet',
  parse_status text not null default 'pending' check (parse_status in ('pending', 'parsed', 'parsed_with_errors', 'not_supported', 'needs_manual_review', 'failed')),
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  parse_error text,
  total_rows int not null default 0,
  parsed_rows int not null default 0,
  skipped_rows int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists parsed_product_rows (
  id uuid primary key default gen_random_uuid(),
  uploaded_document_id uuid not null references uploaded_documents (id) on delete cascade,
  row_number int not null,
  raw_json jsonb not null default '{}'::jsonb,
  sku text,
  product_name text,
  product_description text,
  list_price numeric(12,2),
  dealer_net numeric(12,2),
  true_cost numeric(12,2),
  ed_data_sell_price numeric(12,2),
  gross_profit numeric(12,2),
  margin_percent numeric(8,4),
  approved_status text not null default 'pending' check (approved_status in ('pending', 'approved', 'rejected')),
  skip_reason text,
  created_at timestamptz not null default now()
);

create table if not exists product_pricing (
  id uuid primary key default gen_random_uuid(),
  sku text not null references products (sku) on delete cascade,
  vendor text not null check (vendor in ('Nilfisk', 'Taski', 'Triple-S')),
  program_name text not null default 'Nilfisk school/healthcare',
  source_uploaded_document_id uuid references uploaded_documents (id) on delete set null,
  list_price numeric(12,2) not null,
  dealer_net numeric(12,2) not null,
  true_cost numeric(12,2) not null,
  ed_data_sell_price numeric(12,2) not null,
  gross_profit numeric(12,2) not null,
  margin_percent numeric(8,4) not null,
  approved_status text not null default 'pending' check (approved_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists product_pricing_sku_program_unique on product_pricing (sku, program_name);

create table if not exists knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text not null,
  source_type text not null,
  source_ref_id uuid,
  approved_status text not null default 'pending' check (approved_status in ('pending', 'approved', 'rejected')),
  metadata_json jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists knowledge_entries_title_source_unique on knowledge_entries (title, source_type);

create table if not exists knowledge_cards (
  id uuid primary key default gen_random_uuid(),
  uploaded_document_id uuid not null references uploaded_documents (id) on delete cascade,
  linked_product_id uuid references products (id) on delete set null,
  card_type text not null check (
    card_type in (
      'product_insight',
      'application_fit',
      'selling_point',
      'objection',
      'competitive_note',
      'maintenance_service_note',
      'spec_fact',
      'discovery_question'
    )
  ),
  title text not null,
  body text not null,
  vendor text,
  category text,
  segment text,
  confidence_score numeric(4,3),
  source_type text not null check (source_type in ('upload', 'url')),
  source_url text,
  source_excerpt text,
  match_reason text,
  approved_status text not null default 'pending' check (approved_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists knowledge_cards_upload_idx on knowledge_cards (uploaded_document_id);
create index if not exists knowledge_cards_status_idx on knowledge_cards (approved_status);

create table if not exists crawl_jobs (
  id uuid primary key default gen_random_uuid(),
  vendor text not null,
  start_url text not null,
  allowed_domains jsonb not null default '[]'::jsonb,
  include_patterns jsonb not null default '[]'::jsonb,
  exclude_patterns jsonb not null default '[]'::jsonb,
  max_pages int not null default 50,
  max_depth int not null default 2,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  pages_found int not null default 0,
  pages_ingested int not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists crawled_pages (
  id uuid primary key default gen_random_uuid(),
  crawl_job_id uuid not null references crawl_jobs (id) on delete cascade,
  url text not null,
  page_title text,
  content_hash text,
  parse_status text not null default 'pending' check (parse_status in ('pending', 'parsed', 'skipped', 'failed')),
  created_at timestamptz not null default now()
);
create unique index if not exists crawled_pages_job_url_unique on crawled_pages (crawl_job_id, url);

create table if not exists agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  requested_by text,
  source text,
  tool_name text not null,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  error_message text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create table if not exists agent_action_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by text,
  source text,
  action_type text not null,
  requires_approval boolean not null default true,
  approval_status_target text not null default 'Pending Approval',
  input_json jsonb not null default '{}'::jsonb,
  preview_json jsonb,
  output_json jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'executed', 'failed')),
  approved_by text,
  approved_at timestamptz,
  executed_at timestamptz,
  claimed_by text,
  claimed_at timestamptz,
  retry_count integer not null default 0,
  last_attempted_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table agent_action_requests add column if not exists requires_approval boolean not null default true;
alter table agent_action_requests add column if not exists approval_status_target text not null default 'Pending Approval';
alter table agent_action_requests add column if not exists output_json jsonb;
alter table agent_action_requests add column if not exists claimed_by text;
alter table agent_action_requests add column if not exists claimed_at timestamptz;
alter table agent_action_requests add column if not exists retry_count integer not null default 0;
alter table agent_action_requests add column if not exists last_attempted_at timestamptz;

create table if not exists agent_action_execution_logs (
  id uuid primary key default gen_random_uuid(),
  action_request_id uuid not null references agent_action_requests (id) on delete cascade,
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
