create table if not exists public.vendor_eta_updates (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null,
  po_number text,
  netsuite_po_internal_id text,
  item_number text,
  netsuite_item_internal_id text,
  eta_date date,
  tracking_number text,
  update_scope text not null default 'unknown' check (update_scope in ('po_all_lines', 'po_line', 'item_global', 'unknown')),
  source_type text not null check (source_type in ('slack', 'email', 'pdf', 'portal', 'manual')),
  source_reference text,
  raw_notes text,
  confidence numeric,
  status text not null default 'parsed' check (status in ('parsed', 'matched', 'needs_review', 'approved', 'applied', 'rejected', 'superseded')),
  created_action_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vendor_eta_updates_po_number
  on public.vendor_eta_updates (po_number);

create index if not exists idx_vendor_eta_updates_vendor_name
  on public.vendor_eta_updates (vendor_name);

create index if not exists idx_vendor_eta_updates_item_number
  on public.vendor_eta_updates (item_number);

create index if not exists idx_vendor_eta_updates_eta_date
  on public.vendor_eta_updates (eta_date);

create index if not exists idx_vendor_eta_updates_status
  on public.vendor_eta_updates (status);
