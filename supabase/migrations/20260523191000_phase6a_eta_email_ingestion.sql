create table if not exists public.eta_email_ingestions (
  id uuid primary key default gen_random_uuid(),
  graph_message_id text not null unique,
  internet_message_id text,
  subject text,
  sender text,
  received_at timestamptz,
  folder_name text not null,
  raw_body_text text,
  raw_body_html text,
  extraction_status text not null default 'pending' check (extraction_status in ('pending', 'extracted', 'failed', 'approval_created', 'skipped')),
  extracted_payload jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_eta_email_ingestions_folder_name
  on public.eta_email_ingestions (folder_name);

create index if not exists idx_eta_email_ingestions_received_at
  on public.eta_email_ingestions (received_at desc);

create index if not exists idx_eta_email_ingestions_extraction_status
  on public.eta_email_ingestions (extraction_status);
